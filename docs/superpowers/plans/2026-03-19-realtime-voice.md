# Real-Time Full-Duplex Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-duplex real-time voice conversation via dual WebSocket bridge (browser ↔ FastAPI ↔ DashScope Omni), with smart interruption and a dynamic island floating UI.

**Architecture:** FastAPI WebSocket endpoint accepts client audio, relays to DashScope `qwen3-omni-flash-realtime` via upstream WebSocket, and streams back audio deltas. A shared `context_loader.py` extracts personality/memory/RAG logic from `orchestrator.py` so both HTTP and WebSocket paths reuse it. Frontend adds a draggable pill/panel widget with real-time waveform and transcript display.

**Tech Stack:** FastAPI WebSocket, DashScope OpenAI Realtime API v1, Web Audio API (AudioWorklet), React state machine, PCM audio streaming

**Spec:** `docs/superpowers/specs/2026-03-19-realtime-voice-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/api/app/core/config.py` | Modify | Add 8 realtime settings |
| `apps/api/app/services/context_loader.py` | Create | Shared context assembly (personality, memories, RAG) |
| `apps/api/app/services/orchestrator.py` | Modify | Replace private helpers with calls to context_loader |
| `apps/api/app/services/realtime_bridge.py` | Create | Dual WebSocket bridge, interruption logic, session lifecycle |
| `apps/api/app/routers/realtime.py` | Create | FastAPI WebSocket endpoint with auth |
| `apps/api/app/main.py` | Modify | Register realtime router |
| `apps/api/tests/test_realtime.py` | Create | Backend tests |
| `apps/web/hooks/useRealtimeVoice.ts` | Create | WebSocket client, audio capture/playback, state machine |
| `apps/web/components/console/RealtimeVoice.tsx` | Create | Dynamic island floating widget |
| `apps/web/components/console/ChatInterface.tsx` | Modify | Mount RealtimeVoice widget |
| `apps/web/styles/globals.css` | Modify | Realtime voice widget styles |

---

## Task 1: Add Realtime Configuration Settings

**Files:**
- Modify: `apps/api/app/core/config.py`
- Test: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_realtime.py`:

```python
"""Tests for real-time voice features."""
from app.core.config import Settings


def test_realtime_settings_defaults():
    s = Settings(
        database_url="postgresql+psycopg://x:x@localhost/test",
        jwt_secret="test-secret-that-is-long-enough-32chars",
    )
    assert s.realtime_interrupt_threshold_ms == 500
    assert s.realtime_idle_timeout_seconds == 60
    assert s.realtime_close_timeout_seconds == 120
    assert s.realtime_max_session_seconds == 1800
    assert s.realtime_max_concurrent_sessions == 50
    assert s.realtime_context_history_turns == 10
    assert s.realtime_rag_refresh_turns == 5
    assert s.realtime_reconnect_max_attempts == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_realtime.py::test_realtime_settings_defaults -v`
Expected: FAIL — attributes not found on Settings

- [ ] **Step 3: Add settings to config.py**

In `apps/api/app/core/config.py`, add after the `dashscope_embedding_model` line (line 56):

```python
    # ── Realtime Voice ──
    realtime_interrupt_threshold_ms: int = 500
    realtime_idle_timeout_seconds: int = 60
    realtime_close_timeout_seconds: int = 120
    realtime_max_session_seconds: int = 1800
    realtime_max_concurrent_sessions: int = 50
    realtime_context_history_turns: int = 10
    realtime_rag_refresh_turns: int = 5
    realtime_reconnect_max_attempts: int = 3
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_realtime.py::test_realtime_settings_defaults -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/core/config.py apps/api/tests/test_realtime.py
git commit -m "feat: add realtime voice configuration settings"
```

---

## Task 2: Extract Context Loader from Orchestrator

**Files:**
- Create: `apps/api/app/services/context_loader.py`
- Modify: `apps/api/app/services/orchestrator.py`
- Test: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_realtime.py`:

```python
from unittest.mock import MagicMock, patch
from app.services.context_loader import (
    extract_personality,
    load_conversation_context,
    build_system_prompt,
)


def test_extract_personality_from_description():
    assert extract_personality("[personality:你是一个温柔的助手]") == "你是一个温柔的助手"


def test_extract_personality_fallback():
    assert extract_personality("Just a project") == "Just a project"


def test_extract_personality_none():
    assert extract_personality(None) == ""


def test_build_system_prompt_minimal():
    prompt = build_system_prompt(personality="你是助手", memories=[], knowledge_chunks=[])
    assert "你是助手" in prompt


def test_build_system_prompt_with_memories():
    prompt = build_system_prompt(
        personality="你是助手",
        memories=["用户喜欢跑步", "用户住在北京"],
        knowledge_chunks=[],
    )
    assert "用户喜欢跑步" in prompt
    assert "用户住在北京" in prompt


def test_build_system_prompt_with_knowledge():
    prompt = build_system_prompt(
        personality="你是助手",
        memories=[],
        knowledge_chunks=["降噪技术文档片段"],
    )
    assert "降噪技术文档片段" in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -k "context" -v`
Expected: FAIL — module context_loader not found

- [ ] **Step 3: Create context_loader.py**

Create `apps/api/app/services/context_loader.py`:

