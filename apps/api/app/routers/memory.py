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
from app.routers.utils import get_data_item_in_workspace, get_project_in_workspace_or_404
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
    SubjectOverviewOut,
    SubjectResolveCandidate,
    SubjectResolveRequest,
    SubjectResolveResult,
    SubgraphOut,
    SubgraphRequest,
    MemoryUpdate,
)
from app.services.embedding import embed_and_store, search_similar
from app.services.memory_category_tree import ensure_project_category_tree
from app.services.memory_context import (
    expand_subject_subgraph,
    get_subject_overview,
    resolve_active_subjects,
    search_project_memories_for_tool,
)
from app.services.memory_graph_events import bump_project_memory_graph_revision
from app.services.memory_metadata import (
    ACTIVE_NODE_STATUS,
    FACT_NODE_TYPE,
    add_related_edge_exclusion,
    normalize_node_status,
    normalize_node_type,
    has_manual_parent_binding,
    is_concept_memory,
    is_category_path_memory,
    is_subject_memory,
    is_structural_only_memory,
    is_summary_memory,
    normalize_memory_metadata,
    remove_related_edge_exclusion,
    set_manual_parent_binding,
)
from app.services.memory_related_edges import (
    RELATED_EDGE_TYPE,
    ensure_project_prerequisite_edges,
    ensure_project_related_edges,
)
from app.services.memory_file_context import sync_data_item_links_for_memory
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory
from app.services.memory_visibility import (
    build_private_memory_metadata,
    is_private_memory,
    memory_visible_to_user,
)

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])
ORDINARY_PARENT_FORBIDDEN_MESSAGE = (
    "Ordinary memories must stay as leaf nodes. Use the project root, a subject, or a concept as the primary parent instead."
)


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


def _resolve_optional_conversation_context(
    db: Session,
    *,
    project_id: str,
    workspace_id: str,
    current_user_id: str,
    workspace_role: str,
    conversation_id: str | None,
) -> tuple[str, str | None]:
    if conversation_id:
        conversation = _verify_conversation_ownership(
            db,
            conversation_id=conversation_id,
            project_id=project_id,
            workspace_id=workspace_id,
            current_user_id=current_user_id,
            workspace_role=workspace_role,
        )
        return conversation.id, conversation.created_by
    return "", current_user_id


def _can_hold_primary_children(parent: Memory) -> bool:
    return (
        is_assistant_root_memory(parent)
        or is_subject_memory(parent)
        or is_concept_memory(parent)
    )


def _assert_supported_primary_parent(parent: Memory) -> None:
    if _can_hold_primary_children(parent):
        return
    raise ApiError(
        "bad_request",
        ORDINARY_PARENT_FORBIDDEN_MESSAGE,
        status_code=400,
    )


def _strip_parent_binding_fields(metadata: dict[str, object] | None) -> dict[str, object]:
    payload = dict(metadata or {})
    payload.pop("parent_binding", None)
    payload.pop("manual_parent_id", None)
    return payload


def _assert_primary_graph_metadata_allowed(metadata: dict[str, object]) -> None:
    if is_category_path_memory(metadata):
        raise ApiError(
            "bad_request",
            "Category-path nodes are a legacy derived view and cannot be created in the primary graph",
            status_code=400,
        )
    if is_summary_memory(metadata):
        raise ApiError(
            "bad_request",
            "Summary nodes are derived views and cannot be created in the primary graph",
            status_code=400,
        )


def _resolve_subject_memory_id(
    *,
    requested_subject_memory_id: str | None,
    parent: Memory | None,
    existing_subject_memory_id: str | None = None,
    node_type: str,
) -> str | None:
    if node_type == "subject":
        return None
    if isinstance(requested_subject_memory_id, str) and requested_subject_memory_id.strip():
        return requested_subject_memory_id.strip()
    if parent is not None:
        if is_subject_memory(parent):
            return parent.id
        if parent.subject_memory_id:
            return parent.subject_memory_id
    if isinstance(existing_subject_memory_id, str) and existing_subject_memory_id.strip():
        return existing_subject_memory_id.strip()
    return None


