from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import or_, text as sql_text
from sqlalchemy.orm import Session

from app.models import Memory, MemoryEdge, Project
from app.services.memory_metadata import (
    CATEGORY_PATH_CONCEPT_SOURCE,
    CATEGORY_PATH_NODE_KIND,
    MEMORY_KIND_FACT,
    clear_manual_parent_binding,
    get_manual_parent_id,
    get_memory_category_path,
    get_memory_kind,
    has_manual_parent_binding,
    is_category_path_memory,
    is_concept_memory,
    is_summary_memory,
    normalize_category_path,
    normalize_memory_metadata,
    split_category_segments,
)
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory
from app.services.memory_visibility import (
    build_private_memory_metadata,
    get_memory_owner_user_id,
    is_private_memory,
)


@dataclass(slots=True)
class CategoryTreeSyncSummary:
    created_path_nodes: int = 0
    normalized_path_nodes: int = 0
    reparented_nodes: int = 0
    deleted_empty_path_nodes: int = 0
    created_auto_edges: int = 0
    deleted_auto_edges: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def _visibility_key(memory: Memory) -> str:
    if is_private_memory(memory):
        owner_user_id = get_memory_owner_user_id(memory)
        if owner_user_id:
            return f"private:{owner_user_id}"
    return "public"


def _visibility_key_for_owner(owner_user_id: str | None) -> str:
    return f"private:{owner_user_id}" if owner_user_id else "public"


def _same_visibility(memory: Memory, *, owner_user_id: str | None) -> bool:
    return _visibility_key(memory) == _visibility_key_for_owner(owner_user_id)


def _compatible_category_paths(child_category: str, parent_category: str) -> bool:
    child_path = normalize_category_path(child_category)
    parent_path = normalize_category_path(parent_category)
    if not child_path or not parent_path:
        return False
    return (
        child_path == parent_path
        or child_path.startswith(f"{parent_path}.")
        or parent_path.startswith(f"{child_path}.")
    )


def _is_preservable_parent(candidate: Memory | None, child: Memory) -> bool:
    if candidate is None or is_assistant_root_memory(candidate):
        return False
    if is_category_path_memory(candidate):
        return False
    if not (is_concept_memory(candidate) or is_summary_memory(candidate)):
        return False
    child_owner_user_id = get_memory_owner_user_id(child) if is_private_memory(child) else None
    if not _same_visibility(candidate, owner_user_id=child_owner_user_id):
        return False
    return _compatible_category_paths(child.category, candidate.category)


def _would_create_cycle(
    *,
    memory_id: str,
    candidate_parent_id: str,
    memories_by_id: dict[str, Memory],
) -> bool:
    current_id = candidate_parent_id
    visited: set[str] = set()
    while current_id:
        if current_id == memory_id:
            return True
        if current_id in visited:
            return True
        visited.add(current_id)
        current = memories_by_id.get(current_id)
        if current is None or is_assistant_root_memory(current):
            return False
        current_id = current.parent_memory_id or ""
    return False


def _delete_memory(db: Session, memory_or_id: Memory | str) -> None:
    memory_id = memory_or_id.id if isinstance(memory_or_id, Memory) else memory_or_id
    db.query(MemoryEdge).filter(
        or_(
            MemoryEdge.source_memory_id == memory_id,
            MemoryEdge.target_memory_id == memory_id,
        )
    ).delete(synchronize_session=False)
    db.execute(sql_text("DELETE FROM embeddings WHERE memory_id = :memory_id"), {"memory_id": memory_id})
    if isinstance(memory_or_id, Memory):
        db.delete(memory_or_id)
        return
    db.query(Memory).filter(Memory.id == memory_id).delete(synchronize_session=False)