```python
"""Shared context-assembly logic for both HTTP and WebSocket inference paths.

Extracts personality, loads memories, builds system prompts.
Used by orchestrator.py (HTTP) and realtime_bridge.py (WebSocket).
"""
import re

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models import (
    Conversation,
    DataItem,
    Dataset,
    Memory,
    Message,
    Project,
)
from app.services.embedding import search_similar


def extract_personality(description: str | None) -> str:
    """Extract personality from project description.

    Looks for [personality:...] block (multiline).
    Falls back to raw description if no tag found.
    """
    if not description:
        return ""
    match = re.search(r"\[personality:(.*?)\]", description, re.DOTALL)
    return match.group(1).strip() if match else description.strip()


def load_conversation_context(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
) -> tuple["Project", "Conversation"]:
    """Load and validate project + conversation.

    Raises RuntimeError if not found.
    """
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not project:
        raise RuntimeError("project_not_found")

    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
            Conversation.workspace_id == workspace_id,
        )
        .first()
    )
    if not conversation:
        raise RuntimeError("conversation_not_found")

    return project, conversation


def load_permanent_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_created_by: str | None,
    limit: int = 20,
) -> list[Memory]:
    """Load visible permanent memories for a conversation context."""
    query = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .order_by(desc(Memory.updated_at))
    )

    memories = query.limit(limit).all()

    # Filter private memories: only show to owner
    visible = []
    for m in memories:
        meta = m.metadata_json or {}
        if meta.get("visibility") == "private":
            if conversation_created_by and meta.get("owner") == conversation_created_by:
                visible.append(m)
        else:
            visible.append(m)

    return visible


def load_recent_messages(
    db: Session,
    *,
    conversation_id: str,
    limit: int = 20,
) -> list[dict[str, str]]:
    """Load recent conversation messages as {role, content} dicts."""
    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(desc(Message.created_at))
        .limit(limit)
        .all()
    )
    rows.reverse()
    return [{"role": m.role, "content": m.content} for m in rows]


async def search_rag_knowledge(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    query: str,
    limit: int = 12,
) -> list[dict]:
    """Run RAG semantic search and return matching chunks."""
    results = await search_similar(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        query=query,
        limit=limit,
    )
    return results


def filter_knowledge_chunks(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    results: list[dict],
) -> list[dict]:
    """Keep only chunks from visible, non-deleted datasets."""
    if not results:
        return []

    data_item_ids = [r["data_item_id"] for r in results if r.get("data_item_id")]
    if not data_item_ids:
        return results  # memory-only results pass through

    visible_ids = set()
    rows = (
        db.query(DataItem.id)
        .join(Dataset, Dataset.id == DataItem.dataset_id)
        .join(Project, Project.id == Dataset.project_id)
        .filter(
            DataItem.id.in_(data_item_ids),
            DataItem.deleted_at.is_(None),
            Dataset.deleted_at.is_(None),
            Project.deleted_at.is_(None),
            Project.workspace_id == workspace_id,
        )
        .all()
    )
    visible_ids = {r[0] for r in rows}

    return [
        r for r in results
        if not r.get("data_item_id") or r["data_item_id"] in visible_ids
    ]


def build_system_prompt(
    *,
    personality: str,
    memories: list[str],
    knowledge_chunks: list[str],
) -> str:
    """Assemble the system prompt from personality, memories, and knowledge."""
    parts = []

    if personality:
        parts.append(personality)

    if memories:
        memory_block = "\n".join(f"- {m}" for m in memories)
        parts.append(f"\n你对这位用户的了解：\n{memory_block}")

    if knowledge_chunks:
        knowledge_block = "\n---\n".join(knowledge_chunks)
        parts.append(f"\n相关知识：\n{knowledge_block}")

    return "\n\n".join(parts)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v`
Expected: All tests PASS

- [ ] **Step 5: Refactor orchestrator.py to use context_loader**

In `apps/api/app/services/orchestrator.py`, replace the private helpers:

1. Add import: `from app.services.context_loader import extract_personality, load_conversation_context, load_permanent_memories, build_system_prompt, filter_knowledge_chunks`
2. Replace `_load_active_conversation_context()` calls with `load_conversation_context()`
3. Replace `_load_visible_permanent_memories()` calls with `load_permanent_memories()`
4. Replace `_filter_knowledge_chunks_for_prompt()` calls with `filter_knowledge_chunks()`
5. Replace inline personality extraction (regex) with `extract_personality()`
6. Remove the old private functions (or keep as thin wrappers if call sites are complex)

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `cd apps/api && python -m pytest tests/ -v`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/context_loader.py apps/api/app/services/orchestrator.py apps/api/tests/test_realtime.py
git commit -m "refactor: extract shared context_loader from orchestrator"
```

---

## Task 3: Build the Realtime Bridge Service

**Files:**
- Create: `apps/api/app/services/realtime_bridge.py`
- Test: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_realtime.py`:

```python
import asyncio
from app.services.realtime_bridge import RealtimeSession, SessionState


def test_session_initial_state():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    assert session.state == SessionState.CONNECTING
    assert session.turn_count == 0
    assert session.is_ai_speaking is False


def test_session_should_interrupt_short_speech():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = True
    # Speech shorter than threshold should NOT interrupt
    assert session.should_interrupt(speech_duration_ms=200) is False


def test_session_should_interrupt_long_speech():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = True
    # Speech longer than threshold SHOULD interrupt
    assert session.should_interrupt(speech_duration_ms=600) is True


def test_session_should_not_interrupt_when_ai_silent():
    session = RealtimeSession(
        workspace_id="ws1",
        project_id="proj1",
        conversation_id="conv1",
        user_id="user1",
    )
    session._ai_speaking = False
    assert session.should_interrupt(speech_duration_ms=600) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -k "session" -v`
