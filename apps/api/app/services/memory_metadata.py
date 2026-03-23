from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from app.models import Memory

MEMORY_KIND_PROFILE = "profile"
MEMORY_KIND_PREFERENCE = "preference"
MEMORY_KIND_GOAL = "goal"
MEMORY_KIND_EPISODIC = "episodic"
MEMORY_KIND_FACT = "fact"
MEMORY_KIND_SUMMARY = "summary"
SUMMARY_NODE_KIND = "summary"

_VALID_MEMORY_KINDS = {
    MEMORY_KIND_PROFILE,
    MEMORY_KIND_PREFERENCE,
    MEMORY_KIND_GOAL,
    MEMORY_KIND_EPISODIC,
    MEMORY_KIND_FACT,
    MEMORY_KIND_SUMMARY,
}

_PROFILE_HINTS = (
    "我是",
    "我叫",
    "名字",
    "住在",
    "来自",
    "工作",
    "职业",
    "专业",
    "年龄",
    "身份",
    "i am",
    "my name",
    "i live",
    "i work",
)
_PREFERENCE_HINTS = (
    "喜欢",
    "偏好",
    "爱吃",
    "爱看",
    "热爱",
    "讨厌",
    "不喜欢",
    "prefer",
    "favorite",
    "like ",
    "dislike",
)
_GOAL_HINTS = (
    "计划",
    "打算",
    "准备",
    "目标",
    "想要",
    "正在学",
    "希望",
    "will ",
    "plan ",
    "goal",
    "trying to",
)
_EPISODIC_HINTS = (
    "今天",
    "昨天",
    "刚刚",
    "这次",
    "本次",
    "today",
    "yesterday",
    "just now",
    "this conversation",
)


def get_memory_metadata(memory: Memory | dict[str, Any] | None) -> dict[str, Any]:
    if memory is None:
        return {}
    if isinstance(memory, dict):
        return memory if isinstance(memory, dict) else {}
    metadata = memory.metadata_json or {}
    return metadata if isinstance(metadata, dict) else {}


def coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def coerce_float(value: Any, default: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, numeric))


def is_summary_memory(memory: Memory | dict[str, Any] | None) -> bool:
    metadata = get_memory_metadata(memory)
    return metadata.get("node_kind") == SUMMARY_NODE_KIND or metadata.get("memory_kind") == MEMORY_KIND_SUMMARY


def derive_memory_kind(
    *,
    content: str,
    category: str = "",
    memory_type: str = "permanent",
    metadata: dict[str, Any] | None = None,
) -> str:
    existing = str((metadata or {}).get("memory_kind") or "").strip().lower()
    if existing in _VALID_MEMORY_KINDS:
        return existing
    if is_summary_memory(metadata):
        return MEMORY_KIND_SUMMARY
    if memory_type == "temporary":
        return MEMORY_KIND_EPISODIC

    haystack = f"{category}\n{content}".strip().lower()
    if any(hint in haystack for hint in _PROFILE_HINTS):
        return MEMORY_KIND_PROFILE
    if any(hint in haystack for hint in _PREFERENCE_HINTS):
        return MEMORY_KIND_PREFERENCE
    if any(hint in haystack for hint in _GOAL_HINTS):
        return MEMORY_KIND_GOAL
    if any(hint in haystack for hint in _EPISODIC_HINTS):
        return MEMORY_KIND_EPISODIC
    return MEMORY_KIND_FACT


def get_memory_kind(memory: Memory | dict[str, Any] | None) -> str:
    metadata = get_memory_metadata(memory)
    kind = str(metadata.get("memory_kind") or "").strip().lower()
    if kind in _VALID_MEMORY_KINDS:
        return kind
    if isinstance(memory, Memory):
        return derive_memory_kind(
            content=memory.content,
            category=memory.category,
            memory_type=memory.type,
            metadata=metadata,
        )
    return MEMORY_KIND_FACT


def get_memory_salience(memory: Memory | dict[str, Any] | None) -> float:
    metadata = get_memory_metadata(memory)
    default = 0.55
    if is_summary_memory(memory):
        default = 0.82
    elif isinstance(memory, Memory) and memory.type == "temporary":
        default = 0.45
    return coerce_float(metadata.get("salience", metadata.get("importance")), default)


def is_pinned_memory(memory: Memory | dict[str, Any] | None) -> bool:
    metadata = get_memory_metadata(memory)
    if is_summary_memory(memory):
        return coerce_bool(metadata.get("pinned"), False)
    return coerce_bool(metadata.get("pinned"), False)


def get_summary_source_memory_ids(memory: Memory | dict[str, Any] | None) -> list[str]:
    metadata = get_memory_metadata(memory)
    source_ids = metadata.get("source_memory_ids")
    if not isinstance(source_ids, list):
        return []
    return [item for item in source_ids if isinstance(item, str) and item]


def build_summary_group_key(
    *,
    owner_user_id: str | None,
    parent_memory_id: str | None,
    category: str,
    memory_kind: str,
) -> str:
    normalized_category = ".".join(
        segment.strip().lower()
        for segment in str(category or "").split(".")
        if segment.strip()
    ) or "uncategorized"
    owner_key = owner_user_id or "public"
    parent_key = parent_memory_id or "root"
    return f"{owner_key}|{parent_key}|{memory_kind}|{normalized_category}"


def normalize_memory_metadata(
    *,
    content: str,
    category: str,
    memory_type: str,
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(metadata or {})
    payload["memory_kind"] = derive_memory_kind(
        content=content,
        category=category,
        memory_type=memory_type,
        metadata=payload,
    )
    payload["salience"] = get_memory_salience(payload)
    payload["pinned"] = is_pinned_memory(payload)
    if payload["memory_kind"] == MEMORY_KIND_SUMMARY:
        payload["node_kind"] = SUMMARY_NODE_KIND
    if "last_used_at" in payload and not isinstance(payload.get("last_used_at"), str):
        payload.pop("last_used_at", None)
    return payload


def stamp_memory_usage_metadata(
    metadata: dict[str, Any] | None,
    *,
    source: str,
    score: float | None,
    used_at: datetime | None = None,
) -> dict[str, Any]:
    payload = dict(metadata or {})
    timestamp = (used_at or datetime.now(timezone.utc)).isoformat()
    payload["last_used_at"] = timestamp
    payload["last_used_source"] = source
    payload["retrieval_count"] = int(payload.get("retrieval_count") or 0) + 1
    if score is not None:
        payload["last_retrieval_score"] = round(float(score), 4)
    return payload


def build_summary_memory_metadata(
    *,
    content: str,
    category: str,
    source_memory_ids: list[str],
    summary_group_key: str,
    salience: float,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = dict(metadata or {})
    payload.update(
        {
            "memory_kind": MEMORY_KIND_SUMMARY,
            "node_kind": SUMMARY_NODE_KIND,
            "source_memory_ids": list(dict.fromkeys(source_memory_ids)),
            "source_count": len(list(dict.fromkeys(source_memory_ids))),
            "summary_group_key": summary_group_key,
            "salience": coerce_float(salience, 0.85),
            "auto_generated": True,
            "summarized_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    return normalize_memory_metadata(
        content=content,
        category=category,
        memory_type="permanent",
        metadata=payload,
    )


def shorten_text(value: str, limit: int = 180) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"
