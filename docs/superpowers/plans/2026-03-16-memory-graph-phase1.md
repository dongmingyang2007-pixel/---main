# AI 记忆系统 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the memory graph foundation: database tables, CRUD APIs, D3.js knowledge graph visualization with full interactivity, and conversation system with database-backed messages.

**Architecture:** New PostgreSQL tables (with pgvector extension) store memories, edges, embeddings, conversations, and messages. FastAPI routers expose CRUD + search APIs. D3.js force-directed graph renders an interactive knowledge graph as the default AI assistant view. Conversations connect to the existing chat page with real database persistence. Phase 1 uses mock AI responses (real inference in Phase 2).

**Tech Stack:** PostgreSQL 15 + pgvector, SQLAlchemy 2.0, Alembic, FastAPI, D3.js (force-directed graph, Canvas rendering), Next.js 16, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-16-memory-graph-design.md`

---

## Chunk 1: Database & Backend APIs

### Task 1: Install pgvector in Docker

**Files:**
- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: Update PostgreSQL image to pgvector-enabled image**

In `docker/docker-compose.yml`, change the postgres service image:

```yaml
# Change from:
image: postgres:15
# To:
image: pgvector/pgvector:pg15
```

This image includes the pgvector extension pre-installed.

- [ ] **Step 2: Verify by starting the stack**

Run:
```bash
cd /Users/dog/Desktop/铭润
docker compose -f docker/docker-compose.yml up -d postgres
docker compose -f docker/docker-compose.yml exec postgres psql -U postgres -d qihang -c "CREATE EXTENSION IF NOT EXISTS vector;"
```
Expected: `CREATE EXTENSION` with no errors.

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.yml
git commit -m "infra: switch to pgvector/pgvector:pg15 for vector search support"
```

---

### Task 2: Create Alembic Migration for Memory Tables

**Files:**
- Create: `apps/api/alembic/versions/202603160001_memory_tables.py`

- [ ] **Step 1: Create the migration file**

```python
"""Add memory system tables: memories, memory_edges, embeddings, conversations, messages, memory_files

Revision ID: 202603160001
Revises: 202603120001
Create Date: 2026-03-16
"""

from alembic import op

revision = "202603160001"
down_revision = "202603120001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    op.execute("""
        CREATE TABLE conversations (
            id          VARCHAR(36) PRIMARY KEY,
            workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            project_id  VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title       VARCHAR(255) NOT NULL DEFAULT '',
            created_by  VARCHAR(36) NOT NULL REFERENCES users(id),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_conversations_workspace_project ON conversations(workspace_id, project_id);
    """)

    op.execute("""
        CREATE TABLE messages (
            id              VARCHAR(36) PRIMARY KEY,
            conversation_id VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            VARCHAR(20) NOT NULL,
            content         TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
    """)

    op.execute("""
        CREATE TABLE memories (
            id                      VARCHAR(36) PRIMARY KEY,
            workspace_id            VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            project_id              VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            content                 TEXT NOT NULL,
            category                VARCHAR(255) NOT NULL DEFAULT '',
            type                    VARCHAR(20) NOT NULL DEFAULT 'permanent',
            source_conversation_id  VARCHAR(36) REFERENCES conversations(id) ON DELETE SET NULL,
            parent_memory_id        VARCHAR(36) REFERENCES memories(id) ON DELETE SET NULL,
            position_x              DOUBLE PRECISION,
            position_y              DOUBLE PRECISION,
            metadata_json           JSONB NOT NULL DEFAULT '{}',
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_memories_workspace_project ON memories(workspace_id, project_id);
        CREATE INDEX idx_memories_project_type ON memories(project_id, type);
        CREATE INDEX idx_memories_conversation ON memories(source_conversation_id);
    """)

    op.execute("""
        CREATE TABLE memory_edges (
            id                VARCHAR(36) PRIMARY KEY,
            source_memory_id  VARCHAR(36) NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            target_memory_id  VARCHAR(36) NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            edge_type         VARCHAR(20) NOT NULL DEFAULT 'auto',
            strength          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_memory_edge UNIQUE (source_memory_id, target_memory_id)
        );
    """)

    op.execute("""
        CREATE TABLE embeddings (
            id            VARCHAR(36) PRIMARY KEY,
            workspace_id  VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            project_id    VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            memory_id     VARCHAR(36) REFERENCES memories(id) ON DELETE CASCADE,
            data_item_id  VARCHAR(36) REFERENCES data_items(id) ON DELETE CASCADE,
            chunk_text    TEXT NOT NULL,
            vector        vector(1024),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT chk_embedding_ref CHECK (memory_id IS NOT NULL OR data_item_id IS NOT NULL)
        );
        CREATE INDEX idx_embeddings_workspace_project ON embeddings(workspace_id, project_id);
    """)

    op.execute("""
        CREATE TABLE memory_files (
            id            VARCHAR(36) PRIMARY KEY,
            memory_id     VARCHAR(36) NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            data_item_id  VARCHAR(36) NOT NULL REFERENCES data_items(id) ON DELETE CASCADE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS memory_files;")
    op.execute("DROP TABLE IF EXISTS embeddings;")
    op.execute("DROP TABLE IF EXISTS memory_edges;")
    op.execute("DROP TABLE IF EXISTS memories;")
    op.execute("DROP TABLE IF EXISTS messages;")
    op.execute("DROP TABLE IF EXISTS conversations;")
```

