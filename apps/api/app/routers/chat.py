import base64
from datetime import datetime, timezone
import json
import logging
import re

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.deps import (
    can_access_workspace_conversation,
    enforce_rate_limit,
    get_current_user,
    get_current_workspace_id,
    get_current_workspace_role,
    get_db_session,
    is_workspace_privileged_role,
    require_workspace_write_access,
    require_csrf_protection,
)
from app.core.errors import ApiError
from app.models import Conversation, Memory, Message, Project, User
from app.schemas.conversation import ConversationCreate, ConversationOut, MessageCreate, MessageOut
from app.services.dashscope_client import InferenceTimeoutError, UpstreamServiceError
from app.services.orchestrator import (
    orchestrate_inference,
    orchestrate_inference_stream,
    orchestrate_voice_inference,
    synthesize_speech_for_project,
    transcribe_audio_input_for_project,
)
from app.services.upload_validation import (
    UPLOAD_SIGNATURE_READ_BYTES,
    validate_workspace_upload_signature,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_ALLOWED_AUDIO_MEDIA_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
}

_MODEL_API_UNCONFIGURED_MESSAGE = (
    "AI service is not configured. Set DASHSCOPE_API_KEY and restart the API service."
)

_SOCIAL_MESSAGES = {
    "hi",
    "hello",
    "hey",
    "yo",
    "ok",
    "okay",
    "thanks",
    "thankyou",
    "test",
    "你好",
    "您好",
    "嗨",
    "哈喽",
    "早上好",
    "中午好",
    "下午好",
    "晚上好",
    "在吗",
    "谢谢",
    "收到",
    "好的",
    "测试",
}
_SOCIAL_HINTS = ("你好", "您好", "嗨", "哈喽", "在吗", "谢谢", "收到", "好的")
_REASONING_HINTS = (
    "分析",
    "解释",
    "原因",
    "为什么",
    "如何",
    "怎么",
    "步骤",
    "方案",
    "计划",
    "设计",
    "比较",
    "对比",
    "优缺点",
    "排查",
    "调试",
    "修复",
    "推导",
    "总结",
    "归纳",
    "reason",
    "analy",
    "debug",
    "compare",
    "tradeoff",
    "plan",
    "strategy",
    "explain",
)


def _normalize_inference_result(result: str | dict) -> tuple[str, str | None]:
    if isinstance(result, str):
        return result, None
    return result.get("content", "") or "", result.get("reasoning_content")


def _normalize_media_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def _resolve_enable_thinking(preference: bool | None, text: str) -> bool:
    if preference is not None:
        return preference

    stripped = text.strip()
    if not stripped:
        return False

    lowered = stripped.casefold()
    normalized = re.sub(r"[\W_]+", "", lowered)
    if normalized in _SOCIAL_MESSAGES:
        return False
    if len(stripped) <= 12 and any(hint in stripped for hint in _SOCIAL_HINTS):
        return False
    if len(stripped) <= 24 and not any(hint in lowered for hint in _REASONING_HINTS):
        return False
    if any(hint in lowered for hint in _REASONING_HINTS):
        return True
    if "\n" in stripped or len(stripped) >= 80:
        return True
    return False


async def _read_validated_upload(upload: UploadFile, *, kind: str) -> bytes:
    content_type = _normalize_media_type(upload.content_type)
    if kind == "image":
        if content_type not in settings.demo_allowed_media_types:
            raise ApiError("unsupported_media_type", "Unsupported image upload type", status_code=415)
    elif kind == "audio":
        if content_type not in _ALLOWED_AUDIO_MEDIA_TYPES:
            raise ApiError("unsupported_media_type", "Unsupported audio upload type", status_code=415)
    else:
        raise ApiError("bad_request", "Unsupported upload kind", status_code=400)

    payload = await upload.read()
    if not payload:
        raise ApiError("empty_upload", f"{kind.capitalize()} upload is empty", status_code=400)

    max_bytes = settings.upload_max_mb * 1024 * 1024
    if len(payload) > max_bytes:
        raise ApiError(
            "payload_too_large",
            f"{kind.capitalize()} exceeds {settings.upload_max_mb}MB limit",
            status_code=413,
        )

    if kind == "image":
        validate_workspace_upload_signature(
            prefix=payload[:UPLOAD_SIGNATURE_READ_BYTES],
            media_type=content_type,
        )
    return payload


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


