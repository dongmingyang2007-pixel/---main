from __future__ import annotations

import json
import re

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Memory, MemoryEdge, Project
from app.services.dashscope_client import chat_completion
from app.services.embedding import embed_and_store
from app.services.memory_metadata import (
    MEMORY_KIND_EPISODIC,
    MEMORY_KIND_PREFERENCE,
    MEMORY_KIND_PROFILE,
    build_summary_group_key,
    build_summary_memory_metadata,
    get_memory_kind,
    get_memory_metadata,
    get_memory_salience,
    is_pinned_memory,
    is_summary_memory,
    shorten_text,
)
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory
from app.services.memory_visibility import build_private_memory_metadata, get_memory_owner_user_id, is_private_memory

SUMMARY_MIN_GROUP_SIZE = 3
SUMMARY_MAX_SOURCE_MEMORIES = 8
SUMMARY_MIN_TOTAL_CHARS = 36
SUMMARY_EDGE_STRENGTH = 0.92

SUMMARY_PROMPT = """你是记忆压缩器。请把同一主题的多条记忆压缩成一条高信息密度摘要记忆。

要求：
- 保留稳定事实、长期偏好、持续目标
- 删除重复和一次性措辞
- 不要编造新事实
- 输出一句到三句话，适合作为长期上下文
- 如果这些记忆只是零散片段，不值得形成摘要，返回 {{"skip": true}}

主题：{category}

记忆列表：
{memory_lines}

输出 JSON：
{{"skip": false, "summary": "...", "category": "{category}"}}"""


def _normalized_category(memory: Memory) -> str:
    parts = [segment.strip() for segment in str(memory.category or "").split(".") if segment.strip()]
    if not parts:
        return "uncategorized"
    return ".".join(parts[:2])


def _eligible_for_compaction(memory: Memory) -> bool:
    if memory.type != "permanent":
        return False
    if is_assistant_root_memory(memory) or is_summary_memory(memory) or is_pinned_memory(memory):
        return False
    if get_memory_kind(memory) == MEMORY_KIND_EPISODIC:
        return False
    return bool(memory.content.strip())


def _group_memories(memories: list[Memory]) -> dict[str, list[Memory]]:
    groups: dict[str, list[Memory]] = {}
    for memory in memories:
        if not _eligible_for_compaction(memory):
            continue
        owner_user_id = get_memory_owner_user_id(memory) if is_private_memory(memory) else None
        memory_kind = get_memory_kind(memory)
        if memory_kind in {MEMORY_KIND_PROFILE, MEMORY_KIND_PREFERENCE}:
            summary_family = memory_kind
        else:
            summary_family = "topic"
        group_key = build_summary_group_key(
            owner_user_id=owner_user_id,
            parent_memory_id=memory.parent_memory_id,
            category=_normalized_category(memory),
            memory_kind=summary_family,
        )
        groups.setdefault(group_key, []).append(memory)
    return groups


def _fallback_summary_text(memories: list[Memory]) -> str:
    statements: list[str] = []
    for memory in memories:
        normalized = shorten_text(memory.content, limit=140)
        if normalized and normalized not in statements:
            statements.append(normalized)
        if len(statements) >= 4:
            break
    if not statements:
        return ""
    if len(statements) == 1:
        return statements[0]
    return "；".join(statements)


def _parse_summary_payload(raw: str, *, fallback_category: str) -> tuple[str, str] | None:
    if not raw.strip():
        return None
    match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if match:
        try:
            payload = json.loads(match.group(0))
        except (json.JSONDecodeError, ValueError):
            payload = None
        if isinstance(payload, dict):
            if payload.get("skip") is True:
                return None
            summary = str(payload.get("summary") or "").strip()
            category = str(payload.get("category") or fallback_category).strip() or fallback_category
            if summary:
                return summary, category
    summary = raw.strip()
    return (summary, fallback_category) if summary else None