Note: The HNSW index on embeddings.vector will be created in Phase 2 when we start inserting actual vectors. Creating it on an empty table is fine but provides no benefit until data exists.

- [ ] **Step 2: Run migration**

```bash
cd /Users/dog/Desktop/铭润/apps/api
alembic upgrade head
```
Expected: Migration applies cleanly.

- [ ] **Step 3: Verify tables exist**

```bash
docker compose -f docker/docker-compose.yml exec postgres psql -U postgres -d qihang -c "\dt"
```
Expected: All 6 new tables listed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/alembic/versions/202603160001_memory_tables.py
git commit -m "feat(api): add memory system database tables with pgvector"
```

---

### Task 3: Create SQLAlchemy ORM Models

**Files:**
- Modify: `apps/api/app/models/entities.py` (append new models)

- [ ] **Step 1: Add the 6 new ORM models**

Append to `apps/api/app/models/entities.py`:

```python
# ── Memory System ──

class Conversation(UUIDPrimaryKeyMixin, TimestampMixin, UpdatedAtMixin, Base):
    __tablename__ = "conversations"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

class Message(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "messages"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

class Memory(UUIDPrimaryKeyMixin, TimestampMixin, UpdatedAtMixin, Base):
    __tablename__ = "memories"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="permanent", nullable=False)
    source_conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    parent_memory_id: Mapped[str | None] = mapped_column(ForeignKey("memories.id", ondelete="SET NULL"), nullable=True)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

class MemoryEdge(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "memory_edges"
    __table_args__ = (UniqueConstraint("source_memory_id", "target_memory_id", name="uq_memory_edge"),)
    source_memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), nullable=False)
    target_memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), nullable=False)
    edge_type: Mapped[str] = mapped_column(String(20), default="auto", nullable=False)
    strength: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)

class Embedding(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "embeddings"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    memory_id: Mapped[str | None] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), nullable=True)
    data_item_id: Mapped[str | None] = mapped_column(ForeignKey("data_items.id", ondelete="CASCADE"), nullable=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    # vector column managed by pgvector, not mapped in ORM (use raw SQL for vector ops)
    # ORM is used for CRUD; vector search uses raw SQL queries

class MemoryFile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "memory_files"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), nullable=False)
    data_item_id: Mapped[str] = mapped_column(ForeignKey("data_items.id", ondelete="CASCADE"), nullable=False)
```

- [ ] **Step 2: Verify imports are correct**

Ensure `Float`, `String`, `Text`, `JSON` are imported from sqlalchemy. Check existing imports at top of entities.py and add any missing ones.

- [ ] **Step 3: Verify models load**

```bash
cd /Users/dog/Desktop/铭润/apps/api
python -c "from app.models.entities import Conversation, Message, Memory, MemoryEdge, Embedding, MemoryFile; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/models/entities.py
git commit -m "feat(api): add ORM models for memory system"
```

---

### Task 4: Create Pydantic Schemas

**Files:**
- Create: `apps/api/app/schemas/memory.py`
- Create: `apps/api/app/schemas/conversation.py`

- [ ] **Step 1: Create memory schemas**

```python
# apps/api/app/schemas/memory.py
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class MemoryCreate(BaseModel):
    project_id: str
    content: str
    category: str = ""
    type: str = "permanent"
    parent_memory_id: str | None = None