def _ensure_path_node(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    root_memory: Memory,
    owner_user_id: str | None,
    category_path: str,
    memory_kind: str,
    path_nodes_by_key: dict[tuple[str, str], Memory],
    summary: CategoryTreeSyncSummary,
) -> Memory:
    key = (_visibility_key_for_owner(owner_user_id), category_path)
    existing = path_nodes_by_key.get(key)
    segments = split_category_segments(category_path)
    label = segments[-1] if segments else category_path
    parent_path = ".".join(segments[:-1]) if len(segments) > 1 else ""
    parent_key = (_visibility_key_for_owner(owner_user_id), parent_path)
    parent_node = path_nodes_by_key.get(parent_key) if parent_path else None
    desired_parent_id = parent_node.id if parent_node else root_memory.id

    if existing is not None:
        metadata = dict(existing.metadata_json or {})
        metadata.update(
            {
                "node_kind": CATEGORY_PATH_NODE_KIND,
                "concept_source": CATEGORY_PATH_CONCEPT_SOURCE,
                "structural_only": True,
                "auto_generated": True,
                "category_depth": len(segments),
                "source": "category_path_tree",
            }
        )
        if owner_user_id:
            metadata = build_private_memory_metadata(metadata, owner_user_id=owner_user_id)
        normalized_metadata = normalize_memory_metadata(
            content=label,
            category=category_path,
            memory_type="permanent",
            metadata={
                **metadata,
                "memory_kind": memory_kind or MEMORY_KIND_FACT,
            },
        )
        changed = False
        if existing.content != label:
            existing.content = label
            changed = True
        if existing.category != category_path:
            existing.category = category_path
            changed = True
        if existing.parent_memory_id != desired_parent_id:
            existing.parent_memory_id = desired_parent_id
            changed = True
        if existing.metadata_json != normalized_metadata:
            existing.metadata_json = normalized_metadata
            changed = True
        if changed:
            summary.normalized_path_nodes += 1
        return existing

    metadata: dict[str, object] = {
        "node_kind": CATEGORY_PATH_NODE_KIND,
        "concept_source": CATEGORY_PATH_CONCEPT_SOURCE,
        "structural_only": True,
        "auto_generated": True,
        "category_depth": len(segments),
        "memory_kind": memory_kind or MEMORY_KIND_FACT,
        "source": "category_path_tree",
        "salience": 0.24,
    }
    if owner_user_id:
        metadata = build_private_memory_metadata(metadata, owner_user_id=owner_user_id)
    node = Memory(
        workspace_id=workspace_id,
        project_id=project_id,
        content=label,
        category=category_path,
        type="permanent",
        source_conversation_id=None,
        parent_memory_id=desired_parent_id,
        metadata_json=normalize_memory_metadata(
            content=label,
            category=category_path,
            memory_type="permanent",
            metadata=metadata,
        ),
    )
    db.add(node)
    db.flush()
    path_nodes_by_key[key] = node
    summary.created_path_nodes += 1
    return node


def _ensure_memory_path_nodes(
    db: Session,
    *,
    memory: Memory,
    root_memory: Memory,
    path_nodes_by_key: dict[tuple[str, str], Memory],
    summary: CategoryTreeSyncSummary,
) -> Memory | None:
    category_path = get_memory_category_path(memory)
    if not category_path:
        return None
    owner_user_id = get_memory_owner_user_id(memory) if is_private_memory(memory) else None
    path_node: Memory | None = None
    for prefix in [
        ".".join(split_category_segments(category_path)[:index])
        for index in range(1, len(split_category_segments(category_path)) + 1)
    ]:
        path_node = _ensure_path_node(
            db,
            workspace_id=memory.workspace_id,
            project_id=memory.project_id,
            root_memory=root_memory,
            owner_user_id=owner_user_id,
            category_path=prefix,
            memory_kind=MEMORY_KIND_FACT if is_summary_memory(memory) else get_memory_kind(memory),
            path_nodes_by_key=path_nodes_by_key,
            summary=summary,
        )
    return path_node


def _desired_parent_id(
    *,
    memory: Memory,
    root_memory: Memory,
    memories_by_id: dict[str, Memory],
    path_nodes_by_key: dict[tuple[str, str], Memory],
) -> str:
    current_parent = memories_by_id.get(memory.parent_memory_id or "")

    if is_category_path_memory(memory):
        owner_user_id = get_memory_owner_user_id(memory) if is_private_memory(memory) else None
        category_path = get_memory_category_path(memory)
        segments = split_category_segments(category_path)
        if len(segments) <= 1:
            return root_memory.id
        parent_path = ".".join(segments[:-1])
        parent_node = path_nodes_by_key.get((_visibility_key_for_owner(owner_user_id), parent_path))
        return parent_node.id if parent_node else root_memory.id

    if has_manual_parent_binding(memory):
        manual_parent_id = get_manual_parent_id(memory)
        if not manual_parent_id or manual_parent_id == root_memory.id:
            return root_memory.id
        manual_parent = memories_by_id.get(manual_parent_id)
        if manual_parent is None or is_assistant_root_memory(manual_parent):
            return root_memory.id
        if not (
            is_category_path_memory(manual_parent)
            or is_concept_memory(manual_parent)
            or is_summary_memory(manual_parent)
        ):
            return root_memory.id
        if _would_create_cycle(
            memory_id=memory.id,
            candidate_parent_id=manual_parent.id,
            memories_by_id=memories_by_id,
        ):
            return root_memory.id
        return manual_parent.id

    if current_parent is None or is_assistant_root_memory(current_parent):
        return root_memory.id
    if _is_preservable_parent(current_parent, memory):
        return current_parent.id

    return root_memory.id


def _manual_parent_binding_is_supported(
    *,
    memory: Memory,
    root_memory: Memory,
    memories_by_id: dict[str, Memory],
) -> bool:
    if not has_manual_parent_binding(memory):
        return True
    manual_parent_id = get_manual_parent_id(memory)
    if not manual_parent_id or manual_parent_id == root_memory.id:
        return True
    manual_parent = memories_by_id.get(manual_parent_id)
    if manual_parent is None or is_assistant_root_memory(manual_parent):
        return False
    if not (
        is_category_path_memory(manual_parent)
        or is_concept_memory(manual_parent)
        or is_summary_memory(manual_parent)
    ):
        return False
    return not _would_create_cycle(
        memory_id=memory.id,
        candidate_parent_id=manual_parent.id,
        memories_by_id=memories_by_id,
    )