Expected: FAIL — module realtime_bridge not found

- [ ] **Step 3: Create realtime_bridge.py**

Create `apps/api/app/services/realtime_bridge.py`:

```python
"""Dual WebSocket bridge for real-time full-duplex voice.

Manages the lifecycle of a voice session:
  Browser/Earphone ↔ FastAPI ↔ DashScope Omni Realtime

Handles:
  - Upstream DashScope WebSocket connection
  - Audio relay in both directions
  - Smart interruption (VAD-based with duration threshold)
  - Context injection (personality, memories, RAG)
  - Session state machine
"""
from __future__ import annotations

import asyncio
import base64
import enum
import json
import logging
import time
from dataclasses import dataclass, field

import websockets

from app.core.config import settings
from app.services.context_loader import (
    build_system_prompt,
    extract_personality,
    filter_knowledge_chunks,
    load_conversation_context,
    load_permanent_memories,
    load_recent_messages,
    search_rag_knowledge,
)
from app.services.dashscope_client import UpstreamServiceError
from app.tasks.worker_tasks import extract_memories

logger = logging.getLogger(__name__)

DASHSCOPE_REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
OMNI_MODEL = "qwen3-omni-flash-realtime"


class SessionState(enum.Enum):
    CONNECTING = "connecting"
    READY = "ready"
    LISTENING = "listening"
    AI_SPEAKING = "ai_speaking"
    CLOSING = "closing"
    CLOSED = "closed"


@dataclass
class RealtimeSession:
    """Tracks state for one real-time voice session."""

    workspace_id: str
    project_id: str
    conversation_id: str
    user_id: str

    state: SessionState = SessionState.CONNECTING
    turn_count: int = 0
    _ai_speaking: bool = False
    _personality: str = ""
    _memory_texts: list[str] = field(default_factory=list)
    _knowledge_chunks: list[str] = field(default_factory=list)
    _speech_start_time: float | None = None
    _current_transcript: str = ""
    _current_response_text: str = ""
    _upstream_ws: websockets.WebSocketClientProtocol | None = None
    _last_activity: float = field(default_factory=time.time)

    @property
    def is_ai_speaking(self) -> bool:
        return self._ai_speaking

    def should_interrupt(self, speech_duration_ms: int) -> bool:
        """Decide whether user speech should interrupt AI output."""
        if not self._ai_speaking:
            return False
        return speech_duration_ms >= settings.realtime_interrupt_threshold_ms

    def touch(self) -> None:
        """Update last activity timestamp."""
        self._last_activity = time.time()

    @property
    def idle_seconds(self) -> float:
        return time.time() - self._last_activity

    async def connect_upstream(self) -> None:
        """Establish WebSocket to DashScope Omni Realtime."""
        url = f"{DASHSCOPE_REALTIME_URL}?model={OMNI_MODEL}"
        headers = {
            "Authorization": f"Bearer {settings.dashscope_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        self._upstream_ws = await websockets.connect(
            url,
            additional_headers=headers,
            max_size=16 * 1024 * 1024,
        )

    async def send_session_update(self, system_prompt: str) -> None:
        """Send session configuration with system prompt to DashScope."""
        if not self._upstream_ws:
            raise UpstreamServiceError("Upstream not connected")

        config = {
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "instructions": system_prompt,
                "input_audio_format": "pcm",
                "sample_rate": 16000,
                "output_audio_format": "pcm",
                "output_sample_rate": 24000,
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.0,
                    "silence_duration_ms": 400,
                },
            },
        }
        await self._upstream_ws.send(json.dumps(config))
        # Wait for session.updated confirmation
        while True:
            msg = await self._upstream_ws.recv()
            data = json.loads(msg)
            if data.get("type") == "session.updated":
                break
            if data.get("type") == "error":
                raise UpstreamServiceError(f"DashScope session error: {data}")

        self.state = SessionState.READY

    async def relay_audio_to_upstream(self, audio_bytes: bytes) -> None:
        """Forward PCM audio chunk from client to DashScope."""
        if not self._upstream_ws:
            return
        self.touch()
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        await self._upstream_ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": audio_b64,
        }))

    async def handle_upstream_event(self, event: dict) -> list[dict | bytes]:
        """Process a DashScope event and return messages to send to client.

        Returns a list of items:
          - dict: JSON message to send as text frame
          - bytes: binary audio data to send as binary frame
        """
        event_type = event.get("type", "")
        outgoing: list[dict | bytes] = []

        if event_type == "conversation.item.input_audio_transcription.delta":
            partial = event.get("delta", "")
            outgoing.append({"type": "transcript.partial", "text": partial})

        elif event_type == "conversation.item.input_audio_transcription.completed":
            transcript = event.get("transcript", "")
            self._current_transcript = transcript
            outgoing.append({"type": "transcript.final", "text": transcript})
            self.state = SessionState.LISTENING
            self.touch()

        elif event_type == "response.audio.delta":
            self._ai_speaking = True
            self.state = SessionState.AI_SPEAKING
            audio_b64 = event.get("delta", "")
            if audio_b64:
                outgoing.append(base64.b64decode(audio_b64))

        elif event_type == "response.text.delta":
            delta = event.get("delta", "")
            self._current_response_text += delta
            outgoing.append({"type": "response.text", "text": delta})

        elif event_type == "response.done":
            self._ai_speaking = False
            self.turn_count += 1
            outgoing.append({"type": "response.done"})
            self.state = SessionState.LISTENING
            self.touch()

        elif event_type == "input_audio_buffer.speech_started":
            self._speech_start_time = time.time()

        elif event_type == "input_audio_buffer.speech_stopped":
            self._speech_start_time = None

        # Check if ongoing speech should trigger interruption
        if self._speech_start_time and self._ai_speaking:
            elapsed_ms = (time.time() - self._speech_start_time) * 1000
            if self.should_interrupt(speech_duration_ms=int(elapsed_ms)):
                await self.cancel_response()
                self._speech_start_time = None
                outgoing.append({"type": "interrupt.ack"})

        elif event_type == "error":
            outgoing.append({
                "type": "error",
                "code": "upstream_error",
                "message": str(event.get("error", {}).get("message", "Unknown error")),
            })

        return outgoing

    async def cancel_response(self) -> None:
        """Tell DashScope to stop current generation."""
        if not self._upstream_ws:
            return
        await self._upstream_ws.send(json.dumps({"type": "response.cancel"}))
        self._ai_speaking = False
        self._current_response_text = ""

    async def close(self) -> None:
        """Gracefully close upstream connection."""
        self.state = SessionState.CLOSING
        if self._upstream_ws:
            try:
                await self._upstream_ws.close()
            except Exception:
                pass
        self.state = SessionState.CLOSED

    def get_turn_texts(self) -> tuple[str, str]:
        """Return (user_text, ai_text) for the current turn and reset."""
        user = self._current_transcript
        ai = self._current_response_text
        self._current_transcript = ""
        self._current_response_text = ""
        return user, ai


# ── Global session registry ──

_active_sessions: dict[str, RealtimeSession] = {}
_sessions_lock = asyncio.Lock()


async def register_session(user_id: str, session: RealtimeSession) -> bool:
    """Register a session. Returns False if user already has an active session
    or global limit reached."""
    async with _sessions_lock:
        if user_id in _active_sessions:
            return False
        if len(_active_sessions) >= settings.realtime_max_concurrent_sessions:
            return False
        _active_sessions[user_id] = session
        return True


async def unregister_session(user_id: str) -> None:
    """Remove a session from the registry."""
    async with _sessions_lock:
        _active_sessions.pop(user_id, None)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -k "session" -v`