class MemoryUpdate(BaseModel):
    content: str | None = None
    category: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    parent_memory_id: str | None = None


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
    files: list[MemoryFileOut] = []
    edges: list[MemoryEdgeOut] = []


class MemoryGraphOut(BaseModel):
    nodes: list[MemoryOut]
    edges: list[MemoryEdgeOut]


class MemorySearchRequest(BaseModel):
    project_id: str
    query: str
    limit: int = 10


class MemorySearchResult(BaseModel):
    memory: MemoryOut
    score: float
```

- [ ] **Step 2: Create conversation schemas**

```python
# apps/api/app/schemas/conversation.py
from datetime import datetime

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    project_id: str
    title: str = ""


class ConversationOut(BaseModel):
    id: str
    workspace_id: str
    project_id: str
    title: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: datetime


class MessageCreate(BaseModel):
    content: str
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/schemas/memory.py apps/api/app/schemas/conversation.py
git commit -m "feat(api): add Pydantic schemas for memory and conversation APIs"
```

---

### Task 5: Create Memory CRUD Router

**Files:**
- Create: `apps/api/app/routers/memory.py`

- [ ] **Step 1: Create the memory router**

```python
# apps/api/app/routers/memory.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db_session, get_current_user, get_current_workspace_id, require_csrf_protection
from app.core.errors import ApiError
from app.models.entities import Memory, MemoryEdge, MemoryFile, User
from app.schemas.memory import (
    MemoryCreate, MemoryUpdate, MemoryOut, MemoryDetailOut,
    MemoryEdgeCreate, MemoryEdgeOut,
    MemoryGraphOut, MemoryFileOut,
)

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


@router.get("", response_model=MemoryGraphOut)
def get_memory_graph(
    project_id: str,
    conversation_id: str | None = None,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
):
    """Get the full memory graph for an AI assistant.
    Returns all permanent memories + temporary memories for the given conversation."""
    from sqlalchemy import or_

    query = db.query(Memory).filter(
        Memory.workspace_id == workspace_id,
        Memory.project_id == project_id,
    )

    if conversation_id:
        query = query.filter(
            or_(
                Memory.type == "permanent",
                Memory.source_conversation_id == conversation_id,
            )
        )
    else:
        query = query.filter(Memory.type == "permanent")

    nodes = query.order_by(Memory.created_at).all()
    node_ids = {n.id for n in nodes}

    edges = (
        db.query(MemoryEdge)
        .filter(
            MemoryEdge.source_memory_id.in_(node_ids),
            MemoryEdge.target_memory_id.in_(node_ids),
        )
        .all()
    )

    return MemoryGraphOut(
        nodes=[MemoryOut.model_validate(n, from_attributes=True) for n in nodes],
        edges=[MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges],
    )


@router.post("", response_model=MemoryOut)
def create_memory(
    payload: MemoryCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    memory = Memory(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        content=payload.content,
        category=payload.category,
        type=payload.type,
        parent_memory_id=payload.parent_memory_id,
    )
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.get("/{memory_id}", response_model=MemoryDetailOut)
def get_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
):
    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.workspace_id == workspace_id,
    ).first()
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    files = db.query(MemoryFile).filter(MemoryFile.memory_id == memory_id).all()
    edges = db.query(MemoryEdge).filter(
        (MemoryEdge.source_memory_id == memory_id) | (MemoryEdge.target_memory_id == memory_id)
    ).all()

    result = MemoryDetailOut.model_validate(memory, from_attributes=True)
    result.files = [MemoryFileOut.model_validate(f, from_attributes=True) for f in files]
    result.edges = [MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges]
    return result


@router.patch("/{memory_id}", response_model=MemoryOut)
def update_memory(
    memory_id: str,
    payload: MemoryUpdate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    from datetime import datetime, timezone

    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.workspace_id == workspace_id,
    ).first()
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(memory, key, value)
    memory.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.workspace_id == workspace_id,
    ).first()
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    db.delete(memory)  # CASCADE handles edges, embeddings, files
    db.commit()
    return {"ok": True}


