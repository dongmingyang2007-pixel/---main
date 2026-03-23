from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.models.entities import DataItem
from app.services.context_loader import filter_knowledge_chunks
from app.services.embedding import search_similar
from app.services.memory_context import search_project_memories_for_tool


FUNCTION_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_project_knowledge",
            "description": "Search the current project's uploaded knowledge base for relevant excerpts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query to run."},
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of excerpts to return.",
                        "minimum": 1,
                        "maximum": 8,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_project_memories",
            "description": "Search remembered user facts and conversation memory related to the current project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query to run."},
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of memories to return.",
                        "minimum": 1,
                        "maximum": 8,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": "Get the current server time, optionally in a supplied IANA timezone name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "Optional IANA timezone, for example Asia/Shanghai or Europe/London.",
                    }
                },
            },
        },
    },
]

_FUNCTION_TOOL_NAMES = {
    tool["function"]["name"]
    for tool in FUNCTION_TOOLS
    if isinstance(tool.get("function"), dict) and isinstance(tool["function"].get("name"), str)
}


def get_function_tools() -> list[dict[str, Any]]:
    return [json.loads(json.dumps(tool)) for tool in FUNCTION_TOOLS]


def get_response_function_tools() -> list[dict[str, Any]]:
    response_tools: list[dict[str, Any]] = []
    for tool in FUNCTION_TOOLS:
        function_payload = tool.get("function")
        if not isinstance(function_payload, dict):
            continue
        name = function_payload.get("name")
        if not isinstance(name, str) or not name:
            continue
        response_tool = {
            "type": "function",
            "name": name,
        }
        description = function_payload.get("description")
        if isinstance(description, str) and description:
            response_tool["description"] = description
        parameters = function_payload.get("parameters")
        if isinstance(parameters, dict):
            response_tool["parameters"] = json.loads(json.dumps(parameters))
        response_tools.append(response_tool)
    return response_tools


def _clamp_top_k(value: Any, default: int = 4) -> int:
    if not isinstance(value, int):
        return default
    return max(1, min(value, 8))


def _shorten_excerpt(text: str, limit: int = 600) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


async def _search_project_knowledge(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    query: str,
    top_k: int,
) -> dict[str, Any]:
    semantic_results = await search_similar(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        query=query,
        limit=max(12, top_k * 3),
    )
    knowledge_results = [
        result
        for result in filter_knowledge_chunks(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            results=semantic_results,
        )
        if not result.get("memory_id")
    ][:top_k]

    data_item_ids = [result["data_item_id"] for result in knowledge_results if result.get("data_item_id")]
    filenames = {
        item.id: item.filename
        for item in db.query(DataItem)
        .filter(DataItem.id.in_(data_item_ids))
        .all()
    } if data_item_ids else {}

    return {
        "query": query,
        "results": [
            {
                "filename": filenames.get(result.get("data_item_id"), "未命名资料"),
                "score": result.get("score"),
                "excerpt": _shorten_excerpt(result.get("chunk_text") or ""),
            }
            for result in knowledge_results
        ],
    }


async def _search_project_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    conversation_created_by: str | None,
    query: str,
    top_k: int,
) -> dict[str, Any]:
    visible_results = await search_project_memories_for_tool(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        conversation_created_by=conversation_created_by,
        query=query,
        top_k=top_k,
        semantic_search_fn=search_similar,
    )
    return {
        "query": query,
        "results": [
            {
                **result,
                "content": _shorten_excerpt(str(result.get("content") or "")),
            }
            for result in visible_results
        ],
    }


def _get_current_datetime(*, timezone_name: str | None = None) -> dict[str, Any]:
    resolved_timezone = "UTC"
    tzinfo = timezone.utc
    if timezone_name:
        try:
            tzinfo = ZoneInfo(timezone_name)
            resolved_timezone = timezone_name
        except ZoneInfoNotFoundError:
            resolved_timezone = "UTC"
            tzinfo = timezone.utc

    now = datetime.now(tzinfo)
    return {
        "timezone": resolved_timezone,
        "current_time": now.isoformat(),
        "date": now.date().isoformat(),
        "weekday": now.strftime("%A"),
        "unix_seconds": int(now.timestamp()),
    }


async def execute_function_tool_call(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    conversation_created_by: str | None,
    name: str,
    arguments_json: str,
) -> dict[str, Any]:
    if name not in _FUNCTION_TOOL_NAMES:
        return {"ok": False, "error": f"unknown_tool:{name}"}

    try:
        raw_arguments = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_json_arguments"}

    if not isinstance(raw_arguments, dict):
        return {"ok": False, "error": "invalid_tool_arguments"}

    try:
        if name == "search_project_knowledge":
            query = str(raw_arguments.get("query") or "").strip()
            if not query:
                return {"ok": False, "error": "missing_query"}
            return {
                "ok": True,
                **await _search_project_knowledge(
                    db,
                    workspace_id=workspace_id,
                    project_id=project_id,
                    query=query,
                    top_k=_clamp_top_k(raw_arguments.get("top_k")),
                ),
            }
        if name == "search_project_memories":
            query = str(raw_arguments.get("query") or "").strip()
            if not query:
                return {"ok": False, "error": "missing_query"}
            return {
                "ok": True,
                **await _search_project_memories(
                    db,
                    workspace_id=workspace_id,
                    project_id=project_id,
                    conversation_id=conversation_id,
                    conversation_created_by=conversation_created_by,
                    query=query,
                    top_k=_clamp_top_k(raw_arguments.get("top_k")),
                ),
            }
        return {
            "ok": True,
            **_get_current_datetime(timezone_name=str(raw_arguments.get("timezone") or "").strip() or None),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"tool_execution_failed:{exc}"}
