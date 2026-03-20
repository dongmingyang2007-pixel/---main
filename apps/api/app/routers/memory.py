import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    can_access_workspace_conversation,
    get_current_user,
    get_current_workspace_id,
    get_current_workspace_role,
    get_db_session,
    require_csrf_protection,
    require_workspace_write_access,
)
from app.core.errors import ApiError
from app.models import Conversation, DataItem, Dataset, Memory, MemoryEdge, MemoryFile, Project, User
from app.routers.utils import get_data_item_in_workspace
from app.schemas.memory import (
    MemoryCreate,
    MemoryDetailOut,
    MemoryEdgeCreate,
    MemoryFileAttachRequest,
    MemoryFileCandidateOut,
    MemoryEdgeOut,
    MemoryFileOut,
    MemoryGraphOut,
    MemoryOut,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryUpdate,
)
from app.services.embedding import embed_and_store, search_similar
from app.services.memory_file_context import sync_data_item_links_for_memory
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory
from app.services.memory_visibility import (
    build_private_memory_metadata,
    is_private_memory,
    memory_visible_to_user,
)

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


def _is_completed_data_item(item: DataItem) -> bool:
    status = (item.meta_json or {}).get("upload_status")
    return status in {None, "completed"}


def _conversation_visible_to_user(
    conversation: Conversation,
    *,
    current_user_id: str,
    workspace_role: str,
) -> bool:
    return can_access_workspace_conversation(
        current_user_id=current_user_id,
        workspace_role=workspace_role,
        conversation_created_by=conversation.created_by,
    )