Expected: All session tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/realtime_bridge.py apps/api/tests/test_realtime.py
git commit -m "feat: add realtime bridge service with session state machine"
```

---

## Task 4: Create the FastAPI WebSocket Endpoint

**Files:**
- Create: `apps/api/app/routers/realtime.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_realtime.py`:

```python
from starlette.testclient import TestClient
from app.main import app


def test_realtime_websocket_rejects_without_token():
    client = TestClient(app)
    with client.websocket_connect("/api/v1/realtime/voice") as ws:
        # Should receive close frame due to missing token
        pass
    # If we get here without auth, the endpoint accepted without token — that's a bug
    # The endpoint should close the connection
```

Note: This test verifies the endpoint exists and rejects unauthenticated connections. The exact assertion depends on how FastAPI handles WebSocket auth rejection.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -k "websocket" -v`
Expected: FAIL — route not found (404 or connection refused)

- [ ] **Step 3: Create realtime router**

Create `apps/api/app/routers/realtime.py`:

```python
"""WebSocket endpoint for real-time full-duplex voice conversation."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import User
from app.services.auth import decode_access_token
from app.services.context_loader import (
    build_system_prompt,
    extract_personality,
    filter_knowledge_chunks,
    load_conversation_context,
    load_permanent_memories,
    load_recent_messages,
    search_rag_knowledge,
)
from app.services.realtime_bridge import (
    RealtimeSession,
    register_session,
    unregister_session,
)
from app.tasks.worker_tasks import extract_memories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/realtime", tags=["realtime"])


async def _authenticate_websocket(ws: WebSocket) -> User | None:
    """Validate bearer token from query parameter."""
    token = ws.query_params.get("token")
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        db: Session = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            return user
        finally:
            db.close()
    except Exception:
        return None


async def _load_initial_context(
    db: Session,
    session: RealtimeSession,
) -> str:
    """Load personality, memories, recent messages and build system prompt."""
    project, conversation = load_conversation_context(
        db,
        workspace_id=session.workspace_id,
        project_id=session.project_id,
        conversation_id=session.conversation_id,
    )

    personality = extract_personality(project.description)

    memories = load_permanent_memories(
        db,
        workspace_id=session.workspace_id,
        project_id=session.project_id,
        conversation_created_by=conversation.created_by,
    )
    memory_texts = [m.content for m in memories if m.content]

    # Store on session for reuse during RAG context refresh
    session._personality = personality
    session._memory_texts = memory_texts

    return build_system_prompt(
        personality=personality,
        memories=memory_texts,
        knowledge_chunks=[],
    )


async def _post_turn_tasks(
    session: RealtimeSession,
    user_text: str,
    ai_text: str,
) -> None:
    """Save messages to DB and run async tasks after a conversation turn."""
    if not user_text or not ai_text:
        return

    # Persist messages to database
    db_save: Session = SessionLocal()
    try:
        from app.models import Conversation, Message
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        db_save.add(Message(
            conversation_id=session.conversation_id,
            role="user",
            content=user_text,
            created_at=now,
        ))
        db_save.add(Message(
            conversation_id=session.conversation_id,
            role="assistant",
            content=ai_text,
            created_at=now,
        ))
        db_save.query(Conversation).filter(
            Conversation.id == session.conversation_id
        ).update({"updated_at": now})
        db_save.commit()
    except Exception:
        db_save.rollback()
        logger.exception("Failed to save voice turn messages")
    finally:
        db_save.close()

    # Dispatch memory extraction (Celery, fire-and-forget)
    extract_memories.delay(
        session.workspace_id,
        session.project_id,
        session.conversation_id,
        user_text,
        ai_text,
    )

    # Async RAG search to enrich next turn context
    if session.turn_count % settings.realtime_rag_refresh_turns == 0:
        try:
            db: Session = SessionLocal()
            try:
                results = await search_rag_knowledge(
                    db,
                    workspace_id=session.workspace_id,
                    project_id=session.project_id,
                    query=user_text,
                    limit=5,
                )
                if results:
                    chunks = filter_knowledge_chunks(
                        db,
                        workspace_id=session.workspace_id,
                        project_id=session.project_id,
                        results=results,
                    )
                    chunk_texts = [c["chunk_text"] for c in chunks if c.get("chunk_text")]
                    if chunk_texts:
                        # Re-send system prompt with updated knowledge (reuse stored personality/memories)
                        session._knowledge_chunks = chunk_texts
                        new_prompt = build_system_prompt(
                            personality=session._personality,
                            memories=session._memory_texts,
                            knowledge_chunks=session._knowledge_chunks,
                        )
                        await session.send_session_update(new_prompt)
            finally:
                db.close()
        except Exception:
            logger.exception("Failed to refresh RAG context")


async def _upstream_listener(
    ws: WebSocket,
    session: RealtimeSession,
) -> None:
    """Listen for DashScope upstream events and relay to client."""
    try:
        async for raw_msg in session._upstream_ws:
            if isinstance(raw_msg, bytes):
                continue  # Unexpected binary from upstream
            event = json.loads(raw_msg)
            outgoing = await session.handle_upstream_event(event)
            for item in outgoing:
                if isinstance(item, bytes):
                    await ws.send_bytes(item)
                else:
                    await ws.send_json(item)

            # After response.done, trigger post-turn tasks
            if event.get("type") == "response.done":
                user_text, ai_text = session.get_turn_texts()
                asyncio.create_task(_post_turn_tasks(session, user_text, ai_text))

    except Exception as exc:
        logger.warning("Upstream listener error: %s", exc)
        try:
            await ws.send_json({
                "type": "error",
                "code": "upstream_disconnected",
                "message": "AI 暂时无响应",
            })
        except Exception:
            pass


async def _idle_monitor(
    ws: WebSocket,
    session: RealtimeSession,
) -> None:
    """Monitor for idle timeout and max session duration."""
    start_time = asyncio.get_event_loop().time()
    while session.state not in (session.state.CLOSING, session.state.CLOSED):
        await asyncio.sleep(5)
        if session.idle_seconds >= settings.realtime_close_timeout_seconds:
            try:
                await ws.send_json({"type": "session.end", "reason": "timeout"})
            except Exception:
                pass
            return
        if session.idle_seconds >= settings.realtime_idle_timeout_seconds:
            try:
                await ws.send_json({"type": "session.idle"})
            except Exception:
                pass
        elapsed = asyncio.get_event_loop().time() - start_time
        if elapsed >= settings.realtime_max_session_seconds:
            try:
                await ws.send_json({"type": "session.end", "reason": "max_duration"})
            except Exception:
                pass
            return


@router.websocket("/voice")
async def realtime_voice(ws: WebSocket) -> None:
    """Full-duplex voice conversation WebSocket endpoint."""
    # Authenticate
    user = await _authenticate_websocket(ws)
    if not user:
        await ws.accept()
        await ws.send_json({"type": "error", "code": "unauthorized", "message": "Unauthorized"})
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()

    session: RealtimeSession | None = None

    try:
        # Wait for session.start message
        init_raw = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if init_raw.get("type") != "session.start":
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Expected session.start"})
            await ws.close()
            return

        conversation_id = init_raw.get("conversation_id")
        project_id = init_raw.get("project_id")
        workspace_id = init_raw.get("workspace_id", "")

        if not conversation_id or not project_id:
            await ws.send_json({"type": "error", "code": "bad_request", "message": "Missing conversation_id or project_id"})
            await ws.close()
            return

        # Create session
        session = RealtimeSession(
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_id=conversation_id,
            user_id=user.id,
        )

        # Register (enforces concurrency limits)
        if not await register_session(user.id, session):
            await ws.send_json({"type": "error", "code": "concurrent_limit", "message": "您已有一个进行中的对话"})
            await ws.close()
            return

        # Load context
        db: Session = SessionLocal()
        try:
            system_prompt = await _load_initial_context(db, session)
        finally:
            db.close()

        # Connect to DashScope
        await session.connect_upstream()
        await session.send_session_update(system_prompt)

        # Notify client
        await ws.send_json({"type": "session.ready"})

        # Start background tasks
        upstream_task = asyncio.create_task(_upstream_listener(ws, session))
        idle_task = asyncio.create_task(_idle_monitor(ws, session))

        # Main loop: receive from client
        try:
            while True:
                message = await ws.receive()

                if message["type"] == "websocket.disconnect":
                    break

                if "bytes" in message and message["bytes"]:
                    # Binary = audio chunk
                    await session.relay_audio_to_upstream(message["bytes"])

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "session.end":
                        break

                    elif msg_type == "audio.stop":
                        # Explicit stop speaking signal
                        if session._upstream_ws:
                            await session._upstream_ws.send(
                                json.dumps({"type": "input_audio_buffer.commit"})
                            )

        except WebSocketDisconnect:
            pass
        finally:
            upstream_task.cancel()
            idle_task.cancel()

    except Exception as exc:
        logger.exception("Realtime voice error: %s", exc)
        try:
            await ws.send_json({"type": "error", "code": "internal", "message": str(exc)})
        except Exception:
            pass
    finally:
        if session:
            await session.close()
            await unregister_session(user.id if user else "")
        try:
            await ws.close()
        except Exception:
            pass
```