def _sync_structural_auto_edges(
    db: Session,
    *,
    memories_by_id: dict[str, Memory],
    summary: CategoryTreeSyncSummary,
) -> None:
    valid_auto_edges = {
        (memory.parent_memory_id, memory.id)
        for memory in memories_by_id.values()
        if memory.parent_memory_id
        and memory.parent_memory_id in memories_by_id
        and not is_assistant_root_memory(memories_by_id[memory.parent_memory_id])
        and (
            is_concept_memory(memories_by_id[memory.parent_memory_id])
            or is_category_path_memory(memories_by_id[memory.parent_memory_id])
            or is_summary_memory(memories_by_id[memory.parent_memory_id])
        )
    }

    auto_edges = (
        db.query(MemoryEdge)
        .filter(
            MemoryEdge.edge_type == "auto",
            MemoryEdge.source_memory_id.in_(list(memories_by_id)),
            MemoryEdge.target_memory_id.in_(list(memories_by_id)),
        )
        .all()
    )
    existing_pairs = {(edge.source_memory_id, edge.target_memory_id): edge for edge in auto_edges}

    for edge in auto_edges:
        pair = (edge.source_memory_id, edge.target_memory_id)
        source = memories_by_id.get(edge.source_memory_id)
        if pair not in valid_auto_edges or source is None or (
            not is_concept_memory(source)
            and not is_category_path_memory(source)
            and not is_summary_memory(source)
        ):
            db.delete(edge)
            summary.deleted_auto_edges += 1

    for source_memory_id, target_memory_id in sorted(valid_auto_edges):
        if (source_memory_id, target_memory_id) in existing_pairs:
            continue
        db.add(
            MemoryEdge(
                source_memory_id=source_memory_id,
                target_memory_id=target_memory_id,
                edge_type="auto",
                strength=0.76,
            )
        )
        summary.created_auto_edges += 1


def _prune_empty_path_nodes(
    db: Session,
    *,
    memories_by_id: dict[str, Memory],
    path_nodes_by_key: dict[tuple[str, str], Memory],
    summary: CategoryTreeSyncSummary,
) -> None:
    while True:
        child_counts: dict[str, int] = {}
        for memory in memories_by_id.values():
            if memory.parent_memory_id:
                child_counts[memory.parent_memory_id] = child_counts.get(memory.parent_memory_id, 0) + 1
        empty_nodes = [
            memory
            for memory in memories_by_id.values()
            if is_category_path_memory(memory) and child_counts.get(memory.id, 0) == 0
        ]
        if not empty_nodes:
            return
        for memory in empty_nodes:
            memories_by_id.pop(memory.id, None)
            key = (_visibility_key(memory), get_memory_category_path(memory))
            path_nodes_by_key.pop(key, None)
            _delete_memory(db, memory)
            summary.deleted_empty_path_nodes += 1


def ensure_project_category_tree(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
) -> CategoryTreeSyncSummary:
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if project is None:
        return CategoryTreeSyncSummary()

    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
    summary = CategoryTreeSyncSummary()
    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in memories}
    path_nodes_by_key: dict[tuple[str, str], Memory] = {}
    for memory in memories:
        if is_category_path_memory(memory):
            path_nodes_by_key[(_visibility_key(memory), get_memory_category_path(memory))] = memory

    materialized_memories = [
        memory
        for memory in memories
        if not is_assistant_root_memory(memory)
    ]

    for memory in materialized_memories:
        if is_category_path_memory(memory):
            continue
        _ensure_memory_path_nodes(
            db,
            memory=memory,
            root_memory=root_memory,
            path_nodes_by_key=path_nodes_by_key,
            summary=summary,
        )

    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in memories}
    for memory in memories:
        if is_assistant_root_memory(memory):
            continue
        if not _manual_parent_binding_is_supported(
            memory=memory,
            root_memory=root_memory,
            memories_by_id=memories_by_id,
        ):
            memory.metadata_json = normalize_memory_metadata(
                content=memory.content,
                category=memory.category,
                memory_type=memory.type,
                metadata=clear_manual_parent_binding(dict(memory.metadata_json or {})),
            )
        desired_parent_id = _desired_parent_id(
            memory=memory,
            root_memory=root_memory,
            memories_by_id=memories_by_id,
            path_nodes_by_key=path_nodes_by_key,
        )
        if memory.parent_memory_id != desired_parent_id:
            memory.parent_memory_id = desired_parent_id
            summary.reparented_nodes += 1

    _prune_empty_path_nodes(
        db,
        memories_by_id=memories_by_id,
        path_nodes_by_key=path_nodes_by_key,
        summary=summary,
    )

    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in memories}
    _sync_structural_auto_edges(
        db,
        memories_by_id=memories_by_id,
        summary=summary,
    )
    db.flush()
    return summary
