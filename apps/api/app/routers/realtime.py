"""WebSocket endpoint for real-time full-duplex voice conversation."""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    authenticate_access_token,
    can_access_workspace_conversation,
    is_token_revoked_for_user,
)
from app.core.errors import ApiError
from app.db.session import SessionLocal
from app.models import Conversation, Membership, Message, ModelCatalog, Project, User
from app.services.context_loader import (
    load_recent_messages,
)
from app.services.composed_realtime import ComposedRealtimeSession, decode_pending_media
from app.services.asr_client import RealtimeTranscriptionBridge
from app.services.memory_context import build_memory_context, touch_memories_from_trace
from app.services.realtime_bridge import (
    RealtimeSession,
    register_session,
    unregister_session,
)
from app.services.dashscope_client import UpstreamServiceError
from app.services.pipeline_models import DEFAULT_PIPELINE_MODELS, resolve_pipeline_model_id
from app.services.qwen_official_catalog import find_model
from app.tasks.worker_tasks import extract_memories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/realtime", tags=["realtime"])
SESSION_MONITOR_INTERVAL_SECONDS = 5.0
UPSTREAM_CONNECT_TIMEOUT_SECONDS = 10.0
UPSTREAM_SESSION_UPDATE_TIMEOUT_SECONDS = 10.0
COMPOSED_TRAILING_AUDIO_GRACE_SECONDS = 0.75
MODEL_API_UNCONFIGURED_MESSAGE = (
    "AI service is not configured. Set DASHSCOPE_API_KEY and restart the API service."
)


async def _authenticate_websocket(ws: WebSocket) -> tuple[User, dict[str, object]]:
    """Validate same-site cookie auth for the realtime websocket."""
    origin = ws.headers.get("origin")
    if not origin or not settings.is_origin_allowed(settings.normalize_origin(origin)):
        raise ApiError("forbidden_origin", "Origin not allowed", status_code=403)

    access_token = ws.cookies.get(settings.access_cookie_name)
    if not access_token:
        raise ApiError("unauthorized", "Authentication required", status_code=401)

    db: Session = SessionLocal()
    try:
        return authenticate_access_token(db=db, access_token=access_token)
    finally:
        db.close()


def _load_authorized_conversation(
    db: Session,
    *,
    current_user_id: str,
    project_id: str,
    conversation_id: str,
) -> tuple[Conversation, Membership]:
    row = (
        db.query(Conversation, Membership)
        .join(Project, Project.id == Conversation.project_id)
        .join(Membership, Membership.workspace_id == Project.workspace_id)
        .filter(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
            Project.id == project_id,
            Project.deleted_at.is_(None),
            Conversation.workspace_id == Project.workspace_id,
            Membership.user_id == current_user_id,
        )
        .first()
    )
    if not row:
        raise ApiError("forbidden", "Realtime session access denied", status_code=403)

    conversation, membership = row
    if not can_access_workspace_conversation(
        current_user_id=current_user_id,
        workspace_role=membership.role or "owner",
        conversation_created_by=conversation.created_by,
    ):
        raise ApiError("forbidden", "Realtime session access denied", status_code=403)
    return conversation, membership


def _resolve_realtime_model_id(db: Session, project_id: str) -> str:
    model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="realtime")
    return model_id or DEFAULT_PIPELINE_MODELS["realtime"]


def _resolve_realtime_asr_model_id(db: Session, project_id: str) -> str:
    model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="realtime_asr")
    return model_id or DEFAULT_PIPELINE_MODELS["realtime_asr"]


async def _send_session_end(
    ws: WebSocket,
    *,
    reason: str,
    close_code: int = 1000,
) -> None:
    try:
        await ws.send_json({"type": "session.end", "reason": reason})
    except Exception:
        pass
    try:
        await ws.close(code=close_code, reason=reason)
    except Exception:
        pass


async def _send_error_and_close(
    ws: WebSocket,
    *,
    code: str,
    message: str,
    close_code: int = 1011,
) -> None:
    try:
        await ws.send_json({"type": "error", "code": code, "message": message})
    except Exception:
        pass
    try:
        await ws.close(code=close_code, reason=message)
    except Exception:
        pass