@router.post("/{memory_id}/promote", response_model=MemoryOut)
def promote_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    from datetime import datetime, timezone

    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.workspace_id == workspace_id,
    ).first()
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)
    if memory.type == "permanent":
        raise ApiError("invalid_request", "Memory is already permanent", status_code=400)

    memory.type = "permanent"
    memory.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


# ── Edges ──

@router.post("/edges", response_model=MemoryEdgeOut)
def create_edge(
    payload: MemoryEdgeCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    # Verify both memories exist and belong to the same workspace
    source = db.query(Memory).filter(Memory.id == payload.source_memory_id, Memory.workspace_id == workspace_id).first()
    target = db.query(Memory).filter(Memory.id == payload.target_memory_id, Memory.workspace_id == workspace_id).first()
    if not source or not target:
        raise ApiError("not_found", "One or both memories not found", status_code=404)

    edge = MemoryEdge(
        source_memory_id=payload.source_memory_id,
        target_memory_id=payload.target_memory_id,
        edge_type="manual",
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return MemoryEdgeOut.model_validate(edge, from_attributes=True)


@router.delete("/edges/{edge_id}")
def delete_edge(
    edge_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    edge = db.query(MemoryEdge).filter(MemoryEdge.id == edge_id).first()
    if not edge:
        raise ApiError("not_found", "Edge not found", status_code=404)
    db.delete(edge)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 2: Register router in main app**

In `apps/api/app/main.py` (or wherever routers are registered), add:

```python
from app.routers.memory import router as memory_router
app.include_router(memory_router)
```

- [ ] **Step 3: Verify API loads**

```bash
cd /Users/dog/Desktop/铭润/apps/api
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
curl http://localhost:8000/docs | grep memory
kill %1
```
Expected: Memory endpoints appear in OpenAPI docs.

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/routers/memory.py apps/api/app/main.py
git commit -m "feat(api): add memory CRUD and edge management API endpoints"
```

---

### Task 6: Create Conversation Router

**Files:**
- Create: `apps/api/app/routers/chat.py`

- [ ] **Step 1: Create the chat router**

```python
# apps/api/app/routers/chat.py
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db_session, get_current_user, get_current_workspace_id, require_csrf_protection
from app.core.errors import ApiError
from app.models.entities import Conversation, Message, Memory, User
from app.schemas.conversation import ConversationCreate, ConversationOut, MessageCreate, MessageOut

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# Mock responses for Phase 1 (replaced by real inference in Phase 2)
MOCK_RESPONSES = [
    "你好！我是你的 AI 助手，很高兴为你服务。有什么我可以帮你的吗？",
    "这是一个很好的问题。让我为你详细解答一下……",
    "根据我的知识库中的信息，我可以告诉你以下内容……",
    "明白了，让我想想最好的方式来回答你。",
    "感谢你的提问！这个话题很有趣，以下是我的看法……",
]


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    project_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
):
    convos = (
        db.query(Conversation)
        .filter(
            Conversation.workspace_id == workspace_id,
            Conversation.project_id == project_id,
        )
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [ConversationOut.model_validate(c, from_attributes=True) for c in convos]


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    convo = Conversation(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        title=payload.title or "新对话",
        created_by=current_user.id,
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return ConversationOut.model_validate(convo, from_attributes=True)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    convo = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id,
    ).first()
    if not convo:
        raise ApiError("not_found", "Conversation not found", status_code=404)

    # Also delete temporary memories associated with this conversation
    db.query(Memory).filter(
        Memory.source_conversation_id == conversation_id,
        Memory.type == "temporary",
    ).delete()

    db.delete(convo)  # CASCADE deletes messages
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
):
    # Verify conversation belongs to workspace
    convo = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id,
    ).first()
    if not convo:
        raise ApiError("not_found", "Conversation not found", status_code=404)

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .all()
    )
    return [MessageOut.model_validate(m, from_attributes=True) for m in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
def send_message(
    conversation_id: str,
    payload: MessageCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
):
    import random

    # Verify conversation
    convo = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.workspace_id == workspace_id,
    ).first()
    if not convo:
        raise ApiError("not_found", "Conversation not found", status_code=404)

    # Save user message
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
    )
    db.add(user_msg)

    # Phase 1: Mock AI response (replaced by inference orchestrator in Phase 2)
    ai_response = random.choice(MOCK_RESPONSES)
    ai_msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=ai_response,
    )
    db.add(ai_msg)

    # Update conversation timestamp
    convo.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(ai_msg)
    return MessageOut.model_validate(ai_msg, from_attributes=True)
