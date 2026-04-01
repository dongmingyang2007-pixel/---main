from datetime import datetime
from typing import Any

from pydantic import AliasChoices, BaseModel, Field, field_validator


class MemoryCreate(BaseModel):
    project_id: str
    content: str
    category: str = ""
    type: str = "permanent"
    node_type: str | None = None
    subject_kind: str | None = None
    subject_memory_id: str | None = None
    node_status: str | None = None
    canonical_key: str | None = None
    source_conversation_id: str | None = None
    parent_memory_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class MemoryUpdate(BaseModel):
    content: str | None = None
    category: str | None = None
    node_type: str | None = None
    subject_kind: str | None = None
    subject_memory_id: str | None = None
    node_status: str | None = None
    canonical_key: str | None = None
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
    node_type: str | None = None
    subject_kind: str | None = None
    subject_memory_id: str | None = None
    node_status: str | None = None
    canonical_key: str | None = None
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
    edge_type: str = "manual"
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
    filename: str | None = None
    media_type: str | None = None
    created_at: datetime


class MemoryFileAttachRequest(BaseModel):
    data_item_id: str


class MemoryFileCandidateOut(BaseModel):
    id: str
    dataset_id: str
    filename: str
    media_type: str
    created_at: datetime


class MemoryDetailOut(MemoryOut):
    edges: list[MemoryEdgeOut] = []
    files: list[MemoryFileOut] = []


class MemoryGraphOut(BaseModel):
    nodes: list[MemoryOut]
    edges: list[MemoryEdgeOut]


class MemorySearchRequest(BaseModel):
    project_id: str
    query: str
    top_k: int = Field(default=10, ge=1, le=20, validation_alias=AliasChoices("top_k", "limit"))
    category: str | None = None
    type: str | None = None

    @field_validator("query")
    @classmethod
    def _trim_query(cls, value: str) -> str:
        return value.strip()


class MemorySearchResult(BaseModel):
    memory: MemoryOut
    score: float
    chunk_text: str


class SubjectResolveRequest(BaseModel):
    project_id: str
    query: str
    conversation_id: str | None = None


class SubjectResolveCandidate(BaseModel):
    subject_id: str
    confidence: float
    label: str
    subject_kind: str | None = None
    canonical_key: str | None = None


class SubjectResolveResult(BaseModel):
    primary_subject_id: str | None = None
    subjects: list[SubjectResolveCandidate] = Field(default_factory=list)


class SubjectOverviewOut(BaseModel):
    subject: MemoryOut
    concepts: list[MemoryOut] = Field(default_factory=list)
    facts: list[MemoryOut] = Field(default_factory=list)
    suggested_paths: list[str] = Field(default_factory=list)


class SubgraphRequest(BaseModel):
    query: str = ""
    depth: int = Field(default=2, ge=1, le=4)
    edge_types: list[str] = Field(default_factory=list)


class SubgraphOut(BaseModel):
    nodes: list[MemoryOut] = Field(default_factory=list)
    edges: list[MemoryEdgeOut] = Field(default_factory=list)
