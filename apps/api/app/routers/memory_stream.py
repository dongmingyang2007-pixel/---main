import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    can_access_workspace_conversation,
    enforce_rate_limit,
    get_current_user,
    get_current_workspace_id,
    get_current_workspace_role,
    get_db_session,
)
from app.core.errors import ApiError
from app.models.entities import Conversation, Memory, Project, User
from app.services.memory_visibility import memory_visible_to_user

router = APIRouter(tags=["memory"])


def _build_memory_stream_response(
    request: Request,
    db: Session,
    *,
    current_user_id: str,
    workspace_role: str,
    workspace_id: str,
    project_id: str,
    conversation_id: str | None = None,
) -> StreamingResponse:
    async def event_generator():
        last_check = datetime.now(timezone.utc)

        while True:
            if await request.is_disconnected():
                break

            project = (
                db.query(Project)
                .filter(
                    Project.id == project_id,
                    Project.workspace_id == workspace_id,
                    Project.deleted_at.is_(None),
                )
                .first()
            )
            if not project:
                break

            conversation_created_by: str | None = None
            if conversation_id:
                conversation = (
                    db.query(Conversation)
                    .join(Project, Project.id == Conversation.project_id)
                    .filter(
                        Conversation.id == conversation_id,
                        Conversation.workspace_id == workspace_id,
                        Conversation.project_id == project_id,
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
                    break
                conversation_created_by = conversation.created_by

            new_memories_query = (
                db.query(Memory)
                .filter(
                    Memory.workspace_id == workspace_id,
                    Memory.project_id == project_id,
                    Memory.created_at > last_check,
                )
                .order_by(Memory.created_at)
            )
            if conversation_id:
                new_memories_query = new_memories_query.filter(
                    (Memory.type == "permanent") | (Memory.source_conversation_id == conversation_id)
                )

            new_memories = new_memories_query.all()
            conversation_ids = {
                mem.source_conversation_id
                for mem in new_memories
                if mem.type == "temporary" and mem.source_conversation_id
            }
            conversation_owner_by_id: dict[str, str | None] = {}
            if conversation_ids:
                conversations = (
                    db.query(Conversation)
                    .join(Project, Project.id == Conversation.project_id)
                    .filter(
                        Conversation.id.in_(conversation_ids),
                        Conversation.workspace_id == workspace_id,
                        Conversation.project_id == project_id,
                        Project.workspace_id == workspace_id,
                        Project.deleted_at.is_(None),
                    )
                    .all()
                )
                conversation_owner_by_id = {
                    conversation.id: conversation.created_by for conversation in conversations
                }
            new_memories = [
                mem
                for mem in new_memories
                if memory_visible_to_user(
                    mem,
                    current_user_id=current_user_id,
                    workspace_role=workspace_role,
                    conversation_created_by=(
                        conversation_created_by
                        if conversation_id and mem.source_conversation_id == conversation_id
                        else conversation_owner_by_id.get(mem.source_conversation_id or "")
                    ),
                )
            ]

            for mem in new_memories:
                event_data = {
                    "id": mem.id,
                    "workspace_id": mem.workspace_id,
                    "project_id": mem.project_id,
                    "content": mem.content,
                    "category": mem.category,
                    "type": mem.type,
                    "source_conversation_id": mem.source_conversation_id,
                    "parent_memory_id": mem.parent_memory_id,
                    "position_x": mem.position_x,
                    "position_y": mem.position_y,
                    "created_at": mem.created_at.isoformat(),
                    "updated_at": mem.updated_at.isoformat(),
                }
                yield f"event: new_memory\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            promoted_query = (
                db.query(Memory)
                .filter(
                    Memory.workspace_id == workspace_id,
                    Memory.project_id == project_id,
                    Memory.updated_at > last_check,
                    Memory.type == "permanent",
                )
            )
            if conversation_id:
                promoted_query = promoted_query.filter(
                    (Memory.source_conversation_id.is_(None)) | (Memory.source_conversation_id == conversation_id)
                )

            for mem in promoted_query.all():
                metadata = mem.metadata_json or {}
                if not metadata.get("promoted_by"):
                    continue
                if not memory_visible_to_user(
                    mem,
                    current_user_id=current_user_id,
                    workspace_role=workspace_role,
                    conversation_created_by=conversation_created_by,
                ):
                    continue
                event_data = {
                    "id": mem.id,
                    "type": "permanent",
                    "promoted_by": metadata.get("promoted_by"),
                }
                yield f"event: memory_promoted\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            last_check = datetime.now(timezone.utc)
            yield "event: ping\ndata: {}\n\n"
            db.expire_all()
            await asyncio.sleep(3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/v1/memory/{project_id}/stream")
async def memory_stream(
    project_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
):
    enforce_rate_limit(
        request,
        scope="memory-sse",
        identifier=current_user.id,
        limit=settings.sse_rate_limit_max,
        window_seconds=settings.sse_rate_limit_window_seconds,
    )
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)

    return _build_memory_stream_response(
        request,
        db,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        workspace_id=workspace_id,
        project_id=project_id,
    )


@router.get("/api/v1/chat/conversations/{conversation_id}/memory-stream")
async def conversation_memory_stream(
    conversation_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
):
    enforce_rate_limit(
        request,
        scope="memory-sse",
        identifier=current_user.id,
        limit=settings.sse_rate_limit_max,
        window_seconds=settings.sse_rate_limit_window_seconds,
    )
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
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        conversation_created_by=conversation.created_by,
    ):
        raise ApiError("not_found", "Conversation not found", status_code=404)

    return _build_memory_stream_response(
        request,
        db,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        workspace_id=workspace_id,
        project_id=conversation.project_id,
        conversation_id=conversation_id,
    )