- [ ] **Step 4: Register router in main.py**

In `apps/api/app/main.py`, add:

```python
from app.routers import realtime
```

And in the router registration block:

```python
app.include_router(realtime.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routers/realtime.py apps/api/app/main.py apps/api/tests/test_realtime.py
git commit -m "feat: add FastAPI WebSocket endpoint for realtime voice"
```

---

## Task 5: Create the Frontend WebSocket Hook

**Files:**
- Create: `apps/web/hooks/useRealtimeVoice.ts`

- [ ] **Step 1: Create the hook**

Create `apps/web/hooks/useRealtimeVoice.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RealtimeState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "ai_speaking"
  | "error"
  | "reconnecting";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface UseRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  workspaceId: string;
  onError?: (msg: string) => void;
}

interface UseRealtimeVoiceReturn {
  state: RealtimeState;
  transcript: TranscriptEntry[];
  timer: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isMuted: boolean;
  userVolume: number;
  aiVolume: number;
}

export function useRealtimeVoice({
  conversationId,
  projectId,
  workspaceId,
  onError,
}: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const [state, setState] = useState<RealtimeState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Timer
  useEffect(() => {
    if (state === "listening" || state === "ai_speaking" || state === "ready") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (state === "idle") setTimer(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }
    const ctx = playbackCtxRef.current;
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Compute volume for visualization
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    setAiVolume(Math.sqrt(sum / float32.length));

    source.connect(ctx.destination);
    const playTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(playTime);
    nextPlayTimeRef.current = playTime + buffer.duration;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
      nextPlayTimeRef.current = 0;
    }
    setAiVolume(0);
  }, []);

  const startCapture = useCallback(async (ws: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessor for PCM extraction (deprecated but widely supported)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      // Compute user volume for visualization
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      setUserVolume(Math.sqrt(sum / input.length));

      // Convert float32 to int16 PCM
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(pcm.buffer);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }, [isMuted]);

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setUserVolume(0);
  }, []);

  const connect = useCallback(async () => {
    if (state !== "idle" && state !== "error") return;

    setState("connecting");

    // Get token from cookie
    const tokenMatch = document.cookie.match(/access_token=([^;]+)/);
    const token = tokenMatch?.[1] ?? "";

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/v1/realtime/voice?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          conversation_id: conversationId,
          project_id: projectId,
          workspace_id: workspaceId,
        })
      );
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary = audio delta from AI
        playPcmChunk(event.data);
        setState("ai_speaking");
        return;
      }

      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "session.ready":
          setState("listening");
          await startCapture(ws);
          break;

        case "transcript.partial":
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user" && !last.final) {
              return [...prev.slice(0, -1), { role: "user", text: msg.text, final: false }];
            }
            return [...prev, { role: "user", text: msg.text, final: false }];
          });
          break;

        case "transcript.final":
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user" && !last.final) {
              return [...prev.slice(0, -1), { role: "user", text: msg.text, final: true }];
            }
            return [...prev, { role: "user", text: msg.text, final: true }];
          });
          break;

        case "response.text":
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.final) {
              return [
                ...prev.slice(0, -1),
                { role: "assistant", text: last.text + msg.text, final: false },
              ];
            }
            return [...prev, { role: "assistant", text: msg.text, final: false }];
          });
          break;

        case "response.done":
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, final: true }];
            }
            return prev;
          });
          setState("listening");
          break;

        case "interrupt.ack":
          stopPlayback();
          setState("listening");
          break;

        case "session.idle":
          // Could show a visual hint
          break;

        case "session.end":
          disconnect();
          break;

        case "error":
          onError?.(msg.message || "Unknown error");
          if (msg.code === "concurrent_limit") {
            setState("error");
            ws.close();
          }
          break;
      }
    };

    ws.onclose = () => {
      stopCapture();
      stopPlayback();
      if (state !== "idle") setState("idle");
    };

    ws.onerror = () => {
      onError?.("WebSocket connection failed");
      setState("error");
    };
  }, [state, conversationId, projectId, workspaceId, startCapture, stopCapture, stopPlayback, playPcmChunk, onError]);

  const disconnect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "session.end" }));
      wsRef.current.close();
    }
    stopCapture();
    stopPlayback();
    setState("idle");
    setTranscript([]);
  }, [stopCapture, stopPlayback]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    transcript,
    timer,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    userVolume,
    aiVolume,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit hooks/useRealtimeVoice.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/useRealtimeVoice.ts
git commit -m "feat: add useRealtimeVoice WebSocket hook with audio capture/playback"
```