async def _generate_summary_for_group(
    *,
    memories: list[Memory],
    category: str,
) -> tuple[str, str] | None:
    memory_lines = "\n".join(
        f"- ({memory.id}) {shorten_text(memory.content, limit=220)}"
        for memory in memories
    )
    try:
        raw = await chat_completion(
            [{"role": "user", "content": SUMMARY_PROMPT.format(category=category, memory_lines=memory_lines)}],
            model=settings.memory_triage_model,
            temperature=0.1,
            max_tokens=256,
        )
    except Exception:
        raw = ""
    parsed = _parse_summary_payload(raw, fallback_category=category)
    if parsed is not None:
        return parsed
    fallback = _fallback_summary_text(memories)
    return (fallback, category) if fallback else None


async def compact_project_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
) -> list[str]:
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
        return []

    root_memory, _changed = ensure_project_assistant_root(db, project, reparent_orphans=False)
    memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .all()
    )
    grouped = _group_memories(memories)
    summary_memories = [
        memory for memory in memories
        if is_summary_memory(memory)
    ]
    summaries_by_group = {
        str(get_memory_metadata(memory).get("summary_group_key") or ""): memory
        for memory in summary_memories
        if str(get_memory_metadata(memory).get("summary_group_key") or "")
    }

    updated_summary_ids: list[str] = []
    for group_key, group_memories in grouped.items():
        if len(group_memories) < SUMMARY_MIN_GROUP_SIZE:
            continue
        ordered_group = sorted(
            group_memories,
            key=lambda memory: (get_memory_salience(memory), memory.updated_at),
            reverse=True,
        )[:SUMMARY_MAX_SOURCE_MEMORIES]
        total_chars = sum(len(memory.content.strip()) for memory in ordered_group)
        min_chars = max(SUMMARY_MIN_TOTAL_CHARS, len(ordered_group) * 10)
        if total_chars < min_chars:
            continue

        sample = ordered_group[0]
        summary_payload = await _generate_summary_for_group(
            memories=ordered_group,
            category=_normalized_category(sample),
        )
        if summary_payload is None:
            continue
        summary_content, summary_category = summary_payload
        owner_user_id = get_memory_owner_user_id(sample) if is_private_memory(sample) else None
        source_memory_ids = [memory.id for memory in ordered_group]
        summary_metadata = build_summary_memory_metadata(
            content=summary_content,
            category=summary_category,
            source_memory_ids=source_memory_ids,
            summary_group_key=group_key,
            salience=max(0.82, max(get_memory_salience(memory) for memory in ordered_group)),
        )
        if owner_user_id:
            summary_metadata = build_private_memory_metadata(summary_metadata, owner_user_id=owner_user_id)

        summary_memory = summaries_by_group.get(group_key)
        if summary_memory is None:
            summary_memory = Memory(
                workspace_id=workspace_id,
                project_id=project_id,
                content=summary_content,
                category=summary_category,
                type="permanent",
                source_conversation_id=None,
                parent_memory_id=sample.parent_memory_id or root_memory.id,
                metadata_json=summary_metadata,
            )
            db.add(summary_memory)
            db.flush()
            summaries_by_group[group_key] = summary_memory
        else:
            summary_memory.content = summary_content
            summary_memory.category = summary_category
            summary_memory.metadata_json = summary_metadata
            if summary_memory.parent_memory_id is None:
                summary_memory.parent_memory_id = sample.parent_memory_id or root_memory.id

        db.execute(
            sql_text(
                "DELETE FROM embeddings WHERE memory_id = :memory_id"
            ),
            {"memory_id": summary_memory.id},
        )
        db.query(MemoryEdge).filter(
            MemoryEdge.source_memory_id == summary_memory.id,
            MemoryEdge.edge_type == "summary",
        ).delete(synchronize_session=False)

        for source_memory_id in source_memory_ids:
            db.add(
                MemoryEdge(
                    source_memory_id=summary_memory.id,
                    target_memory_id=source_memory_id,
                    edge_type="summary",
                    strength=SUMMARY_EDGE_STRENGTH,
                )
            )

        try:
            await embed_and_store(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                memory_id=summary_memory.id,
                chunk_text=summary_content,
                auto_commit=False,
            )
        except Exception:
            pass
        updated_summary_ids.append(summary_memory.id)

    return updated_summary_ids