async def _ensure_model_api_configured(ws: WebSocket) -> bool:
    if settings.dashscope_api_key:
        return True
    await _send_error_and_close(
        ws,
        code="model_api_unconfigured",
        message=MODEL_API_UNCONFIGURED_MESSAGE,
        close_code=1011,
    )
    return False


async def _load_initial_context(
    db: Session,
    session: RealtimeSession,
) -> str:
    """Load initial layered prompt context for realtime sessions."""
    recent_messages = load_recent_messages(
        db,
        conversation_id=session.conversation_id,
        limit=max(settings.realtime_context_history_turns * 2, 0),
    )
    context = await build_memory_context(
        db,
        workspace_id=session.workspace_id,
        project_id=session.project_id,
        conversation_id=session.conversation_id,
        user_message="",
        recent_messages=recent_messages,
        include_recent_history=True,
    )
    session._retrieval_trace = context.retrieval_trace
    return context.system_prompt


async def _post_turn_tasks(
    session: RealtimeSession,
    user_text: str,
    ai_text: str,
) -> None:
    """Save messages to DB and run async tasks after a conversation turn."""
    if not user_text or not ai_text:
        return

    # Persist messages to database
    db_save: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        db_save.add(Message(
            conversation_id=session.conversation_id,
            role="user",
            content=user_text,
            created_at=now,
        ))
        db_save.add(Message(
            conversation_id=session.conversation_id,
            role="assistant",
            content=ai_text,
            created_at=now,
        ))
        db_save.query(Conversation).filter(
            Conversation.id == session.conversation_id
        ).update({"updated_at": now})
        touch_memories_from_trace(
            db_save,
            retrieval_trace=getattr(session, "_retrieval_trace", None),
            used_at=now,
        )
        db_save.commit()
    except Exception:
        db_save.rollback()
        logger.exception("Failed to save voice turn messages")
    finally:
        db_save.close()

    # Dispatch memory extraction (Celery, fire-and-forget)
    extract_memories.delay(
        session.workspace_id,
        session.project_id,
        session.conversation_id,
        user_text,
        ai_text,
    )

    # Refresh layered context after a few turns so the next turn sees the latest
    # memories, summaries, and relevant linked documents.
    if session.turn_count % settings.realtime_rag_refresh_turns == 0:
        try:
            db: Session = SessionLocal()
            try:
                recent_messages = load_recent_messages(
                    db,
                    conversation_id=session.conversation_id,
                    limit=max(settings.realtime_context_history_turns * 2, 0),
                )
                context = await build_memory_context(
                    db,
                    workspace_id=session.workspace_id,
                    project_id=session.project_id,
                    conversation_id=session.conversation_id,
                    user_message=user_text,
                    recent_messages=recent_messages,
                    include_recent_history=True,
                )
                session._retrieval_trace = context.retrieval_trace
                await session.send_session_update(context.system_prompt)
            finally:
                db.close()
        except Exception:
            logger.exception("Failed to refresh RAG context")


def _load_llm_capabilities(db: Session, project_id: str) -> tuple[str, set[str]]:
    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")
    llm_entry = (
        db.query(ModelCatalog)
        .filter(ModelCatalog.model_id == llm_model_id, ModelCatalog.is_active.is_(True))
        .first()
    )
    capabilities = {str(value).lower() for value in (llm_entry.capabilities or [])} if llm_entry else set()
    official = find_model(llm_model_id)
    if official:
        capabilities.update(str(value).lower() for value in official.get("input_modalities", []))
        capabilities.update(str(value).lower() for value in official.get("output_modalities", []))
        capabilities.update(str(value).lower() for value in official.get("supported_tools", []))
        capabilities.update(str(value).lower() for value in official.get("supported_features", []))
    return llm_model_id, capabilities