---

## Task 6: Create the Dynamic Island Floating Widget

**Files:**
- Create: `apps/web/components/console/RealtimeVoice.tsx`
- Modify: `apps/web/styles/globals.css`

- [ ] **Step 1: Create RealtimeVoice.tsx**

Create `apps/web/components/console/RealtimeVoice.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeVoice, type RealtimeState } from "@/hooks/useRealtimeVoice";

interface RealtimeVoiceProps {
  conversationId: string;
  projectId: string;
  workspaceId: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function WaveformBars({ volume, color }: { volume: number; color: string }) {
  const barCount = 5;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const base = 4;
    const maxH = 20;
    const h = base + volume * maxH * (1 + Math.sin(i * 1.2)) * 0.5;
    return Math.min(h, maxH);
  });

  return (
    <div className="rt-waveform">
      {bars.map((h, i) => (
        <div
          key={i}
          className="rt-waveform-bar"
          style={{ height: `${h}px`, backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export default function RealtimeVoice({
  conversationId,
  projectId,
  workspaceId,
}: RealtimeVoiceProps) {
  const [expanded, setExpanded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const {
    state,
    transcript,
    timer,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    userVolume,
    aiVolume,
  } = useRealtimeVoice({
    conversationId,
    projectId,
    workspaceId,
    onError: (msg) => console.error("[RealtimeVoice]", msg),
  });

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const isActive = state !== "idle" && state !== "error";
  const isListening = state === "listening" || state === "ready";
  const isSpeaking = state === "ai_speaking";

  const indicatorColor = isListening ? "#22c55e" : isSpeaking ? "#818cf8" : "#64748b";
  const waveColor = isListening ? "#4ade80" : "#818cf8";
  const statusText =
    state === "connecting"
      ? "正在准备..."
      : state === "reconnecting"
        ? "重连中..."
        : isListening
          ? "聆听中"
          : isSpeaking
            ? "回复中"
            : state === "error"
              ? "连接失败"
              : "";

  // ── Idle state: entry button ──
  if (!isActive && state !== "connecting" && state !== "reconnecting") {
    return (
      <div className="rt-float rt-entry" onClick={connect}>
        <span className="rt-entry-icon">🎙</span>
        <span className="rt-entry-label">实时对话</span>
      </div>
    );
  }

  // ── Active state: pill or expanded panel ──
  if (!expanded) {
    return (
      <div className="rt-float rt-pill" onClick={() => setExpanded(true)}>
        <div className="rt-indicator" style={{ backgroundColor: indicatorColor }} />
        {state === "connecting" ? (
          <div className="rt-spinner" />
        ) : (
          <WaveformBars volume={isListening ? userVolume : aiVolume} color={waveColor} />
        )}
        <span className="rt-pill-status">{statusText}</span>
        <span className="rt-pill-timer">{formatTime(timer)}</span>
        <button
          className="rt-hangup-small"
          onClick={(e) => {
            e.stopPropagation();
            disconnect();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Expanded panel ──
  return (
    <div className="rt-float rt-panel">
      <div className="rt-panel-header">
        <div className="rt-panel-header-left">
          <div className="rt-indicator" style={{ backgroundColor: indicatorColor }} />
          <span className="rt-panel-title">AI 助手</span>
          <span className="rt-panel-timer">{formatTime(timer)}</span>
        </div>
        <button className="rt-collapse-btn" onClick={() => setExpanded(false)}>
          −
        </button>
      </div>

      <div className="rt-transcript" ref={transcriptRef}>
        {transcript.map((entry, i) => (
          <div key={i} className={`rt-transcript-entry rt-transcript-${entry.role}`}>
            <div className="rt-transcript-label">
              {entry.role === "user" ? "你" : "AI"}
            </div>
            <div className="rt-transcript-bubble">
              {entry.text}
              {!entry.final && <span className="rt-cursor">▊</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="rt-controls">
        <button
          className={`rt-control-btn ${isMuted ? "rt-muted" : ""}`}
          onClick={toggleMute}
          title={isMuted ? "取消静音" : "静音"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>
        <button className="rt-hangup" onClick={disconnect}>
          ✕
        </button>
        <button className="rt-control-btn" title="扬声器">
          🔊
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS styles**

Append to `apps/web/styles/globals.css`:

```css
/* ── Realtime Voice Floating Widget ── */
.rt-float {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  font-family: inherit;
}