def _raise_inference_api_error(exc: Exception) -> None:
    if isinstance(exc, InferenceTimeoutError):
        raise ApiError("inference_timeout", "Inference timeout", status_code=503) from exc
    if isinstance(exc, UpstreamServiceError):
        raise ApiError(
            "model_api_unavailable",
            "Model API unavailable",
            status_code=502,
            details={"retry_after": 5},
        ) from exc
    raise exc


def _ensure_model_api_configured() -> None:
    if settings.dashscope_api_key:
        return
    raise ApiError(
        "model_api_unconfigured",
        _MODEL_API_UNCONFIGURED_MESSAGE,
        status_code=503,
    )


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    project_id: str = Query(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[ConversationOut]:
    _verify_project_ownership(db, project_id, workspace_id)

    conversations_query = db.query(Conversation).filter(
        Conversation.project_id == project_id,
        Conversation.workspace_id == workspace_id,
    )
    if not is_workspace_privileged_role(workspace_role):
        conversations_query = conversations_query.filter(Conversation.created_by == current_user.id)

    conversations = conversations_query.order_by(Conversation.updated_at.desc()).all()
    return [ConversationOut.model_validate(c, from_attributes=True) for c in conversations]


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> ConversationOut:
    _verify_project_ownership(db, payload.project_id, workspace_id)

    conversation = Conversation(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        title=payload.title,
        created_by=current_user.id,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return ConversationOut.model_validate(conversation, from_attributes=True)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> Response:
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)

    # Delete temporary memories linked to this conversation
    db.query(Memory).filter(
        Memory.source_conversation_id == conversation_id,
        Memory.type == "temporary",
        Memory.workspace_id == workspace_id,
    ).delete()

    # Delete the conversation (CASCADE handles messages)
    db.delete(conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[MessageOut]:
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    return [MessageOut.model_validate(m, from_attributes=True) for m in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def send_message(
    conversation_id: str,
    payload: MessageCreate,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> MessageOut:
    enforce_rate_limit(
        request,
        scope="chat-send",
        identifier=current_user.id,
        limit=10,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    # Save user message
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
    )
    db.add(user_message)
    db.flush()

    # Load recent messages for context
    recent = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.id != user_message.id,
        )
        .order_by(Message.created_at.desc())
        .limit(20)
        .all()
    )
    recent_msgs = [{"role": m.role, "content": m.content} for m in reversed(recent)]
    enable_thinking = _resolve_enable_thinking(payload.enable_thinking, payload.content)

    # Real inference
    try:
        inference_result = await orchestrate_inference(
            db,
            workspace_id=workspace_id,
            project_id=conversation.project_id,
            conversation_id=conversation_id,
            user_message=payload.content,
            recent_messages=recent_msgs,
            enable_thinking=enable_thinking,
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _raise_inference_api_error(exc)
    ai_response_text, ai_reasoning_content = _normalize_inference_result(inference_result)

    # Save AI response
    ai_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=ai_response_text,
        reasoning_content=ai_reasoning_content,
    )
    db.add(ai_message)

    # Update conversation.updated_at
    conversation.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(ai_message)

    # Trigger async memory extraction (non-fatal)
    if settings.dashscope_api_key:
        try:
            from app.tasks.worker_tasks import extract_memories

            extract_memories.delay(
                workspace_id,
                conversation.project_id,
                conversation_id,
                payload.content,
                ai_response_text,
            )
        except Exception:  # noqa: BLE001
            pass  # Celery failure is non-fatal

    return MessageOut.model_validate(ai_message, from_attributes=True)


# ---------------------------------------------------------------------------
# Streaming SSE endpoint
# ---------------------------------------------------------------------------


@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: str,
    payload: MessageCreate,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> StreamingResponse:
    """Stream the AI response as Server-Sent Events.

    The endpoint saves the user message immediately, streams tokens as they
    arrive from the model, then persists the complete assistant message and
    triggers async memory extraction when the stream finishes.
    """
    enforce_rate_limit(
        request,
        scope="chat-send",
        identifier=current_user.id,
        limit=10,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    # Save user message immediately
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
    )
    db.add(user_message)
    db.flush()

    # Load recent messages for context
    recent = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.id != user_message.id,
        )
        .order_by(Message.created_at.desc())
        .limit(20)
        .all()
    )
    recent_msgs = [{"role": m.role, "content": m.content} for m in reversed(recent)]
    enable_thinking = _resolve_enable_thinking(payload.enable_thinking, payload.content)

    async def _event_generator():
        """Yield SSE-formatted lines from the streaming orchestrator."""
        full_content = ""
        full_reasoning: str | None = None

        try:
            async for event in orchestrate_inference_stream(
                db,
                workspace_id=workspace_id,
                project_id=conversation.project_id,
                conversation_id=conversation_id,
                user_message=payload.content,
                recent_messages=recent_msgs,
                enable_thinking=enable_thinking,
                user_id=current_user.id,
            ):
                event_type = event["event"]
                data = event["data"]

                # Track accumulated content from the final event
                if event_type == "message_done":
                    full_content = data.get("content", "")
                    full_reasoning = data.get("reasoning_content")

                yield f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        except Exception as exc:  # noqa: BLE001
            logger.exception("SSE stream error")
            error_data = json.dumps({"message": str(exc)}, ensure_ascii=False)
            yield f"event: error\ndata: {error_data}\n\n"
            return

        # Save assistant message after stream completes
        try:
            ai_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_content,
                reasoning_content=full_reasoning,
            )
            db.add(ai_message)
            conversation.updated_at = datetime.now(timezone.utc)
            db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to persist streamed assistant message")
            db.rollback()

        # Trigger async memory extraction (non-fatal)
        _trigger_memory_extraction(
            workspace_id,
            conversation.project_id,
            conversation_id,
            payload.content,
            full_content,
        )

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Voice & Image endpoints (full pipeline: ASR → LLM → TTS)
# ---------------------------------------------------------------------------


