from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Any, Awaitable, Callable, Literal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Conversation, Memory, MemoryEdge, Project
from app.services.context_loader import filter_knowledge_chunks, load_conversation_context
from app.services.memory_file_context import load_linked_file_chunks_for_memories
from app.services.memory_metadata import (
    MEMORY_KIND_GOAL,
    MEMORY_KIND_PREFERENCE,
    MEMORY_KIND_PROFILE,
    MEMORY_KIND_SUMMARY,
    get_memory_kind,
    get_memory_metadata,
    get_memory_salience,
    is_pinned_memory,
    is_summary_memory,
    shorten_text,
    stamp_memory_usage_metadata,
)
from app.services.memory_roots import is_assistant_root_memory
from app.services.memory_visibility import get_memory_owner_user_id, is_private_memory
from app.services.embedding import search_similar

SemanticSearchFn = Callable[..., Awaitable[list[dict[str, Any]]]]
LinkedFileLoaderFn = Callable[..., Awaitable[list[dict[str, Any]]]]
ContextLevel = Literal["none", "profile_only", "memory_only", "full_rag"]

STATIC_MEMORY_LIMIT = 6
RELEVANT_MEMORY_LIMIT = 10
GRAPH_MEMORY_LIMIT = 4
TEMPORARY_MEMORY_LIMIT = 8
KNOWLEDGE_CHUNK_LIMIT = 6
LINKED_FILE_CHUNK_LIMIT = 4
SEMANTIC_SEARCH_LIMIT = 18
GRAPH_EDGE_MIN_STRENGTH = 0.55

_STATIC_KINDS = {
    MEMORY_KIND_PROFILE,
    MEMORY_KIND_PREFERENCE,
    MEMORY_KIND_GOAL,
    MEMORY_KIND_SUMMARY,
}
_QUERY_TOKEN_PATTERN = re.compile(r"[\w\u4e00-\u9fff]{2,}")


@dataclass(slots=True)
class MemoryCandidate:
    memory: Memory
    source: str
    score: float
    semantic_score: float | None = None

    @property
    def id(self) -> str:
        return self.memory.id


@dataclass(slots=True)
class MemoryContextResult:
    project: Project
    conversation: Conversation
    selected_memories: list[MemoryCandidate]
    knowledge_chunks: list[dict[str, Any]]
    linked_file_chunks: list[dict[str, Any]]
    system_prompt: str
    retrieval_trace: dict[str, Any]


def _memory_visible_to_conversation(memory: Memory, *, conversation_id: str, conversation_created_by: str | None) -> bool:
    if memory.type == "temporary":
        return memory.source_conversation_id == conversation_id
    if not is_private_memory(memory):
        return True
    return get_memory_owner_user_id(memory) == conversation_created_by


def _load_visible_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    conversation_created_by: str | None,
) -> tuple[list[Memory], list[Memory]]:
    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
        )
        .all()
    )
    visible_permanent: list[Memory] = []
    visible_temporary: list[Memory] = []
    for memory in memories:
        if is_assistant_root_memory(memory):
            continue
        if not _memory_visible_to_conversation(
            memory,
            conversation_id=conversation_id,
            conversation_created_by=conversation_created_by,
        ):
            continue
        if memory.type == "temporary":
            visible_temporary.append(memory)
        else:
            visible_permanent.append(memory)
    return visible_permanent, visible_temporary


def _normalize_query_tokens(query: str) -> list[str]:
    return [token.casefold() for token in _QUERY_TOKEN_PATTERN.findall(query or "")]


def _memory_matches_query(memory: Memory, query_tokens: list[str]) -> bool:
    if not query_tokens:
        return False
    haystack = f"{memory.content}\n{memory.category}".casefold()
    return any(token in haystack for token in query_tokens)


def _coerce_utc(timestamp: datetime | None) -> datetime | None:
    if timestamp is None:
        return None
    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def _recency_bonus(memory: Memory) -> float:
    updated_at = _coerce_utc(memory.updated_at)
    if updated_at is None:
        return 0.0
    age_days = max((datetime.now(timezone.utc) - updated_at).days, 0)
    if age_days <= 3:
        return 0.08
    if age_days <= 14:
        return 0.04
    if age_days <= 45:
        return 0.02
    return 0.0