.rt-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  border: 1px solid rgba(99, 102, 241, 0.3);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}
.rt-entry:hover {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 4px 24px rgba(99, 102, 241, 0.2);
}
.rt-entry-icon {
  font-size: 14px;
}
.rt-entry-label {
  color: #c7d2fe;
  font-size: 13px;
  font-weight: 500;
}

.rt-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 999px;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  border: 1px solid rgba(99, 102, 241, 0.3);
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  transition: all 0.3s;
}

.rt-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  flex-shrink: 0;
}

.rt-waveform {
  display: flex;
  gap: 2px;
  align-items: center;
  height: 20px;
}
.rt-waveform-bar {
  width: 2px;
  border-radius: 1px;
  transition: height 0.1s ease;
}

.rt-pill-status {
  color: #e2e8f0;
  font-size: 12px;
  white-space: nowrap;
}
.rt-pill-timer {
  color: #64748b;
  font-size: 11px;
}

.rt-hangup-small {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #ef4444;
  color: white;
  border: none;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rt-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #818cf8;
  border-top-color: transparent;
  border-radius: 50%;
  animation: rt-spin 0.8s linear infinite;
}
@keyframes rt-spin {
  to { transform: rotate(360deg); }
}

/* Expanded panel */
.rt-panel {
  width: 320px;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: rt-expand 0.2s ease-out;
}
@keyframes rt-expand {
  from { opacity: 0; transform: scale(0.9) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.rt-panel-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.rt-panel-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rt-panel-title {
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 500;
}
.rt-panel-timer {
  color: #64748b;
  font-size: 11px;
}
.rt-collapse-btn {
  background: none;
  border: none;
  color: #64748b;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.rt-transcript {
  padding: 10px 16px;
  max-height: 200px;
  overflow-y: auto;
}
.rt-transcript-entry {
  margin-bottom: 8px;
}
.rt-transcript-label {
  font-size: 10px;
  margin-bottom: 3px;
}
.rt-transcript-user .rt-transcript-label {
  color: #94a3b8;
}
.rt-transcript-assistant .rt-transcript-label {
  color: #818cf8;
}
.rt-transcript-bubble {
  font-size: 12px;
  border-radius: 8px;
  padding: 6px 10px;
  display: inline-block;
  max-width: 100%;
  word-break: break-word;
}
.rt-transcript-user .rt-transcript-bubble {
  color: #e2e8f0;
  background: rgba(0, 0, 0, 0.2);
}
.rt-transcript-assistant .rt-transcript-bubble {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.1);
}
.rt-cursor {
  opacity: 0.6;
  animation: rt-blink 1s step-end infinite;
}
@keyframes rt-blink {
  50% { opacity: 0; }
}

.rt-controls {
  padding: 8px 16px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.rt-control-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.12);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: background 0.2s;
}
.rt-control-btn:hover {
  background: rgba(99, 102, 241, 0.25);
}
.rt-control-btn.rt-muted {
  background: rgba(239, 68, 68, 0.15);
}
.rt-hangup {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ef4444;
  color: white;
  border: none;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  transition: background 0.2s;
}
.rt-hangup:hover {
  background: #dc2626;
}
```

- [ ] **Step 3: Verify no syntax errors**

Run: `cd apps/web && npx tsc --noEmit components/console/RealtimeVoice.tsx 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/RealtimeVoice.tsx apps/web/styles/globals.css
git commit -m "feat: add dynamic island floating widget for realtime voice"
```

---

## Task 7: Integrate Widget into Chat Page

**Files:**
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Add RealtimeVoice import and mount**

In `apps/web/components/console/ChatInterface.tsx`:

1. Add import at top:
```typescript
import RealtimeVoice from "./RealtimeVoice";
```

2. The component needs `projectId` and `workspaceId`. These should be available from the chat page context. Add the widget at the end of the component's return JSX, just before the closing `</div>`:

```tsx
{conversationId && (
  <RealtimeVoice
    conversationId={conversationId}
    projectId={projectId}
    workspaceId={workspaceId}
  />
)}
```

Note: If `projectId` and `workspaceId` are not already available as props or context in ChatInterface, they need to be threaded through from the parent page. Check the actual component to determine the exact integration point.

- [ ] **Step 2: Verify the page builds**

Run: `cd apps/web && npm run build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/ChatInterface.tsx
git commit -m "feat: mount RealtimeVoice widget in chat interface"
```

---

## Task 8: Add websockets Dependency

**Files:**
- Modify: `apps/api/pyproject.toml` (or `requirements.txt`)

- [ ] **Step 1: Check current dependency file**

Run: `ls apps/api/pyproject.toml apps/api/requirements.txt 2>/dev/null`

- [ ] **Step 2: Add websockets package**

The `realtime_bridge.py` imports `websockets` for the upstream DashScope connection. Add it to the project dependencies:

```bash
cd apps/api && pip install websockets
```

Then add `websockets>=13.0` to the dependency file (pyproject.toml or requirements.txt).

- [ ] **Step 3: Commit**

```bash
git add apps/api/pyproject.toml  # or requirements.txt
git commit -m "feat: add websockets dependency for realtime voice"
```

---

## Task 9: End-to-End Integration Test

**Files:**
- Modify: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Add integration test**

Append to `apps/api/tests/test_realtime.py`:

```python
import pytest
from starlette.testclient import TestClient
from app.main import app