def _graph_parent_memory_id(memory: Memory, memories_by_id: dict[str, Memory], visible_ids: set[str]) -> str | None:
    current_id = memory.parent_memory_id
    visited: set[str] = set()
    while current_id:
        if current_id in visible_ids:
            return current_id
        if current_id in visited:
            return None
        visited.add(current_id)
        parent = memories_by_id.get(current_id)
        if parent is None:
            return None
        current_id = parent.parent_memory_id
    return None


def _memory_to_graph_out(
    memory: Memory,
    *,
    graph_parent_memory_id: str | None = None,
) -> MemoryOut:
    payload = MemoryOut.model_validate(memory, from_attributes=True)
    metadata = dict(payload.metadata_json or {})
    if graph_parent_memory_id and graph_parent_memory_id != payload.parent_memory_id:
        metadata["graph_parent_memory_id"] = graph_parent_memory_id
    else:
        metadata.pop("graph_parent_memory_id", None)
    payload.metadata_json = metadata
    return payload


def _assert_valid_parent_assignment(
    db: Session,
    *,
    memory_id: str,
    candidate_parent_id: str,
    workspace_id: str,
) -> None:
    current_id = candidate_parent_id
    visited: set[str] = set()
    while current_id:
        if current_id == memory_id:
            raise ApiError(
                "bad_request",
                "A memory cannot be reparented beneath one of its descendants",
                status_code=400,
            )
        if current_id in visited:
            raise ApiError("bad_request", "Memory hierarchy contains a cycle", status_code=400)
        visited.add(current_id)
        parent = (
            db.query(Memory.parent_memory_id)
            .filter(Memory.id == current_id, Memory.workspace_id == workspace_id)
            .first()
        )
        if parent is None:
            return
        current_id = parent[0] or ""


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
    if (
        is_assistant_root_memory(memory)
        or is_structural_only_memory(memory)
        or not settings.dashscope_api_key
        or not memory.content.strip()
    ):
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


def _trigger_memory_compaction(workspace_id: str, project_id: str) -> None:
    try:
        from app.tasks.worker_tasks import compact_project_memories_task

        if settings.env == "test":
            compact_project_memories_task(workspace_id, project_id)
        else:
            compact_project_memories_task.delay(workspace_id, project_id)
    except Exception:  # noqa: BLE001
        pass


