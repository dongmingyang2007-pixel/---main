from __future__ import annotations

from typing import Literal, cast

from sqlalchemy import inspect, text as sql_text
from sqlalchemy.engine import Engine


ChatMode = Literal["standard", "omni_realtime", "synthetic_realtime"]

CHAT_MODES: tuple[ChatMode, ...] = ("standard", "omni_realtime", "synthetic_realtime")
DEFAULT_CHAT_MODE: ChatMode = "standard"


def normalize_chat_mode(value: str | None) -> ChatMode:
    if value in CHAT_MODES:
        return cast(ChatMode, value)
    return DEFAULT_CHAT_MODE


def ensure_project_chat_mode_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "projects" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("projects")}
    with engine.begin() as connection:
        if "default_chat_mode" not in columns:
            connection.execute(
                sql_text(
                    "ALTER TABLE projects "
                    "ADD COLUMN default_chat_mode TEXT NOT NULL DEFAULT 'standard'"
                )
            )
        connection.execute(
            sql_text(
                "UPDATE projects "
                "SET default_chat_mode = 'standard' "
                "WHERE default_chat_mode IS NULL OR default_chat_mode = ''"
            )
        )
