import base64
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_current_workspace_id, get_db_session, require_csrf_protection
from app.core.errors import ApiError
from app.models import Conversation, Memory, Message, Project, User
from app.schemas.conversation import ConversationCreate, ConversationOut, MessageCreate, MessageOut
from app.services.orchestrator import orchestrate_inference, orchestrate_voice_inference

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_MOCK_AI_RESPONSES = [
    "好的，我已经理解了您的需求。让我来帮您分析一下这个问题。",
    "这是一个很好的问题！根据我的分析，建议您可以从以下几个方面入手。",
    "收到！我正在处理您的请求，以下是我的初步建议。",
    "感谢您的提问。根据项目的上下文信息，我认为最佳方案如下。",
    "明白了。让我结合已有的记忆节点来为您提供更精准的回答。",
]


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    project_id: str = Query(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[ConversationOut]:
    _ = current_user
    _verify_project_ownership(db, project_id, workspace_id)

    conversations = (
        db.query(Conversation)
        .filter(Conversation.project_id == project_id, Conversation.workspace_id == workspace_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [ConversationOut.model_validate(c, from_attributes=True) for c in conversations]


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
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
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.workspace_id == workspace_id)
        .first()
    )
    if not conversation:
        raise ApiError("not_found", "Conversation not found", status_code=404)

    # Delete temporary memories linked to this conversation
    db.query(Memory).filter(
        Memory.source_conversation_id == conversation_id,
        Memory.type == "temporary",
    ).delete()

    # Delete the conversation (CASCADE handles messages)
    db.delete(conversation)
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[MessageOut]:
    _ = current_user
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.workspace_id == workspace_id)
        .first()
    )
    if not conversation:
        raise ApiError("not_found", "Conversation not found", status_code=404)

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
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> MessageOut:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.workspace_id == workspace_id)
        .first()
    )
    if not conversation:
        raise ApiError("not_found", "Conversation not found", status_code=404)

    # Save user message
    user_message = Message(
        conversation_id=conversation_id,
        role=payload.role,
        content=payload.content,
    )
    db.add(user_message)
    db.flush()

    # Generate AI response
    if not settings.dashscope_api_key:
        # Fallback to mock responses when no API key configured (local dev)
        ai_response_text = random.choice(_MOCK_AI_RESPONSES)  # noqa: S311
    else:
        # Load recent messages for context
        recent = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(20)
            .all()
        )
        recent_msgs = [{"role": m.role, "content": m.content} for m in reversed(recent)]

        # Real inference
        ai_response_text = await orchestrate_inference(
            db,
            workspace_id=workspace_id,
            project_id=conversation.project_id,
            conversation_id=conversation_id,
            user_message=payload.content,
            recent_messages=recent_msgs,
        )

    # Save AI response
    ai_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=ai_response_text,
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
# Voice & Image endpoints (full pipeline: ASR → LLM → TTS)
# ---------------------------------------------------------------------------


def _get_conversation_or_404(db: Session, conversation_id: str, workspace_id: str) -> Conversation:
    """Shared lookup used by voice / image endpoints."""
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.workspace_id == workspace_id)
        .first()
    )
    if not conversation:
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
    audio: UploadFile = File(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    """Accept an audio file, run ASR → LLM (with memory/RAG) → TTS, return
    the AI text response plus optional base64-encoded audio."""
    _ = current_user  # noqa: F841 — auth guard only
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id)

    audio_bytes = await audio.read()

    # Run full voice pipeline
    result = await orchestrate_voice_inference(
        db,
        workspace_id=workspace_id,
        project_id=conversation.project_id,
        conversation_id=conversation_id,
        audio_bytes=audio_bytes,
    )

    # Persist messages
    ai_msg = _save_pipeline_messages(db, conversation, result)

    # Async memory extraction
    _trigger_memory_extraction(
        workspace_id, conversation.project_id, conversation_id,
        result["text_input"], result["text_response"],
    )

    return _build_pipeline_response(ai_msg, result)


@router.post("/conversations/{conversation_id}/image")
async def send_image_message(
    conversation_id: str,
    image: UploadFile = File(...),
    audio: UploadFile | None = File(None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    """Accept an image (+ optional audio), run the multimodal pipeline:
    (optional ASR) + Vision/LLM → TTS, return text + optional audio."""
    _ = current_user  # noqa: F841 — auth guard only
    conversation = _get_conversation_or_404(db, conversation_id, workspace_id)

    image_bytes = await image.read()
    audio_bytes = (await audio.read()) if audio else None

    # Run full pipeline with image (and optional voice input)
    result = await orchestrate_voice_inference(
        db,
        workspace_id=workspace_id,
        project_id=conversation.project_id,
        conversation_id=conversation_id,
        audio_bytes=audio_bytes,
        image_bytes=image_bytes,
        text_input="请描述这张图片" if not audio_bytes else None,
    )

    # Persist messages
    ai_msg = _save_pipeline_messages(db, conversation, result)

    # Async memory extraction
    _trigger_memory_extraction(
        workspace_id, conversation.project_id, conversation_id,
        result["text_input"], result["text_response"],
    )

    return _build_pipeline_response(ai_msg, result)