def _get_conversation_or_404(
    db: Session,
    conversation_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
) -> Conversation:
    """Shared lookup used by voice / image endpoints."""
    conversation = (
        db.query(Conversation)
        .join(Project, Project.id == Conversation.project_id)
        .filter(
            Conversation.id == conversation_id,
            Conversation.workspace_id == workspace_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not conversation or not can_access_workspace_conversation(
        current_user_id=current_user_id,
        workspace_role=workspace_role,
        conversation_created_by=conversation.created_by,
    ):
        raise ApiError("not_found", "Conversation not found", status_code=404)
    return conversation


def _trigger_memory_extraction(
    workspace_id: str, project_id: str, conversation_id: str, user_text: str, ai_text: str
) -> None:
    """Fire-and-forget Celery task for memory extraction."""
    if not settings.dashscope_api_key:
        return
    try:
        from app.tasks.worker_tasks import extract_memories

        extract_memories.delay(workspace_id, project_id, conversation_id, user_text, ai_text)
    except Exception:  # noqa: BLE001
        pass  # Celery failure is non-fatal


def _save_pipeline_messages(
    db: Session,
    conversation: Conversation,
    result: dict,
) -> Message:
    """Persist user + assistant messages from a voice/image pipeline result.

    Returns the saved assistant Message (refreshed).
    """
    if result["text_input"]:
        user_msg = Message(
            conversation_id=conversation.id,
            role="user",
            content=result["text_input"],
        )
        db.add(user_msg)

    ai_msg = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=result["text_response"],
        reasoning_content=result.get("reasoning_content"),
    )
    db.add(ai_msg)
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ai_msg)
    return ai_msg


def _build_pipeline_response(ai_msg: Message, result: dict) -> dict:
    """Format the JSON response shared by voice & image endpoints."""
    return {
        "message": MessageOut.model_validate(ai_msg, from_attributes=True).model_dump(),
        "text_input": result["text_input"],
        "audio_response": (
            base64.b64encode(result["audio_response"]).decode()
            if result["audio_response"]
            else None
        ),
    }


