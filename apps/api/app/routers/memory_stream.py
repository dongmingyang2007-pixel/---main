# apps/api/app/routers/memory_stream.py
import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import get_db_session, get_current_user, get_current_workspace_id
from app.models.entities import Memory, User

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


@router.get("/{project_id}/stream")
async def memory_stream(
    project_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
):
    """SSE endpoint that streams new memory events.
    The frontend connects to this and receives events when new memories are created."""

    async def event_generator():
        last_check = datetime.now(timezone.utc)

        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Poll for new memories since last check
            new_memories = (
                db.query(Memory)
                .filter(
                    Memory.workspace_id == workspace_id,
                    Memory.project_id == project_id,
                    Memory.created_at > last_check,
                )
                .order_by(Memory.created_at)
                .all()
            )

            for mem in new_memories:
                event_data = {
                    "id": mem.id,
                    "content": mem.content,
                    "category": mem.category,
                    "type": mem.type,
                    "source_conversation_id": mem.source_conversation_id,
                    "parent_memory_id": mem.parent_memory_id,
                    "created_at": mem.created_at.isoformat(),
                }
                yield f"event: new_memory\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            # Check for promoted memories (type changed to permanent)
            promoted = (
                db.query(Memory)
                .filter(
                    Memory.workspace_id == workspace_id,
                    Memory.project_id == project_id,
                    Memory.updated_at > last_check,
                    Memory.type == "permanent",
                )
                .all()
            )

            for mem in promoted:
                if mem.metadata_json.get("promoted_by"):
                    event_data = {
                        "id": mem.id,
                        "type": "permanent",
                        "promoted_by": mem.metadata_json.get("promoted_by"),
                    }
                    yield f"event: memory_promoted\ndata: {json.dumps(event_data, ensure_ascii=False)}\n\n"

            last_check = datetime.now(timezone.utc)

            # Send keepalive ping every 15 seconds
            yield f"event: ping\ndata: {{}}\n\n"

            # Refresh DB session to see new data
            db.expire_all()

            await asyncio.sleep(3)  # Poll every 3 seconds

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