def _candidate_score(memory: Memory, *, source: str, semantic_score: float | None = None) -> float:
    score = semantic_score or 0.0
    score += get_memory_salience(memory) * 0.45
    if is_pinned_memory(memory):
        score += 0.3
    if get_memory_kind(memory) in {MEMORY_KIND_PROFILE, MEMORY_KIND_PREFERENCE, MEMORY_KIND_GOAL}:
        score += 0.08
    if is_summary_memory(memory):
        score += 0.12
    score += _recency_bonus(memory)
    source_bonus = {
        "static": 0.15,
        "semantic": 0.28,
        "lexical": 0.16,
        "graph_parent": 0.12,
        "graph_child": 0.10,
        "graph_edge": 0.08,
        "recent_temporary": 0.06,
    }.get(source, 0.0)
    return round(score + source_bonus, 4)


def _select_best_candidates(candidates: list[MemoryCandidate], *, limit: int) -> list[MemoryCandidate]:
    deduped: dict[str, MemoryCandidate] = {}
    for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
        current = deduped.get(candidate.id)
        if current is None or candidate.score > current.score:
            deduped[candidate.id] = candidate
    return list(sorted(deduped.values(), key=lambda item: item.score, reverse=True)[:limit])


def _build_graph_neighbors(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    seed_candidates: list[MemoryCandidate],
    visible_memories_by_id: dict[str, Memory],
) -> list[MemoryCandidate]:
    seed_ids = [candidate.id for candidate in seed_candidates if candidate.memory.type == "permanent"]
    if not seed_ids:
        return []

    edges = (
        db.query(MemoryEdge)
        .filter(
            or_(
                MemoryEdge.source_memory_id.in_(seed_ids),
                MemoryEdge.target_memory_id.in_(seed_ids),
            )
        )
        .all()
    )

    parent_ids = {
        candidate.memory.parent_memory_id
        for candidate in seed_candidates
        if candidate.memory.parent_memory_id
    }
    child_memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.parent_memory_id.in_(seed_ids),
        )
        .all()
        if seed_ids
        else []
    )

    candidates: list[MemoryCandidate] = []
    seed_score_by_id = {candidate.id: candidate.score for candidate in seed_candidates}

    for parent_id in parent_ids:
        parent_memory = visible_memories_by_id.get(parent_id or "")
        if not parent_memory:
            continue
        semantic_score = max(
            (seed_score_by_id.get(seed_id, 0.0) for seed_id in seed_ids if visible_memories_by_id.get(seed_id)),
            default=0.0,
        )
        candidates.append(
            MemoryCandidate(
                memory=parent_memory,
                source="graph_parent",
                semantic_score=semantic_score,
                score=_candidate_score(parent_memory, source="graph_parent", semantic_score=semantic_score),
            )
        )

    for child_memory in child_memories:
        if child_memory.id in seed_score_by_id:
            continue
        parent_score = seed_score_by_id.get(child_memory.parent_memory_id or "", 0.0)
        candidates.append(
            MemoryCandidate(
                memory=child_memory,
                source="graph_child",
                semantic_score=parent_score,
                score=_candidate_score(child_memory, source="graph_child", semantic_score=parent_score),
            )
        )

    for edge in edges:
        if edge.strength < GRAPH_EDGE_MIN_STRENGTH:
            continue
        source_id = edge.source_memory_id
        target_id = edge.target_memory_id
        if source_id in seed_score_by_id and target_id in visible_memories_by_id:
            neighbor = visible_memories_by_id[target_id]
            if neighbor.id in seed_score_by_id:
                continue
            semantic_score = seed_score_by_id[source_id] * max(edge.strength, 0.1)
            candidates.append(
                MemoryCandidate(
                    memory=neighbor,
                    source="graph_edge",
                    semantic_score=semantic_score,
                    score=_candidate_score(neighbor, source="graph_edge", semantic_score=semantic_score),
                )
            )
        if target_id in seed_score_by_id and source_id in visible_memories_by_id:
            neighbor = visible_memories_by_id[source_id]
            if neighbor.id in seed_score_by_id:
                continue
            semantic_score = seed_score_by_id[target_id] * max(edge.strength, 0.1)
            candidates.append(
                MemoryCandidate(
                    memory=neighbor,
                    source="graph_edge",
                    semantic_score=semantic_score,
                    score=_candidate_score(neighbor, source="graph_edge", semantic_score=semantic_score),
                )
            )

    return _select_best_candidates(candidates, limit=GRAPH_MEMORY_LIMIT)