@router.post("/conversations/{conversation_id}/voice")
async def send_voice_message(
    conversation_id: str,
    request: Request,
    audio: UploadFile = File(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> dict:
    """Accept an audio file, run ASR → LLM (with memory/RAG) → TTS, return
    the AI text response plus optional base64-encoded audio."""
    enforce_rate_limit(
        request,
        scope="chat-send",
        identifier=current_user.id,
        limit=10,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    audio_bytes = await _read_validated_upload(audio, kind="audio")

    # Run full voice pipeline
    try:
        result = await orchestrate_voice_inference(
            db,
            workspace_id=workspace_id,
            project_id=conversation.project_id,
            conversation_id=conversation_id,
            audio_bytes=audio_bytes,
            audio_filename=audio.filename or "recording.webm",
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _raise_inference_api_error(exc)

    # Persist messages
    ai_msg = _save_pipeline_messages(db, conversation, result)

    # Async memory extraction
    _trigger_memory_extraction(
        workspace_id, conversation.project_id, conversation_id,
        result["text_input"], result["text_response"],
    )

    return _build_pipeline_response(ai_msg, result)


@router.post("/conversations/{conversation_id}/dictate")
async def dictate_voice_input(
    conversation_id: str,
    request: Request,
    audio: UploadFile = File(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> dict:
    """Transcribe a recorded utterance into text without sending it to the model."""
    enforce_rate_limit(
        request,
        scope="chat-dictate",
        identifier=current_user.id,
        limit=10,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    audio_bytes = await _read_validated_upload(audio, kind="audio")

    try:
        text_input = await transcribe_audio_input_for_project(
            db,
            project_id=conversation.project_id,
            audio_bytes=audio_bytes,
            filename=audio.filename or "recording.webm",
        )
    except Exception as exc:  # noqa: BLE001
        _raise_inference_api_error(exc)

    return {"text_input": text_input.strip()}


@router.post("/conversations/{conversation_id}/speech")
async def synthesize_message_audio(
    conversation_id: str,
    payload: MessageCreate,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> dict:
    """Synthesize a text message into audio without creating new chat messages."""
    enforce_rate_limit(
        request,
        scope="chat-speech",
        identifier=current_user.id,
        limit=20,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    text = payload.content.strip()
    if not text:
        raise ApiError("bad_request", "Text is required", status_code=400)

    try:
        audio_response = await synthesize_speech_for_project(
            db,
            project_id=conversation.project_id,
            text=text,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_inference_api_error(exc)

    return {
        "audio_response": base64.b64encode(audio_response).decode(),
    }


@router.post("/conversations/{conversation_id}/image")
async def send_image_message(
    conversation_id: str,
    request: Request,
    image: UploadFile = File(...),
    audio: UploadFile | None = File(None),
    prompt: str | None = Form(None),
    enable_thinking: bool | None = Form(None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _csrf_guard: None = Depends(require_csrf_protection),
) -> dict:
    """Accept an image (+ optional audio), run the multimodal pipeline:
    (optional ASR) + Vision/LLM → TTS, return text + optional audio."""
    enforce_rate_limit(
        request,
        scope="chat-send",
        identifier=current_user.id,
        limit=10,
        window_seconds=60,
    )
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id, current_user.id, workspace_role)
    _ensure_model_api_configured()

    image_bytes = await _read_validated_upload(image, kind="image")
    audio_bytes = await _read_validated_upload(audio, kind="audio") if audio else None
    prompt_text = (prompt or "").strip()
    effective_prompt = prompt_text if (prompt_text and not audio_bytes) else ("请描述这张图片" if not audio_bytes else None)
    enable_thinking = _resolve_enable_thinking(enable_thinking, effective_prompt or "")

    # Run full pipeline with image (and optional voice input)
    try:
        result = await orchestrate_voice_inference(
            db,
            workspace_id=workspace_id,
            project_id=conversation.project_id,
            conversation_id=conversation_id,
            audio_bytes=audio_bytes,
            audio_filename=audio.filename if audio else None,
            image_bytes=image_bytes,
            image_mime_type=_normalize_media_type(image.content_type) or "image/jpeg",
            text_input=effective_prompt,
            enable_thinking=enable_thinking,
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _raise_inference_api_error(exc)

    # Persist messages
    ai_msg = _save_pipeline_messages(db, conversation, result)

    # Async memory extraction
    _trigger_memory_extraction(
        workspace_id, conversation.project_id, conversation_id,
        result["text_input"], result["text_response"],
    )

    return _build_pipeline_response(ai_msg, result)