def _verify_conversation_ownership(
    db: Session,
    *,
    conversation_id: str,
    project_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
) -> Conversation:
    conversation = (
        db.query(Conversation)
        .join(Project, Project.id == Conversation.project_id)
        .filter(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
            Conversation.workspace_id == workspace_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not conversation or not _conversation_visible_to_user(
        conversation,
        current_user_id=current_user_id,
        workspace_role=workspace_role,
    ):
        raise ApiError("not_found", "Conversation not found", status_code=404)
    return conversation


def _verify_parent_memory(
    db: Session,
    *,
    parent_memory_id: str,
    project_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
) -> Memory:
    parent = _get_accessible_memory_or_404(
        db,
        memory_id=parent_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user_id,
        workspace_role=workspace_role,
    )
    if parent.project_id != project_id:
        raise ApiError("not_found", "Parent memory not found", status_code=404)
    return parent


def _get_memory_or_404(db: Session, *, memory_id: str, workspace_id: str) -> Memory:
    memory = (
        db.query(Memory)
        .join(Project, Project.id == Memory.project_id)
        .filter(
            Memory.id == memory_id,
            Memory.workspace_id == workspace_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)
    return memory


def _get_accessible_memory_or_404(
    db: Session,
    *,
    memory_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
) -> Memory:
    memory = _get_memory_or_404(db, memory_id=memory_id, workspace_id=workspace_id)
    if memory.type == "temporary":
        if not memory.source_conversation_id:
            raise ApiError("not_found", "Memory not found", status_code=404)
        conversation = _verify_conversation_ownership(
            db,
            conversation_id=memory.source_conversation_id,
            project_id=memory.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user_id,
            workspace_role=workspace_role,
        )
        if not memory_visible_to_user(
            memory,
            current_user_id=current_user_id,
            workspace_role=workspace_role,
            conversation_created_by=conversation.created_by,
        ):
            raise ApiError("not_found", "Memory not found", status_code=404)
        return memory
    if not memory_visible_to_user(
        memory,
        current_user_id=current_user_id,
        workspace_role=workspace_role,
    ):
        raise ApiError("not_found", "Memory not found", status_code=404)
    return memory


def _filter_accessible_memories(
    db: Session,
    memories: list[Memory],
    *,
    project_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
) -> list[Memory]:
    temp_source_ids = {
        memory.source_conversation_id
        for memory in memories
        if memory.type == "temporary" and memory.source_conversation_id
    }
    conversations_by_id: dict[str, Conversation] = {}
    conversations = (
        db.query(Conversation)
        .join(Project, Project.id == Conversation.project_id)
        .filter(
            Conversation.id.in_(temp_source_ids),
            Conversation.project_id == project_id,
            Conversation.workspace_id == workspace_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .all()
    ) if temp_source_ids else []
    conversations_by_id = {conversation.id: conversation for conversation in conversations}

    filtered: list[Memory] = []
    for memory in memories:
        conversation_created_by = None
        if memory.type == "temporary":
            if not memory.source_conversation_id:
                continue
            conversation = conversations_by_id.get(memory.source_conversation_id)
            if not conversation:
                continue
            conversation_created_by = conversation.created_by
        if memory_visible_to_user(
            memory,
            current_user_id=current_user_id,
            workspace_role=workspace_role,
            conversation_created_by=conversation_created_by,
        ):
            filtered.append(memory)
    return filtered


def _delete_memory_embeddings(db: Session, memory_id: str) -> None:
    db.execute(
        sql_text("DELETE FROM embeddings WHERE memory_id = :memory_id"),
        {"memory_id": memory_id},
    )


def _sync_memory_embedding(memory: Memory, db: Session) -> None:
    if is_assistant_root_memory(memory) or not settings.dashscope_api_key or not memory.content.strip():
        return
    try:
        _delete_memory_embeddings(db, memory.id)
        db.commit()
        asyncio.run(
            embed_and_store(
                db,
                workspace_id=memory.workspace_id,
                project_id=memory.project_id,
                memory_id=memory.id,
                chunk_text=memory.content,
            )
        )
        if memory.type == "permanent" and not is_private_memory(memory):
            sync_data_item_links_for_memory(db, memory=memory)
    except Exception:  # noqa: BLE001
        db.rollback()


@router.get("", response_model=MemoryGraphOut)
def get_memory_graph(
    project_id: str = Query(...),
    conversation_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> MemoryGraphOut:
    project = _verify_project_ownership(db, project_id, workspace_id)
    if conversation_id:
        _verify_conversation_ownership(
            db,
            conversation_id=conversation_id,
            project_id=project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
    _, changed = ensure_project_assistant_root(db, project)
    if changed:
        db.commit()

    # All permanent nodes for this project
    permanent = (
        db.query(Memory)
        .filter(Memory.project_id == project_id, Memory.workspace_id == workspace_id, Memory.type == "permanent")
        .all()
    )
    permanent = _filter_accessible_memories(
        db,
        permanent,
        project_id=project_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    # Temporary nodes for given conversation (if provided)
    temporary: list[Memory] = []
    if conversation_id:
        temporary = (
            db.query(Memory)
            .filter(
                Memory.project_id == project_id,
                Memory.workspace_id == workspace_id,
                Memory.type == "temporary",
                Memory.source_conversation_id == conversation_id,
            )
            .all()
        )

    all_memories = permanent + temporary
    memories_by_id = {memory.id: memory for memory in all_memories}
    memory_ids = [m.id for m in all_memories]

    # All edges between the collected memory nodes
    edges: list[MemoryEdge] = []
    if memory_ids:
        edges = (
            db.query(MemoryEdge)
            .filter(MemoryEdge.source_memory_id.in_(memory_ids), MemoryEdge.target_memory_id.in_(memory_ids))
            .all()
        )

    file_nodes: list[MemoryOut] = []
    file_edges: list[MemoryEdgeOut] = []
    if memory_ids:
        memory_files = (
            db.query(MemoryFile, DataItem)
            .join(DataItem, DataItem.id == MemoryFile.data_item_id)
            .join(Dataset, Dataset.id == DataItem.dataset_id)
            .join(Project, Project.id == Dataset.project_id)
            .filter(
                MemoryFile.memory_id.in_(memory_ids),
                DataItem.deleted_at.is_(None),
                Dataset.deleted_at.is_(None),
                Project.deleted_at.is_(None),
                Project.workspace_id == workspace_id,
            )
            .all()
        )
        for memory_file, data_item in memory_files:
            if not _is_completed_data_item(data_item):
                continue
            parent_memory = memories_by_id.get(memory_file.memory_id)
            if not parent_memory:
                continue
            file_node_id = f"file:{memory_file.id}"
            filename = data_item.filename or data_item.object_key or data_item.id
            file_nodes.append(
                MemoryOut(
                    id=file_node_id,
                    workspace_id=parent_memory.workspace_id,
                    project_id=parent_memory.project_id,
                    content=filename,
                    category="file",
                    type="permanent",
                    source_conversation_id=None,
                    parent_memory_id=memory_file.memory_id,
                    position_x=None,
                    position_y=None,
                    metadata_json={
                        "node_kind": "file",
                        "memory_file_id": memory_file.id,
                        "memory_id": memory_file.memory_id,
                        "data_item_id": data_item.id,
                        "filename": filename,
                        "media_type": data_item.media_type,
                    },
                    created_at=memory_file.created_at,
                    updated_at=memory_file.created_at,
                )
            )
            file_edges.append(
                MemoryEdgeOut(
                    id=f"file-edge:{memory_file.id}",
                    source_memory_id=memory_file.memory_id,
                    target_memory_id=file_node_id,
                    edge_type="file",
                    strength=0.2,
                    created_at=memory_file.created_at,
                )
            )

    return MemoryGraphOut(
        nodes=[MemoryOut.model_validate(m, from_attributes=True) for m in all_memories] + file_nodes,
        edges=[MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges] + file_edges,
    )


@router.post("", response_model=MemoryOut)
def create_memory(
    payload: MemoryCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    project = _verify_project_ownership(db, payload.project_id, workspace_id)
    if payload.type not in {"permanent", "temporary"}:
        raise ApiError("bad_request", "Invalid memory type", status_code=400)
    if payload.type == "temporary" and not payload.source_conversation_id:
        raise ApiError(
            "bad_request",
            "Temporary memories must be linked to a conversation",
            status_code=400,
        )
    if payload.source_conversation_id:
        _verify_conversation_ownership(
            db,
            conversation_id=payload.source_conversation_id,
            project_id=payload.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
    root_memory, root_changed = ensure_project_assistant_root(db, project, reparent_orphans=True)
    if payload.parent_memory_id:
        _verify_parent_memory(
            db,
            parent_memory_id=payload.parent_memory_id,
            project_id=payload.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
    else:
        payload.parent_memory_id = root_memory.id

    memory = Memory(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        content=payload.content,
        category=payload.category,
        type=payload.type,
        source_conversation_id=payload.source_conversation_id,
        parent_memory_id=payload.parent_memory_id,
        position_x=payload.position_x,
        position_y=payload.position_y,
        metadata_json=payload.metadata_json,
    )
    db.add(memory)
    if root_changed:
        db.flush()
    db.commit()
    db.refresh(memory)
    _sync_memory_embedding(memory, db)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.get("/{memory_id}", response_model=MemoryDetailOut)
def get_memory_detail(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> MemoryDetailOut:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    edges = (
        db.query(MemoryEdge)
        .filter(
            (MemoryEdge.source_memory_id == memory_id) | (MemoryEdge.target_memory_id == memory_id)
        )
        .all()
    )

    connected_memory_ids = {
        edge.source_memory_id for edge in edges
    } | {
        edge.target_memory_id for edge in edges
    }
    connected_memories = (
        db.query(Memory)
        .filter(Memory.workspace_id == workspace_id, Memory.id.in_(connected_memory_ids))
        .all()
        if connected_memory_ids
        else []
    )
    visible_connected_ids = {
        item.id
        for item in _filter_accessible_memories(
            db,
            connected_memories,
            project_id=memory.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
    }
    edges = [
        edge
        for edge in edges
        if edge.source_memory_id in visible_connected_ids and edge.target_memory_id in visible_connected_ids
    ]

    files = (
        db.query(MemoryFile, DataItem)
        .join(DataItem, DataItem.id == MemoryFile.data_item_id)
        .join(Dataset, Dataset.id == DataItem.dataset_id)
        .join(Project, Project.id == Dataset.project_id)
        .filter(
            MemoryFile.memory_id == memory_id,
            DataItem.deleted_at.is_(None),
            Dataset.deleted_at.is_(None),
            Project.deleted_at.is_(None),
            Project.workspace_id == workspace_id,
        )
        .all()
    )

    result = MemoryDetailOut.model_validate(memory, from_attributes=True)
    result.edges = [MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges]
    result.files = [
        MemoryFileOut(
            id=memory_file.id,
            memory_id=memory_file.memory_id,
            data_item_id=memory_file.data_item_id,
            filename=data_item.filename,
            media_type=data_item.media_type,
            created_at=memory_file.created_at,
        )
        for memory_file, data_item in files
        if _is_completed_data_item(data_item)
    ]
    return result


@router.get("/{memory_id}/available-files", response_model=list[MemoryFileCandidateOut])
def list_available_memory_files(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[MemoryFileCandidateOut]:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    if is_assistant_root_memory(memory):
        raise ApiError("bad_request", "Assistant root memory cannot attach files", status_code=400)

    attached_item_ids = {
        item_id
        for item_id, in db.query(MemoryFile.data_item_id).filter(MemoryFile.memory_id == memory.id).all()
    }

    items = (
        db.query(DataItem)
        .join(Dataset, Dataset.id == DataItem.dataset_id)
        .join(Project, Project.id == Dataset.project_id)
        .filter(
            Project.id == memory.project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
            Dataset.deleted_at.is_(None),
            DataItem.deleted_at.is_(None),
        )
        .order_by(DataItem.created_at.desc())
        .all()
    )

    return [
        MemoryFileCandidateOut(
            id=item.id,
            dataset_id=item.dataset_id,
            filename=item.filename,
            media_type=item.media_type,
            created_at=item.created_at,
        )
        for item in items
        if item.id not in attached_item_ids and _is_completed_data_item(item)
    ][:100]


@router.post("/{memory_id}/files", response_model=MemoryFileOut)
def attach_memory_file(
    memory_id: str,
    payload: MemoryFileAttachRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> MemoryFileOut:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    if is_assistant_root_memory(memory):
        raise ApiError("bad_request", "Assistant root memory cannot attach files", status_code=400)
    data_item = get_data_item_in_workspace(db, data_item_id=payload.data_item_id, workspace_id=workspace_id)
    if not data_item or not _is_completed_data_item(data_item):
        raise ApiError("not_found", "Data item not found", status_code=404)

    dataset = (
        db.query(Dataset)
        .join(Project, Project.id == Dataset.project_id)
        .filter(
            Dataset.id == data_item.dataset_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
            Dataset.deleted_at.is_(None),
        )
        .first()
    )
    if not dataset or dataset.project_id != memory.project_id:
        raise ApiError("bad_request", "Cannot attach files across projects", status_code=400)

    existing = (
        db.query(MemoryFile)
        .filter(MemoryFile.memory_id == memory.id, MemoryFile.data_item_id == data_item.id)
        .first()
    )
    if existing:
        return MemoryFileOut(
            id=existing.id,
            memory_id=existing.memory_id,
            data_item_id=existing.data_item_id,
            filename=data_item.filename,
            media_type=data_item.media_type,
            created_at=existing.created_at,
        )

    memory_file = MemoryFile(memory_id=memory.id, data_item_id=data_item.id)
    db.add(memory_file)
    db.commit()
    db.refresh(memory_file)
    return MemoryFileOut(
        id=memory_file.id,
        memory_id=memory_file.memory_id,
        data_item_id=memory_file.data_item_id,
        filename=data_item.filename,
        media_type=data_item.media_type,
        created_at=memory_file.created_at,
    )


@router.delete("/files/{memory_file_id}")
def delete_memory_file(
    memory_file_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> Response:
    memory_file = (
        db.query(MemoryFile, Memory)
        .join(Memory, Memory.id == MemoryFile.memory_id)
        .filter(MemoryFile.id == memory_file_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not memory_file:
        raise ApiError("not_found", "Memory file not found", status_code=404)

    _, memory = memory_file
    _get_accessible_memory_or_404(
        db,
        memory_id=memory.id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    db.delete(memory_file[0])
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{memory_id}", response_model=MemoryOut)
def update_memory(
    memory_id: str,
    payload: MemoryUpdate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    if is_assistant_root_memory(memory):
        raise ApiError("bad_request", "Assistant root memory is system managed", status_code=400)

    if payload.content is not None:
        memory.content = payload.content
    if payload.category is not None:
        memory.category = payload.category
    if payload.parent_memory_id is not None:
        if payload.parent_memory_id == memory.id:
            raise ApiError("bad_request", "A memory cannot parent itself", status_code=400)
        _verify_parent_memory(
            db,
            parent_memory_id=payload.parent_memory_id,
            project_id=memory.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
        memory.parent_memory_id = payload.parent_memory_id
    if payload.position_x is not None:
        memory.position_x = payload.position_x
    if payload.position_y is not None:
        memory.position_y = payload.position_y
    if payload.metadata_json is not None:
        metadata = dict(payload.metadata_json)
        if is_private_memory(memory):
            metadata = build_private_memory_metadata(
                metadata,
                owner_user_id=(memory.metadata_json or {}).get("owner_user_id"),
            )
        memory.metadata_json = metadata
    memory.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(memory)
    _sync_memory_embedding(memory, db)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> Response:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    if is_assistant_root_memory(memory):
        raise ApiError("bad_request", "Assistant root memory cannot be deleted", status_code=400)

    project = _verify_project_ownership(db, memory.project_id, workspace_id)
    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
    replacement_parent_id = memory.parent_memory_id or (root_memory.id if root_memory.id != memory.id else None)
    children = (
        db.query(Memory)
        .filter(
            Memory.project_id == memory.project_id,
            Memory.workspace_id == workspace_id,
            Memory.parent_memory_id == memory.id,
        )
        .all()
    )
    for child in children:
        child.parent_memory_id = replacement_parent_id
        child.updated_at = datetime.now(timezone.utc)

    _delete_memory_embeddings(db, memory.id)
    db.delete(memory)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{memory_id}/promote", response_model=MemoryOut)
def promote_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    memory = _get_accessible_memory_or_404(
        db,
        memory_id=memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    if memory.type != "temporary":
        raise ApiError("bad_request", "Only temporary memories can be promoted", status_code=400)

    owner_user_id: str | None = None
    if memory.source_conversation_id:
        conversation = _verify_conversation_ownership(
            db,
            conversation_id=memory.source_conversation_id,
            project_id=memory.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
        owner_user_id = conversation.created_by

    memory.type = "permanent"
    metadata = dict(memory.metadata_json or {})
    metadata["promoted_by"] = "user"
    memory.metadata_json = build_private_memory_metadata(metadata, owner_user_id=owner_user_id)
    memory.source_conversation_id = None
    if memory.parent_memory_id is None:
        project = _verify_project_ownership(db, memory.project_id, workspace_id)
        root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
        memory.parent_memory_id = root_memory.id
    memory.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.post("/search", response_model=list[MemorySearchResult])
async def search_memory(
    payload: MemorySearchRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[MemorySearchResult]:
    project = _verify_project_ownership(db, payload.project_id, workspace_id)
    root_memory, root_changed = ensure_project_assistant_root(db, project, reparent_orphans=False)
    if root_changed:
        db.commit()

    try:
        results = await search_similar(
            db,
            workspace_id=workspace_id,
            project_id=payload.project_id,
            query=payload.query,
            limit=payload.top_k,
        )
    except Exception:  # noqa: BLE001
        query = (
            db.query(Memory)
            .filter(
                Memory.workspace_id == workspace_id,
                Memory.project_id == payload.project_id,
                Memory.id != root_memory.id,
                Memory.content.contains(payload.query),
            )
            .order_by(Memory.updated_at.desc())
            .limit(payload.top_k)
        )
        if payload.category:
            query = query.filter(Memory.category == payload.category)
        if payload.type:
            query = query.filter(Memory.type == payload.type)
        memories = query.all()
        memories = _filter_accessible_memories(
            db,
            memories,
            project_id=payload.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
        return [
            MemorySearchResult(
                memory=MemoryOut.model_validate(memory, from_attributes=True),
                score=1.0,
                chunk_text=memory.content,
            )
            for memory in memories
        ]

    memory_ids = [result["memory_id"] for result in results if result.get("memory_id")]
    memories_by_id = {
        memory.id: memory
        for memory in db.query(Memory)
        .filter(Memory.workspace_id == workspace_id, Memory.id.in_(memory_ids))
        .all()
    }
    accessible_memory_ids = {
        memory.id
        for memory in _filter_accessible_memories(
            db,
            list(memories_by_id.values()),
            project_id=payload.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
    }

    output: list[MemorySearchResult] = []
    for result in results:
        memory_id = result.get("memory_id")
        if not memory_id:
            continue
        memory = memories_by_id.get(memory_id)
        if not memory:
            continue
        if memory.id == root_memory.id:
            continue
        if memory.id not in accessible_memory_ids:
            continue
        if payload.category and memory.category != payload.category:
            continue
        if payload.type and memory.type != payload.type:
            continue
        output.append(
            MemorySearchResult(
                memory=MemoryOut.model_validate(memory, from_attributes=True),
                score=result.get("score", 0.0),
                chunk_text=result.get("chunk_text", memory.content),
            )
        )
    return output


@router.post("/edges", response_model=MemoryEdgeOut)
def create_edge(
    payload: MemoryEdgeCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> MemoryEdgeOut:
    # Verify both memories belong to the same workspace
    source = _get_accessible_memory_or_404(
        db,
        memory_id=payload.source_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    target = _get_accessible_memory_or_404(
        db,
        memory_id=payload.target_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    if not source or not target:
        raise ApiError("not_found", "Source or target memory not found", status_code=404)
    if source.project_id != target.project_id:
        raise ApiError("bad_request", "Cannot connect memories across projects", status_code=400)
    if source.id == target.id:
        raise ApiError("bad_request", "Cannot connect a memory to itself", status_code=400)
    if is_assistant_root_memory(source) or is_assistant_root_memory(target):
        raise ApiError("bad_request", "Assistant root memory cannot create manual edges", status_code=400)

    # Check for duplicate
    existing = (
        db.query(MemoryEdge)
        .filter(
            MemoryEdge.source_memory_id == payload.source_memory_id,
            MemoryEdge.target_memory_id == payload.target_memory_id,
        )
        .first()
    )
    if existing:
        raise ApiError("conflict", "Edge already exists between these memories", status_code=409)

    edge = MemoryEdge(
        source_memory_id=payload.source_memory_id,
        target_memory_id=payload.target_memory_id,
        edge_type="manual",
        strength=payload.strength,
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return MemoryEdgeOut.model_validate(edge, from_attributes=True)


@router.delete("/edges/{edge_id}")
def delete_edge(
    edge_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> Response:
    # Verify the edge belongs to a memory in the user's workspace
    edge = db.query(MemoryEdge).filter(MemoryEdge.id == edge_id).first()
    if not edge:
        raise ApiError("not_found", "Edge not found", status_code=404)

    _get_accessible_memory_or_404(
        db,
        memory_id=edge.source_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    _get_accessible_memory_or_404(
        db,
        memory_id=edge.target_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    db.delete(edge)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
