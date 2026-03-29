from __future__ import annotations

from dataclasses import asdict, dataclass
import re

from sqlalchemy import or_, text as sql_text
from sqlalchemy.orm import Session

from app.models import Memory, MemoryEdge, MemoryFile, Project
from app.services.memory_category_tree import ensure_project_category_tree
from app.services.memory_metadata import (
    MEMORY_KIND_GOAL,
    MEMORY_KIND_PREFERENCE,
    get_memory_kind,
    get_memory_metadata,
    is_category_path_memory,
    is_concept_memory,
    is_pinned_memory,
    is_summary_memory,
)
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory


@dataclass(slots=True)
class MemoryGraphRepairSummary:
    deleted_aggregate_nodes: int = 0
    reparented_nodes: int = 0
    deleted_auto_edges: int = 0
    created_auto_edges: int = 0
    skipped_nodes: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def _normalize_text_key(value: str) -> str:
    normalized = re.sub(r"\s+", "", str(value or "").strip().lower())
    return re.sub(r"[，。、“”‘’\"'`()（）,.!?！？:：;；\-_/\\]+", "", normalized)


def _normalize_category_segments(category: str) -> list[str]:
    return [
        segment.strip().lower()
        for segment in str(category or "").split(".")
        if segment.strip()
    ]


def _shared_category_prefix_length(left: str, right: str) -> int:
    shared = 0
    for left_segment, right_segment in zip(
        _normalize_category_segments(left),
        _normalize_category_segments(right),
        strict=False,
    ):
        if left_segment != right_segment:
            break
        shared += 1
    return shared


def _is_structural_parent_memory(memory: Memory | None) -> bool:
    return memory is not None and (
        is_assistant_root_memory(memory)
        or is_concept_memory(memory)
        or is_category_path_memory(memory)
        or is_summary_memory(memory)
    )


def _is_auto_managed_memory(memory: Memory) -> bool:
    metadata = get_memory_metadata(memory)
    return bool(
        metadata.get("auto_generated")
        or metadata.get("source") == "auto_extraction"
        or metadata.get("promoted_by")
    )


def _is_aggregate_leaf_memory(memory: Memory) -> bool:
    if is_assistant_root_memory(memory) or is_concept_memory(memory) or is_summary_memory(memory):
        return False
    normalized = re.sub(r"\s+", "", memory.content.strip())
    if not normalized:
        return False
    memory_kind = get_memory_kind(memory)
    if memory_kind not in {MEMORY_KIND_PREFERENCE, MEMORY_KIND_GOAL} and "偏好" not in memory.category:
        return False
    if not any(separator in normalized for separator in ("、", "和", "以及", "及", "，", ",")):
        return False
    return bool(
        re.match(
            r"^用户(?:偏好|喜欢|喜爱|爱喝|爱吃|热爱|计划|打算|准备|想要)[^。！？!?]*[、和及以及，,][^。！？!?]*[。！？!?]?$",
            normalized,
        )
    )


def _score_concept_parent(candidate: Memory, memory: Memory) -> float:
    score = 0.0
    shared_prefix = _shared_category_prefix_length(candidate.category, memory.category)
    score += shared_prefix * 0.35
    candidate_topic = str(get_memory_metadata(candidate).get("concept_topic") or "").strip()
    if candidate_topic:
        topic_key = _normalize_text_key(candidate_topic)
        if topic_key and topic_key in _normalize_text_key(memory.content + memory.category):
            score += 0.45
    if get_memory_kind(candidate) == get_memory_kind(memory):
        score += 0.12
    if candidate.parent_memory_id:
        score += 0.03
    return score


def _find_repair_parent(
    memory: Memory,
    *,
    current_parent: Memory | None,
    root_memory: Memory,
    memories_by_id: dict[str, Memory],
) -> Memory:
    if current_parent and current_parent.parent_memory_id:
        grandparent = memories_by_id.get(current_parent.parent_memory_id)
        if _is_structural_parent_memory(grandparent):
            return grandparent

    best_candidate: Memory | None = None
    best_score = 0.0
    for candidate in memories_by_id.values():
        if candidate.project_id != memory.project_id or candidate.id == memory.id:
            continue
        if not (is_concept_memory(candidate) or is_category_path_memory(candidate)):
            continue
        score = _score_concept_parent(candidate, memory)
        if score > best_score:
            best_candidate = candidate
            best_score = score
    if best_candidate and best_score >= 0.55:
        return best_candidate
    return root_memory