def _build_system_prompt(
    *,
    personality: str,
    static_memories: list[MemoryCandidate],
    relevant_memories: list[MemoryCandidate],
    temporary_memories: list[MemoryCandidate],
    knowledge_chunks: list[dict[str, Any]],
    linked_file_chunks: list[dict[str, Any]],
    recent_messages: list[dict[str, str]] | None = None,
) -> str:
    parts: list[str] = []
    if personality:
        parts.append(f"你的人格设定：\n{personality}")

    if static_memories:
        lines = [
            f"- [{get_memory_kind(candidate.memory)}] {candidate.memory.content}"
            for candidate in static_memories
        ]
        parts.append("用户的长期画像与稳定偏好：\n" + "\n".join(lines))

    if relevant_memories:
        lines = [
            f"- [{candidate.source}] {candidate.memory.content}"
            for candidate in relevant_memories
        ]
        parts.append("与当前问题最相关的记忆：\n" + "\n".join(lines))

    if temporary_memories:
        lines = [f"- {candidate.memory.content}" for candidate in temporary_memories]
        parts.append("当前会话中刚形成或只在本次对话生效的记忆：\n" + "\n".join(lines))

    if knowledge_chunks:
        parts.append(
            "相关知识参考（来自用户上传的资料）：\n"
            + "\n---\n".join(chunk["chunk_text"] for chunk in knowledge_chunks if chunk.get("chunk_text"))
        )

    if linked_file_chunks:
        linked_text = "\n---\n".join(
            f"[{chunk.get('filename') or '未命名资料'}]\n{chunk['chunk_text']}"
            for chunk in linked_file_chunks
            if chunk.get("chunk_text")
        )
        if linked_text:
            parts.append(f"与当前相关记忆直接关联的资料摘录：\n{linked_text}")

    if recent_messages:
        history_lines: list[str] = []
        for message in recent_messages:
            role = "用户" if message.get("role") == "user" else "助手"
            content = str(message.get("content") or "").strip()
            if content:
                history_lines.append(f"{role}: {content}")
        if history_lines:
            parts.append("最近对话历史：\n" + "\n".join(history_lines))

    return "\n\n".join(parts) if parts else "你是一个有帮助的 AI 助手。"


def _serialize_memory_candidate(candidate: MemoryCandidate) -> dict[str, Any]:
    memory = candidate.memory
    return {
        "id": memory.id,
        "type": memory.type,
        "category": memory.category,
        "memory_kind": get_memory_kind(memory),
        "source": candidate.source,
        "score": round(candidate.score, 4),
        "semantic_score": round(candidate.semantic_score, 4) if candidate.semantic_score is not None else None,
        "pinned": is_pinned_memory(memory),
        "salience": round(get_memory_salience(memory), 4),
        "content": shorten_text(memory.content, limit=180),
    }


def _serialize_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": chunk.get("id"),
        "data_item_id": chunk.get("data_item_id"),
        "filename": chunk.get("filename"),
        "score": round(float(chunk.get("score") or 0.0), 4),
        "chunk_text": shorten_text(str(chunk.get("chunk_text") or ""), limit=220),
    }