async def _persist_composed_turn(
    session: ComposedRealtimeSession,
    user_text: str,
    ai_text: str,
) -> None:
    if not user_text or not ai_text:
        return

    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        db.add(Message(
            conversation_id=session.conversation_id,
            role="user",
            content=user_text,
            created_at=now,
        ))
        db.add(Message(
            conversation_id=session.conversation_id,
            role="assistant",
            content=ai_text,
            created_at=now,
        ))
        db.query(Conversation).filter(
            Conversation.id == session.conversation_id
        ).update({"updated_at": now})
        touch_memories_from_trace(
            db,
            retrieval_trace=getattr(session, "_retrieval_trace", None),
            used_at=now,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to save composed realtime turn")
    finally:
        db.close()

    extract_memories.delay(
        session.workspace_id,
        session.project_id,
        session.conversation_id,
        user_text,
        ai_text,
    )


async def _composed_idle_monitor(
    ws: WebSocket,
    session: ComposedRealtimeSession,
    auth_payload: dict[str, object],
) -> str | None:
    start_time = asyncio.get_event_loop().time()
    idle_warned = False
    while True:
        await asyncio.sleep(SESSION_MONITOR_INTERVAL_SECONDS)
        if is_token_revoked_for_user(session.user_id, auth_payload):
            return "auth_revoked"
        if session.idle_seconds >= settings.realtime_close_timeout_seconds:
            return "timeout"
        if not idle_warned and session.idle_seconds >= settings.realtime_idle_timeout_seconds:
            idle_warned = True
            try:
                await ws.send_json({"type": "session.idle"})
            except Exception:
                pass
        elif session.idle_seconds < settings.realtime_idle_timeout_seconds:
            idle_warned = False
        elapsed = asyncio.get_event_loop().time() - start_time
        if elapsed >= settings.realtime_max_session_seconds:
            return "max_duration"


async def _upstream_listener(
    ws: WebSocket,
    session: RealtimeSession,
) -> dict[str, str] | None:
    """Listen for DashScope upstream events and relay to client."""
    try:
        async for raw_msg in session._upstream_ws:
            if isinstance(raw_msg, bytes):
                continue
            event = json.loads(raw_msg)
            outgoing = await session.handle_upstream_event(event)
            for item in outgoing:
                if isinstance(item, bytes):
                    await ws.send_bytes(item)
                else:
                    await ws.send_json(item)

            if event.get("type") == "response.done":
                user_text, ai_text = session.get_turn_texts()
                asyncio.create_task(_post_turn_tasks(session, user_text, ai_text))
        if session.state not in (session.state.CLOSING, session.state.CLOSED):
            return {
                "code": "upstream_disconnected",
                "message": "AI 暂时无响应",
            }
        return None
    except Exception as exc:
        logger.warning("Upstream listener error: %s", exc)
        return {
            "code": "upstream_disconnected",
            "message": "AI 暂时无响应",
        }


async def _idle_monitor(
    ws: WebSocket,
    session: RealtimeSession,
    auth_payload: dict[str, object],
) -> str | None:
    """Monitor for idle timeout and max session duration."""
    start_time = asyncio.get_event_loop().time()
    idle_warned = False
    while session.state not in (session.state.CLOSING, session.state.CLOSED):
        await asyncio.sleep(SESSION_MONITOR_INTERVAL_SECONDS)
        if is_token_revoked_for_user(session.user_id, auth_payload):
            return "auth_revoked"
        if session.idle_seconds >= settings.realtime_close_timeout_seconds:
            return "timeout"
        if not idle_warned and session.idle_seconds >= settings.realtime_idle_timeout_seconds:
            idle_warned = True
            try:
                await ws.send_json({"type": "session.idle"})
            except Exception:
                pass
        elif session.idle_seconds < settings.realtime_idle_timeout_seconds:
            idle_warned = False
        elapsed = asyncio.get_event_loop().time() - start_time
        if elapsed >= settings.realtime_max_session_seconds:
            return "max_duration"
    return None


@router.websocket("/dictate")
async def realtime_dictate(ws: WebSocket) -> None:
    """Realtime dictation endpoint for the standard chat input mic."""
    user: User | None = None
    auth_payload: dict[str, object] | None = None
    receive_task: asyncio.Task | None = None
    transcription_task: asyncio.Task[dict[str, str]] | None = None
    transcription_bridge: RealtimeTranscriptionBridge | None = None

    try:
        try:
            user, auth_payload = await _authenticate_websocket(ws)
        except ApiError as exc:
            await ws.accept()
            await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
            await ws.close(code=4001 if exc.status_code == 401 else 4003, reason=exc.message)
            return

        await ws.accept()
        if not await _ensure_model_api_configured(ws):
            return

        init_raw = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if init_raw.get("type") != "session.start":
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Expected session.start"})
            await ws.close()
            return

        conversation_id = init_raw.get("conversation_id")
        project_id = init_raw.get("project_id")
        if not conversation_id or not project_id:
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing conversation_id or project_id"})
            await ws.close()
            return

        db: Session = SessionLocal()
        try:
            _load_authorized_conversation(
                db,
                current_user_id=user.id,
                project_id=project_id,
                conversation_id=conversation_id,
            )
            realtime_asr_model_id = _resolve_realtime_asr_model_id(db, project_id)
        except ApiError as exc:
            await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
            await ws.close(code=4003, reason=exc.message)
            return
        finally:
            db.close()

        await ws.send_json({"type": "session.ready"})
        receive_task = asyncio.create_task(ws.receive())

        while True:
            wait_set: set[asyncio.Task] = {receive_task}
            if transcription_task is not None:
                wait_set.add(transcription_task)

            done, _pending = await asyncio.wait(wait_set, return_when=asyncio.FIRST_COMPLETED)

            if transcription_task is not None and transcription_task in done:
                event = transcription_task.result()
                event_type = event.get("type", "")

                if event_type == "transcript.partial":
                    await ws.send_json({"type": "transcript.partial", "text": event.get("text", "")})
                elif event_type == "transcript.final":
                    await ws.send_json({"type": "transcript.final", "text": event.get("text", "")})
                    await transcription_bridge.close()
                    transcription_bridge = None
                elif event_type == "transcript.empty":
                    await ws.send_json({
                        "type": "turn.notice",
                        "code": "empty_transcription",
                        "message": "未识别到语音，请重试。",
                    })
                    await transcription_bridge.close()
                    transcription_bridge = None
                elif event_type == "error":
                    await _send_error_and_close(
                        ws,
                        code="upstream_unavailable",
                        message="AI 暂时无响应，请重试",
                    )
                    break
                elif event_type == "session.closed":
                    transcription_bridge = None

                transcription_task = (
                    asyncio.create_task(transcription_bridge.next_event())
                    if transcription_bridge is not None
                    else None
                )

            if receive_task in done:
                try:
                    message = receive_task.result()
                except WebSocketDisconnect:
                    break

                if message["type"] == "websocket.disconnect":
                    break

                if "bytes" in message and message["bytes"]:
                    if transcription_bridge is None:
                        transcription_bridge = RealtimeTranscriptionBridge(model=realtime_asr_model_id)
                        try:
                            await asyncio.wait_for(
                                transcription_bridge.connect(),
                                timeout=UPSTREAM_CONNECT_TIMEOUT_SECONDS,
                            )
                        except TimeoutError:
                            await _send_error_and_close(
                                ws,
                                code="upstream_timeout",
                                message="AI 暂时无响应，请重试",
                                close_code=1013,
                            )
                            break
                        except UpstreamServiceError:
                            await _send_error_and_close(
                                ws,
                                code="upstream_unavailable",
                                message="AI 暂时无响应，请重试",
                            )
                            break
                        transcription_task = asyncio.create_task(transcription_bridge.next_event())
                    try:
                        await transcription_bridge.send_audio_chunk(message["bytes"])
                    except UpstreamServiceError:
                        await _send_error_and_close(
                            ws,
                            code="upstream_unavailable",
                            message="AI 暂时无响应，请重试",
                        )
                        break

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")
                    if msg_type == "session.end":
                        break
                    if msg_type == "audio.stop":
                        if transcription_bridge is None:
                            await ws.send_json({
                                "type": "turn.notice",
                                "code": "no_audio_input",
                                "message": "未检测到音频，请检查麦克风。",
                            })
                        else:
                            try:
                                await transcription_bridge.commit()
                            except UpstreamServiceError:
                                await _send_error_and_close(
                                    ws,
                                    code="upstream_unavailable",
                                    message="AI 暂时无响应，请重试",
                                )
                                break

                receive_task = asyncio.create_task(ws.receive())
    except Exception as exc:
        logger.exception("Realtime dictate error: %s", exc)
        try:
            await ws.send_json({"type": "error", "code": "internal", "message": "Internal server error"})
        except Exception:
            pass
    finally:
        if receive_task is not None and not receive_task.done():
            receive_task.cancel()
        if transcription_task is not None and not transcription_task.done():
            transcription_task.cancel()
        if transcription_bridge is not None:
            await transcription_bridge.close()
        if user is not None and auth_payload is not None and is_token_revoked_for_user(user.id, auth_payload):
            with suppress(Exception):
                await ws.close(code=4001, reason="auth_revoked")
            return
        with suppress(Exception):
            await ws.close()


@router.websocket("/voice")
async def realtime_voice(ws: WebSocket) -> None:
    """Full-duplex voice conversation WebSocket endpoint."""
    user: User | None = None
    auth_payload: dict[str, object] | None = None

    try:
        user, auth_payload = await _authenticate_websocket(ws)
    except ApiError as exc:
        await ws.accept()
        await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
        await ws.close(code=4001 if exc.status_code == 401 else 4003, reason=exc.message)
        return

    await ws.accept()
    if not await _ensure_model_api_configured(ws):
        return

    session: RealtimeSession | None = None

    try:
        init_raw = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if init_raw.get("type") != "session.start":
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Expected session.start"})
            await ws.close()
            return

        conversation_id = init_raw.get("conversation_id")
        project_id = init_raw.get("project_id")

        if not conversation_id or not project_id:
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing conversation_id or project_id"})
            await ws.close()
            return

        db: Session = SessionLocal()
        try:
            conversation, membership = _load_authorized_conversation(
                db,
                current_user_id=user.id,
                project_id=project_id,
                conversation_id=conversation_id,
            )
            session = RealtimeSession(
                workspace_id=conversation.workspace_id,
                project_id=conversation.project_id,
                conversation_id=conversation.id,
                user_id=user.id,
                upstream_model=_resolve_realtime_model_id(db, conversation.project_id),
                input_transcription_model=_resolve_realtime_asr_model_id(db, conversation.project_id),
            )

            if not await register_session(user.id, session):
                await ws.send_json({"type": "error", "code": "concurrent_limit", "message": "您已有一个进行中的对话"})
                await ws.close()
                return

            _ = membership
            system_prompt = await _load_initial_context(db, session)
        except ApiError as exc:
            await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
            await ws.close(code=4003, reason=exc.message)
            return
        finally:
            db.close()

        try:
            await asyncio.wait_for(
                session.connect_upstream(),
                timeout=UPSTREAM_CONNECT_TIMEOUT_SECONDS,
            )
            await asyncio.wait_for(
                session.send_initial_session_update(system_prompt),
                timeout=UPSTREAM_SESSION_UPDATE_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            await _send_error_and_close(
                ws,
                code="upstream_timeout",
                message="AI 暂时无响应",
                close_code=1013,
            )
            return
        except UpstreamServiceError as exc:
            logger.warning("Realtime upstream setup failed: %s", exc)
            await _send_error_and_close(
                ws,
                code="upstream_unavailable",
                message="AI 暂时无响应",
            )
            return
        except Exception as exc:
            logger.warning("Realtime upstream connection error: %s", exc)
            await _send_error_and_close(
                ws,
                code="upstream_unavailable",
                message="AI 暂时无响应",
            )
            return

        await ws.send_json({"type": "session.ready"})

        upstream_task = asyncio.create_task(_upstream_listener(ws, session))
        idle_task = asyncio.create_task(_idle_monitor(ws, session, auth_payload or {}))
        receive_task = asyncio.create_task(ws.receive())

        try:
            while True:
                done, _pending = await asyncio.wait(
                    {receive_task, upstream_task, idle_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )

                if upstream_task in done:
                    upstream_error = upstream_task.result()
                    if upstream_error:
                        await _send_error_and_close(
                            ws,
                            code=upstream_error["code"],
                            message=upstream_error["message"],
                        )
                    break

                if idle_task in done:
                    end_reason = idle_task.result()
                    if end_reason:
                        await _send_session_end(
                            ws,
                            reason=end_reason,
                            close_code=4001 if end_reason == "auth_revoked" else 1000,
                        )
                    break

                if receive_task in done:
                    try:
                        message = receive_task.result()
                    except WebSocketDisconnect:
                        break

                    if message["type"] == "websocket.disconnect":
                        break

                    if "bytes" in message and message["bytes"]:
                        await session.relay_audio_to_upstream(message["bytes"])

                    elif "text" in message and message["text"]:
                        data = json.loads(message["text"])
                        msg_type = data.get("type")

                        if msg_type == "session.end":
                            break
                        elif msg_type == "audio.stop" and session._upstream_ws:
                            await session._upstream_ws.send(
                                json.dumps({"type": "input_audio_buffer.commit"})
                            )
                        elif msg_type == "input.interrupt":
                            replies = await session.handle_client_message(msg_type, data)
                            for reply in replies:
                                await ws.send_json(reply)

                    receive_task = asyncio.create_task(ws.receive())
        except WebSocketDisconnect:
            pass
        finally:
            if not receive_task.done():
                receive_task.cancel()
            upstream_task.cancel()
            idle_task.cancel()

    except Exception as exc:
        logger.exception("Realtime voice error: %s", exc)
        try:
            await ws.send_json({"type": "error", "code": "internal", "message": "Internal server error"})
        except Exception:
            pass
    finally:
        if session:
            await session.close()
            await unregister_session(user.id if user else "")
        try:
            await ws.close()
        except Exception:
            pass


@router.websocket("/composed-voice")
async def composed_realtime_voice(ws: WebSocket) -> None:
    user: User | None = None
    auth_payload: dict[str, object] | None = None

    try:
        user, auth_payload = await _authenticate_websocket(ws)
    except ApiError as exc:
        await ws.accept()
        await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
        await ws.close(code=4001 if exc.status_code == 401 else 4003, reason=exc.message)
        return

    await ws.accept()
    if not await _ensure_model_api_configured(ws):
        return

    session: ComposedRealtimeSession | None = None
    llm_capabilities: set[str] = set()
    receive_task: asyncio.Task | None = None
    turn_task: asyncio.Task[dict[str, str] | None] | None = None
    transcription_task: asyncio.Task[dict[str, str]] | None = None
    transcription_bridge: RealtimeTranscriptionBridge | None = None
    idle_task: asyncio.Task[str | None] | None = None
    awaiting_transcript_final = False
    ignore_trailing_audio_until = 0.0
    realtime_asr_model_id = DEFAULT_PIPELINE_MODELS["realtime_asr"]
    try:
        init_raw = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if init_raw.get("type") != "session.start":
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Expected session.start"})
            await ws.close()
            return

        conversation_id = init_raw.get("conversation_id")
        project_id = init_raw.get("project_id")
        if not conversation_id or not project_id:
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing conversation_id or project_id"})
            await ws.close()
            return

        db: Session = SessionLocal()
        try:
            conversation, membership = _load_authorized_conversation(
                db,
                current_user_id=user.id,
                project_id=project_id,
                conversation_id=conversation_id,
            )
            llm_model_id, llm_capabilities = _load_llm_capabilities(db, conversation.project_id)
            realtime_asr_model_id = _resolve_realtime_asr_model_id(db, conversation.project_id)
            if "vision" not in llm_capabilities and "image" not in llm_capabilities:
                await _send_error_and_close(
                    ws,
                    code="unsupported_model",
                    message="Synthetic realtime requires a vision-capable chat model",
                )
                return

            session = ComposedRealtimeSession(
                workspace_id=conversation.workspace_id,
                project_id=conversation.project_id,
                conversation_id=conversation.id,
                user_id=user.id,
            )
            if not await register_session(user.id, session):  # type: ignore[arg-type]
                await ws.send_json({"type": "error", "code": "concurrent_limit", "message": "您已有一个进行中的对话"})
                await ws.close()
                return
            _ = membership
        except ApiError as exc:
            await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
            await ws.close(code=4003, reason=exc.message)
            return
        finally:
            db.close()

        await ws.send_json({"type": "session.ready"})

        idle_task = asyncio.create_task(_composed_idle_monitor(ws, session, auth_payload or {}))
        receive_task = asyncio.create_task(ws.receive())

        while True:
            wait_set: set[asyncio.Task] = {receive_task, idle_task}
            if turn_task is not None:
                wait_set.add(turn_task)
            if transcription_task is not None:
                wait_set.add(transcription_task)

            done, _pending = await asyncio.wait(wait_set, return_when=asyncio.FIRST_COMPLETED)

            if idle_task in done:
                end_reason = idle_task.result()
                if end_reason:
                    await _send_session_end(
                        ws,
                        reason=end_reason,
                        close_code=4001 if end_reason == "auth_revoked" else 1000,
                    )
                break

            if turn_task is not None and turn_task in done:
                try:
                    turn_result = turn_task.result()
                except asyncio.CancelledError:
                    turn_result = None
                except UpstreamServiceError:
                    logger.warning("Composed realtime turn failed due to upstream error", exc_info=True)
                    await ws.send_json({
                        "type": "turn.error",
                        "code": "upstream_unavailable",
                        "message": "AI 暂时无响应，请重试",
                    })
                    session.touch_activity()
                    turn_result = None
                except Exception:
                    logger.exception("Composed realtime turn failed")
                    await ws.send_json({
                        "type": "turn.error",
                        "code": "turn_failed",
                        "message": "本轮处理失败，请重试",
                    })
                    session.touch_activity()
                    turn_result = None

                if turn_result:
                    asyncio.create_task(
                        _persist_composed_turn(
                            session,
                            turn_result.get("user_text", "").strip(),
                            turn_result.get("assistant_text", "").strip(),
                        )
                    )
                turn_task = None

            if receive_task in done:
                try:
                    message = receive_task.result()
                except WebSocketDisconnect:
                    break

                if message["type"] == "websocket.disconnect":
                    break

                if "bytes" in message and message["bytes"]:
                    now = asyncio.get_running_loop().time()
                    if ignore_trailing_audio_until and now < ignore_trailing_audio_until:
                        session.touch_activity()
                        receive_task = asyncio.create_task(ws.receive())
                        continue
                    ignore_trailing_audio_until = 0.0
                    is_new_utterance = not session.has_buffered_audio
                    audio_chunk_forwarded = False
                    if is_new_utterance and session.is_processing:
                        interrupted = await session.interrupt()
                        if interrupted:
                            await ws.send_json({"type": "interrupt.ack"})
                            turn_task = None
                    if is_new_utterance:
                        session.clear_live_transcript()
                        awaiting_transcript_final = False
                    if transcription_bridge is None:
                        transcription_bridge = RealtimeTranscriptionBridge(model=realtime_asr_model_id)
                        try:
                            await asyncio.wait_for(
                                transcription_bridge.connect(),
                                timeout=UPSTREAM_CONNECT_TIMEOUT_SECONDS,
                            )
                        except TimeoutError:
                            logger.warning("Composed realtime ASR setup timed out")
                            await ws.send_json({
                                "type": "turn.error",
                                "code": "upstream_timeout",
                                "message": "AI 暂时无响应，请重试",
                            })
                            awaiting_transcript_final = False
                            session.clear_live_transcript()
                            session.clear_buffered_audio()
                            await transcription_bridge.close()
                            transcription_bridge = None
                        except UpstreamServiceError:
                            logger.warning("Composed realtime ASR setup failed", exc_info=True)
                            await ws.send_json({
                                "type": "turn.error",
                                "code": "upstream_unavailable",
                                "message": "AI 暂时无响应，请重试",
                            })
                            awaiting_transcript_final = False
                            session.clear_live_transcript()
                            session.clear_buffered_audio()
                            await transcription_bridge.close()
                            transcription_bridge = None
                        else:
                            transcription_task = asyncio.create_task(transcription_bridge.next_event())
                    if transcription_bridge is not None:
                        await transcription_bridge.send_audio_chunk(message["bytes"])
                        audio_chunk_forwarded = True
                    if audio_chunk_forwarded:
                        session.append_audio_chunk(message["bytes"])

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "session.end":
                        break
                    if msg_type == "audio.stop":
                        ignore_trailing_audio_until = 0.0
                        if transcription_bridge is None:
                            if not session.has_buffered_audio:
                                session.touch_activity()
                                receive_task = asyncio.create_task(ws.receive())
                                continue
                            maybe_task, consumed_media = await session.start_turn(ws)
                            if consumed_media:
                                await ws.send_json({"type": "media.cleared"})
                            if maybe_task is not None:
                                turn_task = maybe_task
                        else:
                            awaiting_transcript_final = True
                            await transcription_bridge.commit()
                    elif msg_type == "media.set":
                        data_url = str(data.get("data_url") or "")
                        filename = str(data.get("filename") or "")
                        if not data_url:
                            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing media payload"})
                        else:
                            try:
                                pending_media = decode_pending_media(data_url=data_url, filename=filename)
                                if pending_media.kind == "video" and "video" not in llm_capabilities:
                                    await ws.send_json({
                                        "type": "error",
                                        "code": "unsupported_video",
                                        "message": "Current chat model does not support video input",
                                    })
                                else:
                                    await ws.send_json(session.replace_pending_media(pending_media))
                            except ApiError as exc:
                                await ws.send_json({"type": "error", "code": exc.code, "message": exc.message})
                            except ValueError as exc:
                                await ws.send_json({"type": "error", "code": "bad_media", "message": str(exc)})
                    elif msg_type == "media.clear":
                        await ws.send_json(session.clear_pending_media())

                receive_task = asyncio.create_task(ws.receive())

            if transcription_task is not None and transcription_task in done:
                event = transcription_task.result()
                event_type = event.get("type", "")

                if event_type == "transcript.partial":
                    partial_text = event.get("text", "")
                    session.set_live_transcript(partial_text, final=False)
                    await ws.send_json({"type": "transcript.partial", "text": partial_text})
                elif event_type == "transcript.final":
                    final_text = event.get("text", "")
                    session.set_live_transcript(final_text, final=True)
                    await ws.send_json({"type": "transcript.final", "text": final_text})
                    auto_start_turn = (
                        not awaiting_transcript_final
                        and session.has_buffered_audio
                        and not session.is_processing
                    )
                    if awaiting_transcript_final or auto_start_turn:
                        maybe_task, consumed_media = await session.start_turn(ws)
                        if consumed_media:
                            await ws.send_json({"type": "media.cleared"})
                        if maybe_task is not None:
                            turn_task = maybe_task
                            ignore_trailing_audio_until = (
                                asyncio.get_running_loop().time() + COMPOSED_TRAILING_AUDIO_GRACE_SECONDS
                                if auto_start_turn
                                else 0.0
                            )
                        else:
                            ignore_trailing_audio_until = 0.0
                        awaiting_transcript_final = False
                        if transcription_bridge is not None:
                            await transcription_bridge.close()
                            transcription_bridge = None
                elif event_type == "transcript.empty":
                    session.clear_live_transcript()
                    auto_start_turn = (
                        not awaiting_transcript_final
                        and session.has_buffered_audio
                        and not session.is_processing
                    )
                    if awaiting_transcript_final or auto_start_turn:
                        maybe_task, consumed_media = await session.start_turn(ws)
                        if consumed_media:
                            await ws.send_json({"type": "media.cleared"})
                        if maybe_task is not None:
                            turn_task = maybe_task
                            ignore_trailing_audio_until = (
                                asyncio.get_running_loop().time() + COMPOSED_TRAILING_AUDIO_GRACE_SECONDS
                                if auto_start_turn
                                else 0.0
                            )
                        else:
                            ignore_trailing_audio_until = 0.0
                        awaiting_transcript_final = False
                        if transcription_bridge is not None:
                            await transcription_bridge.close()
                            transcription_bridge = None
                elif event_type == "error":
                    logger.warning("Composed realtime transcription bridge failed: %s", event.get("message", ""))
                    await ws.send_json({
                        "type": "turn.error",
                        "code": "upstream_unavailable",
                        "message": "AI 暂时无响应，请重试",
                    })
                    awaiting_transcript_final = False
                    session.clear_live_transcript()
                    session.clear_buffered_audio()
                    if transcription_bridge is not None:
                        await transcription_bridge.close()
                        transcription_bridge = None
                elif event_type == "session.closed":
                    transcription_bridge = None

                transcription_task = (
                    asyncio.create_task(transcription_bridge.next_event())
                    if transcription_bridge is not None
                    else None
                )

    except Exception as exc:
        logger.exception("Composed realtime voice error: %s", exc)
        try:
            await ws.send_json({"type": "error", "code": "internal", "message": "Internal server error"})
        except Exception:
            pass
    finally:
        if receive_task is not None and not receive_task.done():
            receive_task.cancel()
        if transcription_task is not None and not transcription_task.done():
            transcription_task.cancel()
        if idle_task is not None:
            idle_task.cancel()
        if transcription_bridge is not None:
            await transcription_bridge.close()
        if session is not None:
            await session.close()
            await unregister_session(user.id if user else "")
        try:
            await ws.close()
        except Exception:
            pass
