from datetime import datetime
from typing import Any

from pydantic import BaseModel


class MemoryCreate(BaseModel):
    project_id: str
    content: str
    category: str = ""
    type: str = "permanent"
    source_conversation_id: str | None = None
    parent_memory_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    metadata_json: dict[str, Any] = {}


class MemoryUpdate(BaseModel):
    content: str | None = None
    category: str | None = None
    type: str | None = None
    parent_memory_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    metadata_json: dict[str, Any] | None = None


class MemoryOut(BaseModel):
    id: str
    workspace_id: str
    project_id: str
    content: str
    category: str
    type: str
    source_conversation_id: str | None
    parent_memory_id: str | None
    position_x: float | None
    position_y: float | None
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class MemoryEdgeCreate(BaseModel):
    source_memory_id: str
    target_memory_id: str
    edge_type: str = "auto"
    strength: float = 0.5


class MemoryEdgeOut(BaseModel):
    id: str
    source_memory_id: str
    target_memory_id: str
    edge_type: str
    strength: float
    created_at: datetime


class MemoryFileOut(BaseModel):
    id: str
    memory_id: str
    data_item_id: str
    created_at: datetime


class MemoryDetailOut(MemoryOut):
    edges: list[MemoryEdgeOut] = []
    files: list[MemoryFileOut] = []


class MemoryGraphOut(BaseModel):
    memories: list[MemoryOut]
    edges: list[MemoryEdgeOut]


class MemorySearchRequest(BaseModel):
    query: str
    top_k: int = 10
    category: str | None = None
    type: str | None = None


class MemorySearchResult(BaseModel):
    memory: MemoryOut
    score: float
    chunk_text: str