async def build_memory_context(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
    personality: str = "",
    context_level: ContextLevel = "full_rag",
    include_recent_history: bool = False,
    semantic_search_fn: SemanticSearchFn = search_similar,
    linked_file_loader_fn: LinkedFileLoaderFn = load_linked_file_chunks_for_memories,
) -> MemoryContextResult:
    project, conversation = load_conversation_context(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
    )

    semantic_results: list[dict[str, Any]] = []
    knowledge_chunks: list[dict[str, Any]] = []
    linked_file_chunks: list[dict[str, Any]] = []
    static_selected: list[MemoryCandidate] = []
    relevant_selected: list[MemoryCandidate] = []
    graph_selected: list[MemoryCandidate] = []
    temporary_selected: list[MemoryCandidate] = []

    if context_level != "none":
        permanent_memories, temporary_memories = _load_visible_memories(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_id=conversation_id,
            conversation_created_by=conversation.created_by,
        )
        visible_memories_by_id = {
            memory.id: memory for memory in [*permanent_memories, *temporary_memories]
        }
        query_tokens = _normalize_query_tokens(user_message)
        static_candidates = [
            MemoryCandidate(
                memory=memory,
                source="static",
                score=_candidate_score(memory, source="static"),
            )
            for memory in permanent_memories
            if is_pinned_memory(memory) or get_memory_kind(memory) in _STATIC_KINDS
        ]
        static_selected = _select_best_candidates(static_candidates, limit=STATIC_MEMORY_LIMIT)

        if context_level in {"memory_only", "full_rag"}:
            semantic_memory_candidates: list[MemoryCandidate] = []
            if user_message.strip():
                try:
                    semantic_results = await semantic_search_fn(
                        db,
                        workspace_id=workspace_id,
                        project_id=project_id,
                        query=user_message,
                        limit=SEMANTIC_SEARCH_LIMIT,
                    )
                except Exception:
                    semantic_results = []

            for result in semantic_results:
                memory_id = result.get("memory_id")
                if not memory_id:
                    continue
                memory = visible_memories_by_id.get(memory_id)
                if not memory:
                    continue
                semantic_score = float(result.get("score") or 0.0)
                semantic_memory_candidates.append(
                    MemoryCandidate(
                        memory=memory,
                        source="semantic",
                        semantic_score=semantic_score,
                        score=_candidate_score(memory, source="semantic", semantic_score=semantic_score),
                    )
                )

            lexical_candidates = [
                MemoryCandidate(
                    memory=memory,
                    source="lexical",
                    score=_candidate_score(memory, source="lexical", semantic_score=0.55),
                    semantic_score=0.55,
                )
                for memory in [*permanent_memories, *temporary_memories]
                if _memory_matches_query(memory, query_tokens)
            ]

            permanent_relevant_candidates = [
                candidate
                for candidate in [*semantic_memory_candidates, *lexical_candidates]
                if candidate.memory.type == "permanent"
            ]
            relevant_selected = _select_best_candidates(
                permanent_relevant_candidates,
                limit=RELEVANT_MEMORY_LIMIT,
            )

            graph_selected = _build_graph_neighbors(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                seed_candidates=relevant_selected,
                visible_memories_by_id=visible_memories_by_id,
            )

            temporary_relevant_candidates = [
                candidate
                for candidate in [*semantic_memory_candidates, *lexical_candidates]
                if candidate.memory.type == "temporary"
            ]
            temporary_relevant_candidates.extend(
                MemoryCandidate(
                    memory=memory,
                    source="recent_temporary",
                    score=_candidate_score(memory, source="recent_temporary"),
                )
                for memory in sorted(
                    temporary_memories,
                    key=lambda item: _coerce_utc(item.updated_at) or datetime.min.replace(tzinfo=timezone.utc),
                    reverse=True,
                )[:TEMPORARY_MEMORY_LIMIT]
            )
            temporary_selected = _select_best_candidates(
                temporary_relevant_candidates,
                limit=TEMPORARY_MEMORY_LIMIT,
            )

            if context_level == "full_rag" and semantic_results:
                knowledge_chunks = filter_knowledge_chunks(
                    db,
                    workspace_id=workspace_id,
                    project_id=project_id,
                    results=[result for result in semantic_results if result.get("memory_id") is None],
                )[:KNOWLEDGE_CHUNK_LIMIT]

            selected_memory_ids = {
                candidate.id
                for candidate in [*static_selected, *relevant_selected, *graph_selected, *temporary_selected]
            }
            if context_level == "full_rag" and user_message.strip() and selected_memory_ids:
                try:
                    linked_file_chunks = await linked_file_loader_fn(
                        db,
                        workspace_id=workspace_id,
                        project_id=project_id,
                        memory_ids=list(selected_memory_ids),
                        query=user_message,
                        limit=LINKED_FILE_CHUNK_LIMIT,
                    )
                except Exception:
                    linked_file_chunks = []

    prompt = _build_system_prompt(
        personality=personality,
        static_memories=static_selected,
        relevant_memories=[candidate for candidate in [*relevant_selected, *graph_selected] if candidate.id not in {item.id for item in static_selected}],
        temporary_memories=temporary_selected,
        knowledge_chunks=knowledge_chunks,
        linked_file_chunks=linked_file_chunks,
        recent_messages=recent_messages if include_recent_history else None,
    )

    retrieval_trace = {
        "strategy": "layered_memory_v2",
        "context_level": context_level,
        "memory_counts": {
            "static": len(static_selected),
            "relevant": len(relevant_selected),
            "graph": len(graph_selected),
            "temporary": len(temporary_selected),
        },
        "memories": [
            _serialize_memory_candidate(candidate)
            for candidate in [*static_selected, *relevant_selected, *graph_selected, *temporary_selected]
        ],
        "knowledge_chunks": [_serialize_chunk(chunk) for chunk in knowledge_chunks],
        "linked_file_chunks": [_serialize_chunk(chunk) for chunk in linked_file_chunks],
    }

    final_selected_memories = _select_best_candidates(
        [*static_selected, *relevant_selected, *graph_selected, *temporary_selected],
        limit=STATIC_MEMORY_LIMIT + RELEVANT_MEMORY_LIMIT + GRAPH_MEMORY_LIMIT + TEMPORARY_MEMORY_LIMIT,
    )
    retrieval_trace["memories"] = [
        _serialize_memory_candidate(candidate)
        for candidate in final_selected_memories
    ]

    return MemoryContextResult(
        project=project,
        conversation=conversation,
        selected_memories=final_selected_memories,
        knowledge_chunks=knowledge_chunks,
        linked_file_chunks=linked_file_chunks,
        system_prompt=prompt,
        retrieval_trace=retrieval_trace,
    )