def test_realtime_websocket_rejects_no_token():
    """Unauthenticated WebSocket connections should be rejected."""
    client = TestClient(app)
    try:
        with client.websocket_connect("/api/v1/realtime/voice"):
            pytest.fail("Should have been rejected")
    except Exception:
        pass  # Expected: connection rejected


def test_realtime_websocket_rejects_bad_token():
    """Invalid token should be rejected."""
    client = TestClient(app)
    try:
        with client.websocket_connect("/api/v1/realtime/voice?token=invalid"):
            pytest.fail("Should have been rejected")
    except Exception:
        pass  # Expected: connection rejected
```

- [ ] **Step 2: Run all realtime tests**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite for regressions**

Run: `cd apps/api && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/test_realtime.py
git commit -m "test: add WebSocket auth rejection integration tests"
```

---

## Task 10: Manual Smoke Test

- [ ] **Step 1: Start backend**

```bash
cd apps/api && uvicorn app.main:app --reload --port 8000
```

- [ ] **Step 2: Start frontend**

```bash
cd apps/web && npm run dev
```

- [ ] **Step 3: Verify the realtime voice entry button appears**

Open the chat page in browser. The "实时对话" pill button should appear in the bottom-right corner.

- [ ] **Step 4: Test connection flow**

Click the entry button → should show "正在准备..." → if DashScope key is configured, should transition to "聆听中" state.

- [ ] **Step 5: Test disconnect**

Click the ✕ button → widget should return to entry button state.

- [ ] **Step 6: Verify no console errors**

Check browser console for JavaScript errors. Check terminal for Python errors.
