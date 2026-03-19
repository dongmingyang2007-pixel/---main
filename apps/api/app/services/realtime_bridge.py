"""Dual WebSocket bridge for real-time full-duplex voice.

Manages the lifecycle of a voice session:
  Browser/Earphone <-> FastAPI <-> DashScope Omni Realtime

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
    _upstream_ws: websockets.ClientConnection | None = None
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
        """Process a DashScope event and return messages to send to client."""
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

        elif event_type == "error":
            outgoing.append({
                "type": "error",
                "code": "upstream_error",
                "message": str(event.get("error", {}).get("message", "Unknown error")),
            })

        # Check if ongoing speech should trigger interruption
        if self._speech_start_time and self._ai_speaking:
            elapsed_ms = (time.time() - self._speech_start_time) * 1000
            if self.should_interrupt(speech_duration_ms=int(elapsed_ms)):
                await self.cancel_response()
                self._speech_start_time = None
                outgoing.append({"type": "interrupt.ack"})

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


# -- Global session registry --

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