def touch_retrieved_memories(
    db: Session,
    *,
    selected_memories: list[MemoryCandidate],
    used_at: datetime | None = None,
) -> None:
    timestamp = used_at or datetime.now(timezone.utc)
    seen: set[str] = set()
    for candidate in selected_memories:
        if candidate.id in seen or is_assistant_root_memory(candidate.memory):
            continue
        seen.add(candidate.id)
        candidate.memory.metadata_json = stamp_memory_usage_metadata(
            get_memory_metadata(candidate.memory),
            source=candidate.source,
            score=candidate.semantic_score if candidate.semantic_score is not None else candidate.score,
            used_at=timestamp,
        )
        candidate.memory.updated_at = candidate.memory.updated_at or timestamp


def touch_memories_from_trace(
    db: Session,
    *,
    retrieval_trace: dict[str, Any] | None,
    used_at: datetime | None = None,
) -> None:
    if not isinstance(retrieval_trace, dict):
        return
    memory_entries = retrieval_trace.get("memories")
    if not isinstance(memory_entries, list):
        return

    entry_by_id: dict[str, dict[str, Any]] = {}
    for entry in memory_entries:
        if not isinstance(entry, dict):
            continue
        memory_id = entry.get("id")
        if isinstance(memory_id, str) and memory_id:
            entry_by_id[memory_id] = entry
    if not entry_by_id:
        return

    timestamp = used_at or datetime.now(timezone.utc)
    memories = db.query(Memory).filter(Memory.id.in_(list(entry_by_id))).all()
    for memory in memories:
        entry = entry_by_id.get(memory.id) or {}
        score = entry.get("semantic_score")
        if not isinstance(score, (int, float)):
            score = entry.get("score")
        memory.metadata_json = stamp_memory_usage_metadata(
            get_memory_metadata(memory),
            source=str(entry.get("source") or "context"),
            score=float(score) if isinstance(score, (int, float)) else None,
            used_at=timestamp,
        )


async def search_project_memories_for_tool(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    conversation_created_by: str | None,
    query: str,
    top_k: int,
    semantic_search_fn: SemanticSearchFn = search_similar,
) -> list[dict[str, Any]]:
    permanent_memories, temporary_memories = _load_visible_memories(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        conversation_created_by=conversation_created_by,
    )
    visible_memories_by_id = {
        memory.id: memory for memory in [*permanent_memories, *temporary_memories]
    }
    query_tokens = _normalize_query_tokens(query)
    candidates: list[MemoryCandidate] = []
    try:
        results = await semantic_search_fn(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            query=query,
            limit=max(12, top_k * 3),
        )
    except Exception:
        results = []

    for result in results:
        memory_id = result.get("memory_id")
        if not memory_id:
            continue
        memory = visible_memories_by_id.get(memory_id)
        if not memory:
            continue
        semantic_score = float(result.get("score") or 0.0)
        candidates.append(
            MemoryCandidate(
                memory=memory,
                source="semantic",
                semantic_score=semantic_score,
                score=_candidate_score(memory, source="semantic", semantic_score=semantic_score),
            )
        )

    if not candidates:
        candidates = [
            MemoryCandidate(
                memory=memory,
                source="lexical",
                semantic_score=1.0,
                score=_candidate_score(memory, source="lexical", semantic_score=1.0),
            )
            for memory in [*permanent_memories, *temporary_memories]
            if _memory_matches_query(memory, query_tokens)
        ]

    selected = _select_best_candidates(candidates, limit=top_k)
    return [
        {
            "id": candidate.memory.id,
            "type": candidate.memory.type,
            "category": candidate.memory.category,
            "memory_kind": get_memory_kind(candidate.memory),
            "score": candidate.semantic_score if candidate.semantic_score is not None else candidate.score,
            "source": candidate.source,
            "content": shorten_text(candidate.memory.content, limit=600),
        }
        for candidate in selected
    ]
