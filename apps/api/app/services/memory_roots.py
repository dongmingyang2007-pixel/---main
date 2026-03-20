from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import inspect, text as sql_text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models import Memory, Project

ASSISTANT_ROOT_NODE_KIND = "assistant-root"
ASSISTANT_ROOT_CATEGORY = "assistant"


def is_assistant_root_memory(memory: Memory | dict[str, Any] | None) -> bool:
    if memory is None:
        return False
    metadata = memory if isinstance(memory, dict) else (memory.metadata_json or {})
    return metadata.get("node_kind") == ASSISTANT_ROOT_NODE_KIND


def build_assistant_root_metadata(
    *,
    project_name: str,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = dict(existing or {})
    metadata["node_kind"] = ASSISTANT_ROOT_NODE_KIND
    metadata["assistant_name"] = project_name
    metadata["system_managed"] = True
    return metadata


def get_project_assistant_root(db: Session, project: Project) -> Memory | None:
    if project.assistant_root_memory_id:
        root = (
            db.query(Memory)
            .filter(
                Memory.id == project.assistant_root_memory_id,
                Memory.project_id == project.id,
                Memory.workspace_id == project.workspace_id,
            )
            .first()
        )
        if root and is_assistant_root_memory(root):
            return root

    candidates = (
        db.query(Memory)
        .filter(
            Memory.project_id == project.id,
            Memory.workspace_id == project.workspace_id,
            Memory.type == "permanent",
        )
        .order_by(Memory.created_at.asc())
        .all()
    )
    root = next((candidate for candidate in candidates if is_assistant_root_memory(candidate)), None)
    if root and project.assistant_root_memory_id != root.id:
        project.assistant_root_memory_id = root.id
    return root


def ensure_project_assistant_root(
    db: Session,
    project: Project,
    *,
    reparent_orphans: bool = True,
) -> tuple[Memory, bool]:
    root = get_project_assistant_root(db, project)
    changed = False
    now = datetime.now(timezone.utc)
    desired_name = (project.name or "").strip() or "Assistant"

    if root is None:
        root = Memory(
            workspace_id=project.workspace_id,
            project_id=project.id,
            content=desired_name,
            category=ASSISTANT_ROOT_CATEGORY,
            type="permanent",
            source_conversation_id=None,
            parent_memory_id=None,
            position_x=0,
            position_y=0,
            metadata_json=build_assistant_root_metadata(project_name=desired_name),
        )
        db.add(root)
        db.flush()
        changed = True

    if project.assistant_root_memory_id != root.id:
        project.assistant_root_memory_id = root.id
        changed = True

    next_metadata = build_assistant_root_metadata(
        project_name=desired_name,
        existing=root.metadata_json,
    )
    if root.content != desired_name:
        root.content = desired_name
        changed = True
    if root.category != ASSISTANT_ROOT_CATEGORY:
        root.category = ASSISTANT_ROOT_CATEGORY
        changed = True
    if root.type != "permanent":
        root.type = "permanent"
        changed = True
    if root.source_conversation_id is not None:
        root.source_conversation_id = None
        changed = True
    if root.parent_memory_id is not None:
        root.parent_memory_id = None
        changed = True
    if root.metadata_json != next_metadata:
        root.metadata_json = next_metadata
        changed = True
    if changed:
        root.updated_at = now

    if reparent_orphans:
        orphan_memories = (
            db.query(Memory)
            .filter(
                Memory.project_id == project.id,
                Memory.workspace_id == project.workspace_id,
                Memory.id != root.id,
                Memory.parent_memory_id.is_(None),
            )
            .all()
        )
        for memory in orphan_memories:
            memory.parent_memory_id = root.id
            memory.updated_at = now
            changed = True

    return root, changed


def ensure_project_memory_root_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "projects" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "assistant_root_memory_id" not in columns:
        with engine.begin() as connection:
            connection.execute(sql_text("ALTER TABLE projects ADD COLUMN assistant_root_memory_id TEXT"))

    with engine.begin() as connection:
        connection.execute(
            sql_text(
                "CREATE INDEX IF NOT EXISTS idx_projects_assistant_root_memory "
                "ON projects (assistant_root_memory_id)"
            )
        )