```

- [ ] **Step 2: Register router**

Add to `apps/api/app/main.py`:

```python
from app.routers.chat import router as chat_router
app.include_router(chat_router)
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/routers/chat.py apps/api/app/main.py
git commit -m "feat(api): add conversation and message API with mock responses"
```

---

## Chunk 2: Frontend — D3.js Knowledge Graph

### Task 7: Create Graph Data Hook

**Files:**
- Create: `apps/web/hooks/useGraphData.ts`

- [ ] **Step 1: Create the data fetching hook**

```typescript
// apps/web/hooks/useGraphData.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export interface MemoryNode {
  id: string;
  workspace_id: string;
  project_id: string;
  content: string;
  category: string;
  type: "permanent" | "temporary";
  source_conversation_id: string | null;
  parent_memory_id: string | null;
  position_x: number | null;
  position_y: number | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // D3 simulation fields (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface MemoryEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  edge_type: "auto" | "manual";
  strength: number;
  created_at: string;
  // D3 simulation fields
  source?: string | MemoryNode;
  target?: string | MemoryNode;
}

interface GraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export function useGraphData(projectId: string, conversationId?: string) {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  const fetchGraph = useCallback(async () => {
    try {
      const params = new URLSearchParams({ project_id: projectId });
      if (conversationId) params.set("conversation_id", conversationId);
      const result = await apiGet<GraphData>(`/api/v1/memory?${params}`);
      setData(result);
    } catch {
      // silently fail, show empty graph
    } finally {
      setLoading(false);
    }
  }, [projectId, conversationId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const createMemory = async (content: string, category?: string) => {
    const node = await apiPost<MemoryNode>("/api/v1/memory", {
      project_id: projectId,
      content,
      category: category || "",
    });
    setData((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    return node;
  };

  const updateMemory = async (id: string, updates: Partial<MemoryNode>) => {
    const updated = await apiPatch<MemoryNode>(`/api/v1/memory/${id}`, updates);
    setData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updated } : n)),
    }));
  };

  const deleteMemory = async (id: string) => {
    await apiDelete(`/api/v1/memory/${id}`);
    setData((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source_memory_id !== id && e.target_memory_id !== id),
    }));
  };

  const promoteMemory = async (id: string) => {
    const updated = await apiPost<MemoryNode>(`/api/v1/memory/${id}/promote`);
    setData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updated } : n)),
    }));
  };

  const createEdge = async (sourceId: string, targetId: string) => {
    const edge = await apiPost<MemoryEdge>("/api/v1/memory/edges", {
      source_memory_id: sourceId,
      target_memory_id: targetId,
    });
    setData((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
  };

  const deleteEdge = async (id: string) => {
    await apiDelete(`/api/v1/memory/edges/${id}`);
    setData((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== id),
    }));
  };

  return {
    data,
    loading,
    refetch: fetchGraph,
    createMemory,
    updateMemory,
    deleteMemory,
    promoteMemory,
    createEdge,
    deleteEdge,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/hooks/useGraphData.ts
git commit -m "feat(web): add useGraphData hook for memory graph API"
```

---

### Task 8: Build D3.js Memory Graph Component

**Files:**
- Create: `apps/web/components/console/graph/MemoryGraph.tsx`
- Create: `apps/web/components/console/graph/GraphContextMenu.tsx`
- Create: `apps/web/components/console/graph/NodeDetail.tsx`
- Create: `apps/web/components/console/graph/GraphControls.tsx`
- Create: `apps/web/components/console/graph/GraphFilters.tsx`
- Modify: `apps/web/styles/globals.css` (add graph CSS)

This is the largest task. The implementer should:

- [ ] **Step 1: Install D3.js**

```bash
cd /Users/dog/Desktop/铭润/apps/web
npm install d3 @types/d3
```

- [ ] **Step 2: Create MemoryGraph component**

The main D3 force-directed graph component. Key implementation details:
- Use `useRef` for the Canvas element
- Initialize D3 `forceSimulation` with `forceCenter`, `forceLink`, `forceManyBody`, `forceCollide`
- Render using Canvas 2D context (not SVG) for performance
- Node rendering: circles for memories (red=permanent, blue=temporary), rounded rects for files
- Center node: larger, gradient fill (accent color)
- Edge rendering: solid lines for permanent, dashed for temporary
- Interactions: zoom/pan (D3 zoom), click (select node), drag (move node), double-click (create node)
- On drag-end: call `updateMemory` to save position_x/position_y
- Shift+drag from node to node: create edge
- Right-click: show context menu
- Node labels: category or first 10 chars of content

The component should accept these props:
```typescript
interface MemoryGraphProps {
  projectId: string;
  conversationId?: string;
  onNodeSelect: (node: MemoryNode | null) => void;
}
```

- [ ] **Step 3: Create GraphContextMenu**

Right-click menu with options:
- On node: "查看详情", "编辑", "删除", "设为永久" (only for blue), "连接到..."
- On blank: "添加记忆"

- [ ] **Step 4: Create NodeDetail (right-side panel)**

Sliding panel showing:
- Memory content (editable textarea)
- Category
- Type badge (永久/临时)
- Source conversation link
- Associated files list
- Created/updated timestamps
- Developer mode: raw JSON, IDs
- Delete button
- Edit/save buttons

- [ ] **Step 5: Create GraphControls (bottom toolbar)**

Toolbar with:
- "+ 添加记忆" button
- Search input (highlights matching nodes)
- Statistics: "共 X 个记忆 · X 个文件"
- Zoom controls: +, -, fit-to-view

- [ ] **Step 6: Create GraphFilters (left sidebar)**

Filter panel with checkboxes:
- By type: ☑ 永久记忆 ☑ 临时记忆 ☑ 文件
- By category: dynamic list from data
- By time: last 24h, last 7d, last 30d, all
- Search box

- [ ] **Step 7: Add graph CSS to globals.css**

```css
/* Memory Graph */
.graph-container { position: relative; width: 100%; height: 100%; }
.graph-canvas { width: 100%; height: 100%; cursor: grab; }
.graph-canvas:active { cursor: grabbing; }

.graph-filters { width: 160px; background: var(--bg-surface); border-right: 1px solid var(--border-light); padding: 16px; overflow-y: auto; flex-shrink: 0; }
.graph-filters-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; }
.graph-filter-group { margin-bottom: 16px; }
.graph-filter-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); padding: 4px 0; cursor: pointer; }