def _delete_memory(db: Session, memory_id: str) -> None:
    db.query(MemoryEdge).filter(
        or_(
            MemoryEdge.source_memory_id == memory_id,
            MemoryEdge.target_memory_id == memory_id,
        )
    ).delete(synchronize_session=False)
    db.query(MemoryFile).filter(MemoryFile.memory_id == memory_id).delete(synchronize_session=False)
    db.execute(sql_text("DELETE FROM embeddings WHERE memory_id = :memory_id"), {"memory_id": memory_id})
    db.query(Memory).filter(Memory.id == memory_id).delete(synchronize_session=False)


def repair_project_memory_graph(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
) -> MemoryGraphRepairSummary:
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
        return MemoryGraphRepairSummary()

    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)
    summary = MemoryGraphRepairSummary()

    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in memories}

    deleted_memory_ids: set[str] = set()

    for memory in memories:
        if memory.id == root_memory.id:
            continue
        if is_pinned_memory(memory) or not _is_auto_managed_memory(memory):
            continue
        if not _is_aggregate_leaf_memory(memory):
            continue

        for child in memories:
            if child.parent_memory_id != memory.id or child.id in deleted_memory_ids:
                continue
            if is_pinned_memory(child) or not _is_auto_managed_memory(child):
                summary.skipped_nodes += 1
                continue
            replacement_parent = _find_repair_parent(
                child,
                current_parent=memory,
                root_memory=root_memory,
                memories_by_id=memories_by_id,
            )
            if child.parent_memory_id != replacement_parent.id:
                child.parent_memory_id = replacement_parent.id
                summary.reparented_nodes += 1

        deleted_memory_ids.add(memory.id)
        memories_by_id.pop(memory.id, None)
        _delete_memory(db, memory.id)
        summary.deleted_aggregate_nodes += 1

    remaining_memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in remaining_memories}

    for memory in remaining_memories:
        if memory.id == root_memory.id or memory.id in deleted_memory_ids:
            continue
        parent = memories_by_id.get(memory.parent_memory_id or "")
        if parent is None:
            if is_pinned_memory(memory) or not _is_auto_managed_memory(memory):
                summary.skipped_nodes += 1
                continue
            if memory.parent_memory_id != root_memory.id:
                memory.parent_memory_id = root_memory.id
                summary.reparented_nodes += 1
            continue
        if _is_structural_parent_memory(parent):
            continue
        if is_pinned_memory(memory) or not _is_auto_managed_memory(memory):
            summary.skipped_nodes += 1
            continue

        replacement_parent = _find_repair_parent(
            memory,
            current_parent=parent,
            root_memory=root_memory,
            memories_by_id=memories_by_id,
        )
        if memory.parent_memory_id != replacement_parent.id:
            memory.parent_memory_id = replacement_parent.id
            summary.reparented_nodes += 1

    valid_auto_edges = {
        (memory.parent_memory_id, memory.id)
        for memory in remaining_memories
        if memory.parent_memory_id
        and memory.parent_memory_id in memories_by_id
        and not is_assistant_root_memory(memories_by_id[memory.parent_memory_id])
        and _is_structural_parent_memory(memories_by_id[memory.parent_memory_id])
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
    existing_auto_pairs = {(edge.source_memory_id, edge.target_memory_id): edge for edge in auto_edges}

    for edge in auto_edges:
        pair = (edge.source_memory_id, edge.target_memory_id)
        source = memories_by_id.get(edge.source_memory_id)
        if pair not in valid_auto_edges or not _is_structural_parent_memory(source):
            db.delete(edge)
            summary.deleted_auto_edges += 1

    for source_memory_id, target_memory_id in sorted(valid_auto_edges):
        if (source_memory_id, target_memory_id) in existing_auto_pairs:
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

    tree_summary = ensure_project_category_tree(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    summary.reparented_nodes += tree_summary.reparented_nodes
    summary.created_auto_edges += tree_summary.created_auto_edges
    summary.deleted_auto_edges += tree_summary.deleted_auto_edges
    db.flush()
    return summary
