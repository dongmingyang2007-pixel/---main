"""WebSocket endpoint for real-time full-duplex voice conversation."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Conversation, Message, User
from app.core.security import decode_token
from app.services.context_loader import (
    build_system_prompt,
    extract_personality,
    filter_knowledge_chunks,
    load_conversation_context,
    load_permanent_memories,
    search_rag_knowledge,
)
from app.services.realtime_bridge import (
    RealtimeSession,
    register_session,
    unregister_session,
)
from app.tasks.worker_tasks import extract_memories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/realtime", tags=["realtime"])


async def _authenticate_websocket(ws: WebSocket) -> User | None:
    """Validate bearer token from query parameter."""
    token = ws.query_params.get("token")
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        db: Session = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            return user
        finally:
            db.close()
    except Exception:
        return None


async def _load_initial_context(
    db: Session,
    session: RealtimeSession,
) -> str:
    """Load personality, memories, recent messages and build system prompt."""
    project, conversation = load_conversation_context(
        db,
        workspace_id=session.workspace_id,
        project_id=session.project_id,
        conversation_id=session.conversation_id,
    )

    personality = extract_personality(project.description)

    memories = load_permanent_memories(
        db,
        workspace_id=session.workspace_id,
        project_id=session.project_id,
        conversation_created_by=conversation.created_by,
    )
    memory_texts = [m.content for m in memories if m.content]

    # Store on session for reuse during RAG context refresh
    session._personality = personality
    session._memory_texts = memory_texts

    return build_system_prompt(
        personality=personality,
        memories=memory_texts,
        knowledge_chunks=[],
    )


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

    # Async RAG search to enrich next turn context
    if session.turn_count % settings.realtime_rag_refresh_turns == 0:
        try:
            db: Session = SessionLocal()
            try:
                results = await search_rag_knowledge(
                    db,
                    workspace_id=session.workspace_id,
                    project_id=session.project_id,
                    query=user_text,
                    limit=5,
                )
                if results:
                    chunks = filter_knowledge_chunks(
                        db,
                        workspace_id=session.workspace_id,
                        project_id=session.project_id,
                        results=results,
                    )
                    chunk_texts = [c["chunk_text"] for c in chunks if c.get("chunk_text")]
                    if chunk_texts:
                        session._knowledge_chunks = chunk_texts
                        new_prompt = build_system_prompt(
                            personality=session._personality,
                            memories=session._memory_texts,
                            knowledge_chunks=session._knowledge_chunks,
                        )
                        await session.send_session_update(new_prompt)
            finally:
                db.close()
        except Exception:
            logger.exception("Failed to refresh RAG context")


async def _upstream_listener(
    ws: WebSocket,
    session: RealtimeSession,
) -> None:
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

    except Exception as exc:
        logger.warning("Upstream listener error: %s", exc)
        try:
            await ws.send_json({
                "type": "error",
                "code": "upstream_disconnected",
                "message": "AI 暂时无响应",
            })
        except Exception:
            pass


async def _idle_monitor(
    ws: WebSocket,
    session: RealtimeSession,
) -> None:
    """Monitor for idle timeout and max session duration."""
    start_time = asyncio.get_event_loop().time()
    idle_warned = False
    while session.state not in (session.state.CLOSING, session.state.CLOSED):
        await asyncio.sleep(5)
        if session.idle_seconds >= settings.realtime_close_timeout_seconds:
            try:
                await ws.send_json({"type": "session.end", "reason": "timeout"})
            except Exception:
                pass
            return
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
            try:
                await ws.send_json({"type": "session.end", "reason": "max_duration"})
            except Exception:
                pass
            return


@router.websocket("/voice")
async def realtime_voice(ws: WebSocket) -> None:
    """Full-duplex voice conversation WebSocket endpoint."""
    user = await _authenticate_websocket(ws)
    if not user:
        await ws.accept()
        await ws.send_json({"type": "error", "code": "unauthorized", "message": "Unauthorized"})
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()

    session: RealtimeSession | None = None

    try:
        init_raw = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if init_raw.get("type") != "session.start":
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Expected session.start"})
            await ws.close()
            return

        conversation_id = init_raw.get("conversation_id")
        project_id = init_raw.get("project_id")
        workspace_id = init_raw.get("workspace_id", "")

        if not conversation_id or not project_id:
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing conversation_id or project_id"})
            await ws.close()
            return

        session = RealtimeSession(
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_id=conversation_id,
            user_id=user.id,
        )

        if not await register_session(user.id, session):
            await ws.send_json({"type": "error", "code": "concurrent_limit", "message": "您已有一个进行中的对话"})
            await ws.close()
            return

        db: Session = SessionLocal()
        try:
            system_prompt = await _load_initial_context(db, session)
        finally:
            db.close()

        await session.connect_upstream()
        await session.send_session_update(system_prompt)

        await ws.send_json({"type": "session.ready"})

        upstream_task = asyncio.create_task(_upstream_listener(ws, session))
        idle_task = asyncio.create_task(_idle_monitor(ws, session))

        try:
            while True:
                message = await ws.receive()

                if message["type"] == "websocket.disconnect":
                    break

                if "bytes" in message and message["bytes"]:
                    await session.relay_audio_to_upstream(message["bytes"])

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "session.end":
                        break
                    elif msg_type == "audio.stop":
                        if session._upstream_ws:
                            await session._upstream_ws.send(
                                json.dumps({"type": "input_audio_buffer.commit"})
                            )
        except WebSocketDisconnect:
            pass
        finally:
            upstream_task.cancel()
            idle_task.cancel()

    except Exception as exc:
        logger.exception("Realtime voice error: %s", exc)
        try:
            await ws.send_json({"type": "error", "code": "internal", "message": str(exc)})
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