.graph-detail { width: 280px; background: var(--bg-card); border-left: 1px solid var(--border); padding: 20px; overflow-y: auto; box-shadow: var(--shadow-raised); }
.graph-detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.graph-detail-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; }

.graph-controls { height: 40px; background: var(--bg-surface); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; flex-shrink: 0; }
.graph-controls-left { display: flex; align-items: center; gap: 8px; }
.graph-controls-right { display: flex; align-items: center; gap: 8px; }
.graph-control-btn { padding: 4px 12px; background: none; border: 1px solid var(--border); border-radius: var(--radius-badge); font-size: 11px; color: var(--text-secondary); cursor: pointer; }
.graph-control-btn:hover { border-color: var(--accent); color: var(--accent); }
.graph-stats { font-size: 11px; color: var(--text-muted); }
.graph-search { padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius-badge); font-size: 11px; background: var(--bg-card); color: var(--text-primary); width: 160px; }

.graph-context-menu { position: fixed; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-badge); box-shadow: var(--shadow-raised); padding: 4px; z-index: 100; min-width: 160px; }
.graph-context-item { display: block; width: 100%; padding: 8px 12px; background: none; border: none; text-align: left; font-size: 12px; color: var(--text-primary); cursor: pointer; border-radius: 4px; }
.graph-context-item:hover { background: var(--accent-soft); color: var(--accent); }
.graph-context-item.is-danger { color: var(--error); }
.graph-context-item.is-danger:hover { background: var(--error-soft); }
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/console/graph/ apps/web/styles/globals.css package.json package-lock.json
git commit -m "feat(web): add D3.js memory graph with full interaction support"
```

---

### Task 9: Integrate Graph into Assistant Detail Page

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`
- Modify: `apps/web/messages/zh/console-assistants.json` (add graph i18n keys)
- Modify: `apps/web/messages/en/console-assistants.json`