def _sync_project_category_tree(db: Session, *, workspace_id: str, project_id: str) -> bool:
    summary = ensure_project_category_tree(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return any(summary.as_dict().values())


def _sync_project_related_edges(db: Session, *, workspace_id: str, project_id: str) -> bool:
    summary = ensure_project_related_edges(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    prerequisite_summary = ensure_project_prerequisite_edges(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return any(summary.as_dict().values()) or any(prerequisite_summary.as_dict().values())


def _bump_graph_revision(*, workspace_id: str, project_id: str) -> None:
    bump_project_memory_graph_revision(workspace_id=workspace_id, project_id=project_id)


@router.get("", response_model=MemoryGraphOut)
def get_memory_graph(
    project_id: str = Query(...),
    conversation_id: str | None = Query(default=None),
    include_temporary: bool = Query(default=False),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> MemoryGraphOut:
    project = get_project_in_workspace_or_404(db, project_id, workspace_id)
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
        _bump_graph_revision(workspace_id=workspace_id, project_id=project_id)

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
    elif include_temporary:
        temporary = (
            db.query(Memory)
            .filter(
                Memory.project_id == project_id,
                Memory.workspace_id == workspace_id,
                Memory.type == "temporary",
            )
            .all()
        )

    if temporary:
        temporary = _filter_accessible_memories(
            db,
            temporary,
            project_id=project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )

    all_memories = permanent + temporary
    memories_by_id = {memory.id: memory for memory in all_memories}
    visible_memories = [
        memory
        for memory in all_memories
        if not is_category_path_memory(memory) and not is_summary_memory(memory)
    ]
    visible_ids = {memory.id for memory in visible_memories}
    memory_ids = [m.id for m in visible_memories]

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
        nodes=[
            _memory_to_graph_out(
                memory,
                graph_parent_memory_id=_graph_parent_memory_id(
                    memory,
                    memories_by_id=memories_by_id,
                    visible_ids=visible_ids,
                ),
            )
            for memory in visible_memories
        ] + file_nodes,
        edges=[MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges] + file_edges,
    )


@router.post("/subjects/resolve", response_model=SubjectResolveResult)
async def resolve_subjects(
    payload: SubjectResolveRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> SubjectResolveResult:
    get_project_in_workspace_or_404(db, payload.project_id, workspace_id)
    conversation_id, conversation_created_by = _resolve_optional_conversation_context(
        db,
        project_id=payload.project_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        conversation_id=payload.conversation_id,
    )
    result = await resolve_active_subjects(
        db,
        workspace_id=workspace_id,
        project_id=payload.project_id,
        conversation_id=conversation_id,
        conversation_created_by=conversation_created_by,
        query=payload.query,
        semantic_search_fn=search_similar,
    )
    subjects = result.get("subjects", [])
    primary_subject = result.get("primary_subject")
    return SubjectResolveResult(
        primary_subject_id=primary_subject.id if primary_subject is not None else None,
        subjects=[
            SubjectResolveCandidate(
                subject_id=candidate.memory.id,
                confidence=candidate.semantic_score if candidate.semantic_score is not None else candidate.score,
                label=candidate.memory.content,
                subject_kind=candidate.memory.subject_kind,
                canonical_key=candidate.memory.canonical_key,
            )
            for candidate in subjects
        ],
    )


@router.get("/subjects/{subject_id}/overview", response_model=SubjectOverviewOut)
def get_subject_overview_route(
    subject_id: str,
    conversation_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> SubjectOverviewOut:
    subject = _get_accessible_memory_or_404(
        db,
        memory_id=subject_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    conversation_id, conversation_created_by = _resolve_optional_conversation_context(
        db,
        project_id=subject.project_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        conversation_id=conversation_id,
    )
    overview = get_subject_overview(
        db,
        workspace_id=workspace_id,
        project_id=subject.project_id,
        conversation_id=conversation_id,
        conversation_created_by=conversation_created_by,
        subject_id=subject_id,
    )
    if overview is None:
        raise ApiError("not_found", "Subject not found", status_code=404)
    return SubjectOverviewOut(
        subject=MemoryOut.model_validate(overview["subject"], from_attributes=True),
        concepts=[
            MemoryOut.model_validate(memory, from_attributes=True)
            for memory in overview.get("concepts", [])
        ],
        facts=[
            MemoryOut.model_validate(memory, from_attributes=True)
            for memory in overview.get("facts", [])
        ],
        suggested_paths=[
            path
            for path in overview.get("suggested_paths", [])
            if isinstance(path, str) and path.strip()
        ],
    )


@router.post("/subjects/{subject_id}/subgraph", response_model=SubgraphOut)
async def get_subject_subgraph_route(
    subject_id: str,
    payload: SubgraphRequest,
    conversation_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> SubgraphOut:
    subject = _get_accessible_memory_or_404(
        db,
        memory_id=subject_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    conversation_id, conversation_created_by = _resolve_optional_conversation_context(
        db,
        project_id=subject.project_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
        conversation_id=conversation_id,
    )
    subgraph = await expand_subject_subgraph(
        db,
        workspace_id=workspace_id,
        project_id=subject.project_id,
        conversation_id=conversation_id,
        conversation_created_by=conversation_created_by,
        subject_id=subject_id,
        query=payload.query,
        depth=payload.depth,
        edge_types=payload.edge_types,
        semantic_search_fn=search_similar,
    )
    if subgraph is None:
        raise ApiError("not_found", "Subject not found", status_code=404)
    return SubgraphOut(
        nodes=[
            MemoryOut.model_validate(memory, from_attributes=True)
            for memory in subgraph.get("nodes", [])
        ],
        edges=[
            MemoryEdgeOut.model_validate(edge)
            for edge in subgraph.get("edges", [])
        ],
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
    project = get_project_in_workspace_or_404(db, payload.project_id, workspace_id)
    parent_field_present = "parent_memory_id" in payload.model_fields_set
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
    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=True)
    requested_parent_id = payload.parent_memory_id
    requested_parent: Memory | None = None
    if requested_parent_id:
        requested_parent = _verify_parent_memory(
            db,
            parent_memory_id=requested_parent_id,
            project_id=payload.project_id,
            workspace_id=workspace_id,
            current_user_id=current_user.id,
            workspace_role=workspace_role,
        )
        _assert_supported_primary_parent(requested_parent)
    metadata_input = _strip_parent_binding_fields(payload.metadata_json)
    node_type = normalize_node_type(payload.node_type or metadata_input.get("node_type"), fallback=FACT_NODE_TYPE)
    if node_type == "root":
        raise ApiError("bad_request", "Root memory is system managed", status_code=400)
    if node_type == "subject" and requested_parent and not is_assistant_root_memory(requested_parent):
        raise ApiError("bad_request", "Subject nodes must be attached to the project root", status_code=400)
    resolved_parent_id = requested_parent_id or root_memory.id
    subject_kind = (
        str(payload.subject_kind or metadata_input.get("subject_kind") or "").strip().lower() or None
    )
    if node_type != "subject":
        subject_kind = None
    subject_memory_id = _resolve_subject_memory_id(
        requested_subject_memory_id=payload.subject_memory_id,
        parent=requested_parent,
        node_type=node_type,
    )
    node_status = normalize_node_status(payload.node_status or metadata_input.get("node_status"), fallback=ACTIVE_NODE_STATUS)
    metadata_input.update(
        {
            "node_type": node_type,
            "subject_kind": subject_kind,
            "subject_memory_id": subject_memory_id,
            "node_status": node_status,
        }
    )
    if payload.canonical_key:
        metadata_input["canonical_key"] = payload.canonical_key
    if parent_field_present:
        metadata_input = set_manual_parent_binding(
            metadata_input,
            parent_memory_id=(
                None if resolved_parent_id == root_memory.id else resolved_parent_id
            ),
        )
    normalized_metadata = normalize_memory_metadata(
        content=payload.content,
        category=payload.category,
        memory_type=payload.type,
        metadata=metadata_input,
    )
    _assert_primary_graph_metadata_allowed(normalized_metadata)

    memory = Memory(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        content=payload.content,
        category=payload.category,
        type=payload.type,
        node_type=node_type,
        subject_kind=subject_kind,
        source_conversation_id=payload.source_conversation_id,
        parent_memory_id=resolved_parent_id,
        subject_memory_id=subject_memory_id,
        node_status=node_status,
        canonical_key=payload.canonical_key or str(normalized_metadata.get("canonical_key") or "").strip() or None,
        position_x=payload.position_x,
        position_y=payload.position_y,
        metadata_json=normalized_metadata,
    )
    db.add(memory)
    db.flush()
    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=payload.project_id)
    db.refresh(memory)
    _sync_memory_embedding(memory, db)
    if memory.type == "permanent":
        if _sync_project_related_edges(db, workspace_id=workspace_id, project_id=memory.project_id):
            db.commit()
            _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    if memory.type == "permanent":
        _trigger_memory_compaction(workspace_id, memory.project_id)
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
    if is_category_path_memory(memory):
        raise ApiError("bad_request", "Category path nodes cannot attach files", status_code=400)

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
    if is_category_path_memory(memory):
        raise ApiError("bad_request", "Category path nodes cannot attach files", status_code=400)
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
    _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
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
    _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
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
    if is_category_path_memory(memory):
        raise ApiError("bad_request", "Category path nodes are system managed", status_code=400)
    if is_summary_memory(memory):
        raise ApiError("bad_request", "Summary nodes are derived views and cannot be edited directly", status_code=400)

    parent_field_present = "parent_memory_id" in payload.model_fields_set
    project = get_project_in_workspace_or_404(db, memory.project_id, workspace_id)
    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
    current_parent = db.get(Memory, memory.parent_memory_id) if memory.parent_memory_id else None

    if payload.content is not None:
        memory.content = payload.content
    if payload.category is not None:
        memory.category = payload.category
    metadata = dict(memory.metadata_json or {})
    if payload.metadata_json is not None:
        metadata.update(_strip_parent_binding_fields(payload.metadata_json))
    node_type = normalize_node_type(payload.node_type or metadata.get("node_type") or memory.node_type, fallback=FACT_NODE_TYPE)
    if node_type == "root":
        raise ApiError("bad_request", "Root memory is system managed", status_code=400)
    subject_kind = (
        str(payload.subject_kind or metadata.get("subject_kind") or memory.subject_kind or "").strip().lower() or None
    )
    if node_type != "subject":
        subject_kind = None
    parent_memory = current_parent
    if parent_field_present:
        requested_parent_id = payload.parent_memory_id
        if requested_parent_id:
            if requested_parent_id == memory.id:
                raise ApiError("bad_request", "A memory cannot parent itself", status_code=400)
            parent_memory = _verify_parent_memory(
                db,
                parent_memory_id=requested_parent_id,
                project_id=memory.project_id,
                workspace_id=workspace_id,
                current_user_id=current_user.id,
                workspace_role=workspace_role,
            )
            _assert_supported_primary_parent(parent_memory)
            if node_type == "subject" and not is_assistant_root_memory(parent_memory):
                raise ApiError("bad_request", "Subject nodes must be attached to the project root", status_code=400)
            _assert_valid_parent_assignment(
                db,
                memory_id=memory.id,
                candidate_parent_id=parent_memory.id,
                workspace_id=workspace_id,
            )
            memory.parent_memory_id = parent_memory.id
            metadata = set_manual_parent_binding(metadata, parent_memory_id=parent_memory.id)
        else:
            memory.parent_memory_id = root_memory.id
            parent_memory = root_memory
            metadata = set_manual_parent_binding(metadata, parent_memory_id=None)
    elif node_type == "subject" and memory.parent_memory_id != root_memory.id:
        memory.parent_memory_id = root_memory.id
        parent_memory = root_memory
    subject_memory_id = _resolve_subject_memory_id(
        requested_subject_memory_id=payload.subject_memory_id,
        parent=parent_memory,
        existing_subject_memory_id=memory.subject_memory_id,
        node_type=node_type,
    )
    node_status = normalize_node_status(payload.node_status or metadata.get("node_status") or memory.node_status, fallback=ACTIVE_NODE_STATUS)
    if payload.position_x is not None:
        memory.position_x = payload.position_x
    if payload.position_y is not None:
        memory.position_y = payload.position_y
    memory.node_type = node_type
    memory.subject_kind = subject_kind
    memory.subject_memory_id = subject_memory_id
    memory.node_status = node_status
    if is_private_memory(memory):
        metadata = build_private_memory_metadata(
            metadata,
            owner_user_id=(memory.metadata_json or {}).get("owner_user_id"),
        )
    metadata.update(
        {
            "node_type": node_type,
            "subject_kind": subject_kind,
            "subject_memory_id": subject_memory_id,
            "node_status": node_status,
        }
    )
    if payload.canonical_key:
        metadata["canonical_key"] = payload.canonical_key
    memory.metadata_json = normalize_memory_metadata(
        content=memory.content,
        category=memory.category,
        memory_type=memory.type,
        metadata=metadata,
    )
    _assert_primary_graph_metadata_allowed(memory.metadata_json)
    memory.canonical_key = (
        payload.canonical_key
        or str(memory.metadata_json.get("canonical_key") or "").strip()
        or memory.canonical_key
    )
    memory.updated_at = datetime.now(timezone.utc)

    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    db.refresh(memory)
    _sync_memory_embedding(memory, db)
    if memory.type == "permanent":
        if _sync_project_related_edges(db, workspace_id=workspace_id, project_id=memory.project_id):
            db.commit()
            _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    if memory.type == "permanent":
        _trigger_memory_compaction(workspace_id, memory.project_id)
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
    if is_category_path_memory(memory):
        raise ApiError("bad_request", "Category path nodes are system managed", status_code=400)

    project = get_project_in_workspace_or_404(db, memory.project_id, workspace_id)
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
        if has_manual_parent_binding(child):
            child.metadata_json = normalize_memory_metadata(
                content=child.content,
                category=child.category,
                memory_type=child.type,
                metadata=set_manual_parent_binding(
                    dict(child.metadata_json or {}),
                    parent_memory_id=(
                        None
                        if not replacement_parent_id or replacement_parent_id == root_memory.id
                        else replacement_parent_id
                    ),
                ),
            )
        child.updated_at = datetime.now(timezone.utc)

    _delete_memory_embeddings(db, memory.id)
    db.delete(memory)
    db.flush()
    _sync_project_category_tree(db, workspace_id=workspace_id, project_id=memory.project_id)
    _sync_project_related_edges(db, workspace_id=workspace_id, project_id=memory.project_id)
    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    _trigger_memory_compaction(workspace_id, memory.project_id)
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
    memory.metadata_json = normalize_memory_metadata(
        content=memory.content,
        category=memory.category,
        memory_type="permanent",
        metadata=build_private_memory_metadata(metadata, owner_user_id=owner_user_id),
    )
    memory.source_conversation_id = None
    if memory.parent_memory_id is None:
        project = get_project_in_workspace_or_404(db, memory.project_id, workspace_id)
        root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
        memory.parent_memory_id = root_memory.id
    memory.updated_at = datetime.now(timezone.utc)
    _sync_project_category_tree(db, workspace_id=workspace_id, project_id=memory.project_id)
    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    db.refresh(memory)
    _sync_memory_embedding(memory, db)
    if _sync_project_related_edges(db, workspace_id=workspace_id, project_id=memory.project_id):
        db.commit()
        _bump_graph_revision(workspace_id=workspace_id, project_id=memory.project_id)
    _trigger_memory_compaction(workspace_id, memory.project_id)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.post("/search", response_model=list[MemorySearchResult])
async def search_memory(
    payload: MemorySearchRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_role: str = Depends(get_current_workspace_role),
    workspace_id: str = Depends(get_current_workspace_id),
) -> list[MemorySearchResult]:
    project = get_project_in_workspace_or_404(db, payload.project_id, workspace_id)
    root_memory, root_changed = ensure_project_assistant_root(db, project, reparent_orphans=False)
    if root_changed:
        db.commit()
        _bump_graph_revision(workspace_id=workspace_id, project_id=payload.project_id)

    try:
        project_conversation = (
            db.query(Conversation)
            .filter(
                Conversation.workspace_id == workspace_id,
                Conversation.project_id == payload.project_id,
            )
            .order_by(Conversation.updated_at.desc())
            .first()
        )
        results = await search_project_memories_for_tool(
            db,
            workspace_id=workspace_id,
            project_id=payload.project_id,
            conversation_id=project_conversation.id if project_conversation else "",
            conversation_created_by=(
                project_conversation.created_by if project_conversation else current_user.id
            ),
            query=payload.query,
            top_k=payload.top_k,
            semantic_search_fn=search_similar,
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
        memories = [memory for memory in memories if not is_structural_only_memory(memory)]
        return [
            MemorySearchResult(
                memory=MemoryOut.model_validate(memory, from_attributes=True),
                score=1.0,
                chunk_text=memory.content,
            )
            for memory in memories
        ]

    memory_ids = [result["id"] for result in results if result.get("id")]
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
        memory_id = result.get("id")
        if not memory_id:
            continue
        memory = memories_by_id.get(memory_id)
        if not memory:
            continue
        if is_structural_only_memory(memory):
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
                score=float(result.get("score") or 0.0),
                chunk_text=str(result.get("content") or memory.content),
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
            (
                (MemoryEdge.source_memory_id == payload.source_memory_id)
                & (MemoryEdge.target_memory_id == payload.target_memory_id)
            )
            | (
                (MemoryEdge.source_memory_id == payload.target_memory_id)
                & (MemoryEdge.target_memory_id == payload.source_memory_id)
            )
        )
        .first()
    )
    if existing:
        if existing.edge_type == "manual":
            return MemoryEdgeOut.model_validate(existing, from_attributes=True)
        if existing.edge_type == RELATED_EDGE_TYPE:
            existing.edge_type = "manual"
            existing.strength = payload.strength
            source.metadata_json = normalize_memory_metadata(
                content=source.content,
                category=source.category,
                memory_type=source.type,
                metadata=remove_related_edge_exclusion(
                    dict(source.metadata_json or {}),
                    memory_id=target.id,
                ),
            )
            target.metadata_json = normalize_memory_metadata(
                content=target.content,
                category=target.category,
                memory_type=target.type,
                metadata=remove_related_edge_exclusion(
                    dict(target.metadata_json or {}),
                    memory_id=source.id,
                ),
            )
            db.commit()
            _bump_graph_revision(workspace_id=workspace_id, project_id=source.project_id)
            db.refresh(existing)
            return MemoryEdgeOut.model_validate(existing, from_attributes=True)
        raise ApiError("conflict", "Edge already exists between these memories", status_code=409)

    edge = MemoryEdge(
        source_memory_id=payload.source_memory_id,
        target_memory_id=payload.target_memory_id,
        edge_type="manual",
        strength=payload.strength,
    )
    source.metadata_json = normalize_memory_metadata(
        content=source.content,
        category=source.category,
        memory_type=source.type,
        metadata=remove_related_edge_exclusion(
            dict(source.metadata_json or {}),
            memory_id=target.id,
        ),
    )
    target.metadata_json = normalize_memory_metadata(
        content=target.content,
        category=target.category,
        memory_type=target.type,
        metadata=remove_related_edge_exclusion(
            dict(target.metadata_json or {}),
            memory_id=source.id,
        ),
    )
    db.add(edge)
    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=source.project_id)
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

    if edge.edge_type not in {"manual", RELATED_EDGE_TYPE}:
        raise ApiError("bad_request", "Only lateral relations can be removed here", status_code=400)

    source = _get_accessible_memory_or_404(
        db,
        memory_id=edge.source_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )
    target = _get_accessible_memory_or_404(
        db,
        memory_id=edge.target_memory_id,
        workspace_id=workspace_id,
        current_user_id=current_user.id,
        workspace_role=workspace_role,
    )

    source.metadata_json = normalize_memory_metadata(
        content=source.content,
        category=source.category,
        memory_type=source.type,
        metadata=add_related_edge_exclusion(
            dict(source.metadata_json or {}),
            memory_id=target.id,
        ),
    )
    target.metadata_json = normalize_memory_metadata(
        content=target.content,
        category=target.category,
        memory_type=target.type,
        metadata=add_related_edge_exclusion(
            dict(target.metadata_json or {}),
            memory_id=source.id,
        ),
    )
    db.delete(edge)
    db.commit()
    _bump_graph_revision(workspace_id=workspace_id, project_id=source.project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
