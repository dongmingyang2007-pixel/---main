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
from typing import Any

import websockets

from app.core.config import settings
from app.services.dashscope_client import UpstreamServiceError

logger = logging.getLogger(__name__)

DASHSCOPE_REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
OMNI_MODEL = "qwen3-omni-flash-realtime"
INPUT_AUDIO_TRANSCRIPTION_MODEL = "gummy-realtime-v1"
DEFAULT_REALTIME_VOICE = "Cherry"


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
    upstream_model: str = OMNI_MODEL
    input_transcription_model: str = INPUT_AUDIO_TRANSCRIPTION_MODEL

    state: SessionState = SessionState.CONNECTING
    turn_count: int = 0
    _ai_speaking: bool = False
    _personality: str = ""
    _memory_texts: list[str] = field(default_factory=list)
    _knowledge_chunks: list[str] = field(default_factory=list)
    _speech_start_time: float | None = None
    _partial_transcript: str = ""
    _current_transcript: str = ""
    _current_response_text: str = ""
    _text_response_text: str = ""
    _audio_response_text: str = ""
    _response_text_channel: str | None = None
    _upstream_ws: websockets.ClientConnection | None = None
    _last_activity: float = field(default_factory=time.time)
    _session_update_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _pending_session_update: asyncio.Future[None] | None = None
    _active_turn_retrieval_trace: dict[str, Any] | None = None

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

    def _reset_response_text_tracking(self) -> None:
        self._current_response_text = ""
        self._text_response_text = ""
        self._audio_response_text = ""
        self._response_text_channel = None

    def _reconcile_response_text(self, *, channel: str, candidate: str) -> str:
        """Merge one response-text channel into the visible assistant transcript.

        DashScope omni may stream both ``response.text.delta`` and
        ``response.audio_transcript.*`` for the same turn. We keep separate
        channel buffers and only emit the minimal suffix needed to advance the
        visible transcript, so the UI does not render duplicated assistant text.
        """
        if not candidate:
            return ""

        current = self._current_response_text
        preferred = self._response_text_channel

        if preferred is None:
            self._response_text_channel = channel
            self._current_response_text = candidate
            return candidate

        if channel == "text":
            if candidate == current:
                self._response_text_channel = "text"
                return ""
            if candidate.startswith(current):
                self._response_text_channel = "text"
                delta = candidate[len(current):]
                self._current_response_text = candidate
                return delta
            return ""

        if preferred == "audio":
            if candidate == current or current.startswith(candidate):
                return ""
            if candidate.startswith(current):
                delta = candidate[len(current):]
                self._current_response_text = candidate
                return delta
            return ""

        if candidate.startswith(current):
            delta = candidate[len(current):]
            if delta:
                self._current_response_text = candidate
            return delta
        return ""

    @property
    def idle_seconds(self) -> float:
        return time.time() - self._last_activity

    async def connect_upstream(self) -> None:
        """Establish WebSocket to DashScope Omni Realtime."""
        url = f"{DASHSCOPE_REALTIME_URL}?model={self.upstream_model or OMNI_MODEL}"
        headers = {
            "Authorization": f"Bearer {settings.dashscope_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        self._upstream_ws = await websockets.connect(
            url,
            additional_headers=headers,
            max_size=16 * 1024 * 1024,
        )

    def _build_session_update_payload(self, system_prompt: str) -> dict:
        return {
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "instructions": system_prompt,
                "voice": DEFAULT_REALTIME_VOICE,
                "input_audio_format": "pcm",
                "input_audio_transcription": {
                    "model": self.input_transcription_model or INPUT_AUDIO_TRANSCRIPTION_MODEL,
                },
                "output_audio_format": "pcm",
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.0,
                    "silence_duration_ms": 400,
                    # We refresh layered context after ASR finalization and then
                    # explicitly trigger the next response, so upstream should
                    # not auto-start generation with stale instructions.
                    "create_response": False,
                    "interrupt_response": True,
                },
            },
        }

    async def _send_session_update_locked(
        self,
        system_prompt: str,
        *,
        wait_via_listener: bool,
    ) -> None:
        if not self._upstream_ws:
            raise UpstreamServiceError("Upstream not connected")

        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        self._pending_session_update = pending

        await self._upstream_ws.send(json.dumps(self._build_session_update_payload(system_prompt)))
        try:
            if wait_via_listener:
                await pending
            else:
                while not pending.done():
                    raw_msg = await self._upstream_ws.recv()
                    if isinstance(raw_msg, bytes):
                        continue
                    event = json.loads(raw_msg)
                    await self.handle_upstream_event(event)
                await pending
        except websockets.ConnectionClosed as exc:
            if not pending.done():
                pending.set_exception(
                    UpstreamServiceError("Upstream connection closed during session setup")
                )
            raise UpstreamServiceError("Upstream connection closed during session setup") from exc
        finally:
            if self._pending_session_update is pending:
                self._pending_session_update = None

        self.state = SessionState.READY

    async def send_session_update(self, system_prompt: str) -> None:
        """Update the active session after the upstream listener is already running."""
        async with self._session_update_lock:
            await self._send_session_update_locked(
                system_prompt,
                wait_via_listener=True,
            )

    async def send_initial_session_update(self, system_prompt: str) -> None:
        """Configure the initial session before the upstream listener starts."""
        async with self._session_update_lock:
            await self._send_session_update_locked(
                system_prompt,
                wait_via_listener=False,
            )

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

    async def request_response(self) -> None:
        """Explicitly ask the realtime model to answer the latest committed turn."""
        if not self._upstream_ws:
            raise UpstreamServiceError("Upstream not connected")
        self.touch()
        await self._upstream_ws.send(json.dumps({"type": "response.create"}))

    async def handle_upstream_event(self, event: dict) -> list[dict | bytes]:
        """Process a DashScope event and return messages to send to client."""
        event_type = event.get("type", "")
        outgoing: list[dict | bytes] = []

        if event_type == "conversation.item.input_audio_transcription.text":
            confirmed = str(event.get("text", ""))
            speculative = str(event.get("stash", ""))
            preview = f"{confirmed}{speculative}"
            if preview:
                self._partial_transcript = preview
            outgoing.append({"type": "transcript.partial", "text": self._partial_transcript})
            self.touch()

        elif event_type == "conversation.item.input_audio_transcription.delta":
            partial = event.get("delta", "")
            if partial:
                self._partial_transcript += partial
            outgoing.append({"type": "transcript.partial", "text": self._partial_transcript})
            self.touch()

        elif event_type == "conversation.item.input_audio_transcription.completed":
            transcript = event.get("transcript", "")
            self._partial_transcript = ""
            self._current_transcript = transcript
            outgoing.append({"type": "transcript.final", "text": transcript})
            self.state = SessionState.LISTENING
            self.touch()

        elif event_type == "conversation.item.input_audio_transcription.failed":
            self._partial_transcript = ""
            self._current_transcript = ""
            self.touch()

        elif event_type == "response.audio.delta":
            self._ai_speaking = True
            self.state = SessionState.AI_SPEAKING
            audio_b64 = event.get("delta", "")
            if audio_b64:
                outgoing.append(base64.b64decode(audio_b64))
            self.touch()

        elif event_type == "response.text.delta":
            delta = event.get("delta", "")
            self._text_response_text += delta
            visible_delta = self._reconcile_response_text(
                channel="text",
                candidate=self._text_response_text,
            )
            if visible_delta:
                outgoing.append({"type": "response.text", "text": visible_delta})
            self.touch()

        elif event_type == "response.audio_transcript.delta":
            delta = event.get("delta", "")
            self._audio_response_text += delta
            visible_delta = self._reconcile_response_text(
                channel="audio",
                candidate=self._audio_response_text,
            )
            if visible_delta:
                outgoing.append({"type": "response.text", "text": visible_delta})
            self.touch()

        elif event_type == "response.audio_transcript.done":
            transcript = event.get("transcript", "")
            if transcript:
                self._audio_response_text = transcript
                visible_delta = self._reconcile_response_text(
                    channel="audio",
                    candidate=self._audio_response_text,
                )
                if visible_delta:
                    outgoing.append({"type": "response.text", "text": visible_delta})
            self.touch()

        elif event_type == "response.done":
            self._ai_speaking = False
            self.turn_count += 1
            outgoing.append({"type": "response.done"})
            self.state = SessionState.LISTENING
            self.touch()

        elif event_type == "session.updated":
            if self._pending_session_update and not self._pending_session_update.done():
                self._pending_session_update.set_result(None)
            self.state = SessionState.READY
            self.touch()

        elif event_type == "input_audio_buffer.speech_started":
            self._partial_transcript = ""
            self._speech_start_time = time.time()
            self.touch()

        elif event_type == "input_audio_buffer.speech_stopped":
            self._speech_start_time = None
            self.touch()

        elif event_type == "error":
            if self._pending_session_update and not self._pending_session_update.done():
                self._pending_session_update.set_exception(
                    UpstreamServiceError(f"DashScope session error: {event}")
                )
                self._pending_session_update = None
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

    async def handle_client_message(self, msg_type: str, data: dict) -> list[dict]:
        """Process a control message sent from the client and return reply messages."""
        outgoing: list[dict] = []
        if msg_type == "input.interrupt":
            if self._ai_speaking:
                await self.cancel_response()
                outgoing.append({"type": "interrupt.ack"})
        return outgoing

    async def cancel_response(self) -> None:
        """Tell DashScope to stop current generation."""
        if not self._upstream_ws:
            return
        await self._upstream_ws.send(json.dumps({"type": "response.cancel"}))
        self._ai_speaking = False
        self._reset_response_text_tracking()

    async def close(self) -> None:
        """Gracefully close upstream connection."""
        self.state = SessionState.CLOSING
        if self._pending_session_update and not self._pending_session_update.done():
            self._pending_session_update.set_exception(
                UpstreamServiceError("Upstream connection closed")
            )
            self._pending_session_update = None
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
        self._reset_response_text_tracking()
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