- [ ] **Step 1: Add tab switching between Graph and Config views**

Rewrite the assistant detail page to show two tabs:
- 🕸 记忆图谱 (default, active tab)
- ⚙️ 配置 (shows the existing CanvasWorkbench)

When graph tab is active, render:
```
┌──────────────────────────────────────────────────────┐
│  TopBar: [🕸 记忆图谱 | ⚙️ 配置]  + 试用对话 + 保存  │
├────┬─────────────────────────────────┬───────────────┤
│筛选│       MemoryGraph (D3)          │  NodeDetail   │
│面板│                                 │  (if selected)│
├────┴─────────────────────────────────┴───────────────┤
│  GraphControls                                       │
└──────────────────────────────────────────────────────┘
```

- [ ] **Step 2: Add i18n keys**

Add to console-assistants.json (both locales):
- `graph.tab`: "记忆图谱" / "Memory Graph"
- `config.tab`: "配置" / "Config"
- `graph.addMemory`: "添加记忆" / "Add Memory"
- `graph.search`: "搜索记忆…" / "Search memories…"
- `graph.stats`: "共 {count} 个记忆" / "{count} memories"
- `graph.filterAll`: "全部" / "All"
- `graph.filterPermanent`: "永久记忆" / "Permanent"
- `graph.filterTemporary`: "临时记忆" / "Temporary"
- `graph.filterFiles`: "文件" / "Files"
- `graph.promote`: "设为永久" / "Make Permanent"
- `graph.delete`: "删除" / "Delete"
- `graph.edit`: "编辑" / "Edit"
- `graph.viewDetail`: "查看详情" / "View Detail"

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx" apps/web/messages/
git commit -m "feat(web): integrate memory graph as default assistant view with tab switching"
```

---

### Task 10: Update Chat Page to Use Real Conversations

**Files:**
- Modify: `apps/web/components/console/ChatInterface.tsx` (connect to real API)
- Modify: `apps/web/app/[locale]/(console)/app/chat/page.tsx` (add conversation list)

- [ ] **Step 1: Add conversation management to chat page**

Update the chat page to:
- Left sidebar: list of conversations for the selected AI assistant (from `GET /api/v1/chat/conversations`)
- "新建对话" button (calls `POST /api/v1/chat/conversations`)
- Delete conversation (calls `DELETE /api/v1/chat/conversations/{id}`)
- AI assistant selector dropdown at top

- [ ] **Step 2: Update ChatInterface to use real API**

Replace mock responses in ChatInterface with real API calls:
- Load messages from `GET /api/v1/chat/conversations/{id}/messages`
- Send message via `POST /api/v1/chat/conversations/{id}/messages`
- AI response comes from server (still mock in Phase 1, but via API)
- Keep the typing indicator animation

- [ ] **Step 3: Add conversation i18n keys**

Add to console-chat.json:
- `newConversation`: "新建对话" / "New Conversation"
- `deleteConversation`: "删除对话" / "Delete Conversation"
- `selectAssistant`: "选择 AI 助手" / "Select AI Assistant"
- `noConversations`: "暂无对话" / "No conversations yet"

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/ChatInterface.tsx "apps/web/app/[locale]/(console)/app/chat/page.tsx" apps/web/messages/
git commit -m "feat(web): connect chat page to real conversation API"
```

---

### Task 11: Build & Verify

- [ ] **Step 1: Run TypeScript compilation**

```bash
cd /Users/dog/Desktop/铭润/apps/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Run Next.js build**

```bash
cd /Users/dog/Desktop/铭润/apps/web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Run backend tests**

```bash
cd /Users/dog/Desktop/铭润/apps/api && pytest -q
```
Expected: All existing tests pass (new endpoints not yet tested, that's OK for Phase 1).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues for memory graph phase 1"
```
