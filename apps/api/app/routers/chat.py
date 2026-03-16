import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_current_workspace_id, get_db_session, require_csrf_protection
from app.core.errors import ApiError
from app.models import Conversation, Memory, Message, Project, User
from app.schemas.conversation import ConversationCreate, ConversationOut, MessageCreate, MessageOut
from app.services.orchestrator import orchestrate_inference

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
