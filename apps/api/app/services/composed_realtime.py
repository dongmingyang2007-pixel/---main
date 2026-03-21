from __future__ import annotations

import asyncio
import base64
import logging
import re
from binascii import Error as BinasciiError
from dataclasses import dataclass

from fastapi import WebSocket

from app.core.config import settings
from app.core.errors import ApiError
from app.db.session import SessionLocal
from app.services.dashscope_client import UpstreamServiceError
from app.services.orchestrator import (
    orchestrate_synthetic_realtime_turn,
    synthesize_realtime_speech_for_project,
)
from app.services.upload_validation import (
    UPLOAD_SIGNATURE_READ_BYTES,
    validate_workspace_upload_signature,
)


DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>.+)$")
ALLOWED_SYNTHETIC_IMAGE_MEDIA_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
}
ALLOWED_SYNTHETIC_VIDEO_MEDIA_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
}
ALLOWED_SYNTHETIC_MEDIA_TYPES = ALLOWED_SYNTHETIC_IMAGE_MEDIA_TYPES | ALLOWED_SYNTHETIC_VIDEO_MEDIA_TYPES

logger = logging.getLogger(__name__)


@dataclass
class PendingMedia:
    kind: str
    filename: str
    mime_type: str
    data: bytes


def decode_pending_media(
    *,
    data_url: str,
    filename: str | None = None,
    max_bytes: int | None = None,
) -> PendingMedia:
    match = DATA_URL_RE.match(data_url)
    if not match:
        raise ApiError("bad_media", "Invalid media payload", status_code=400)

    mime_type = match.group("mime").strip().lower()
    if mime_type not in ALLOWED_SYNTHETIC_MEDIA_TYPES:
        raise ApiError("unsupported_media_type", "Unsupported media type", status_code=415)

    max_payload_bytes = (max_bytes or settings.realtime_media_max_mb * 1024 * 1024)
    encoded_payload = match.group("data").strip()
    max_encoded_length = ((max_payload_bytes + 2) // 3) * 4
    if len(encoded_payload) > max_encoded_length + 8:
        raise ApiError(
            "payload_too_large",
            f"Media exceeds {settings.realtime_media_max_mb}MB limit",
            status_code=413,
        )

    try:
        raw_data = base64.b64decode(encoded_payload, validate=True)
    except BinasciiError as exc:
        raise ApiError("bad_media", "Invalid media payload", status_code=400) from exc

    if not raw_data:
        raise ApiError("empty_upload", "Media payload is empty", status_code=400)
    if len(raw_data) > max_payload_bytes:
        raise ApiError(
            "payload_too_large",
            f"Media exceeds {settings.realtime_media_max_mb}MB limit",
            status_code=413,
        )

    try:
        validate_workspace_upload_signature(
            prefix=raw_data[:UPLOAD_SIGNATURE_READ_BYTES],
            media_type=mime_type,
        )
    except ApiError as exc:
        raise ApiError(
            "upload_mismatch",
            "Uploaded media contents do not match declared file type",
            status_code=400,
        ) from exc

    if mime_type.startswith("image/"):
        kind = "image"
    elif mime_type.startswith("video/"):
        kind = "video"
    else:
        raise ApiError("unsupported_media_type", "Unsupported media type", status_code=415)

    safe_filename = (filename or f"attachment.{mime_type.split('/')[-1]}").strip() or "attachment"
    return PendingMedia(kind=kind, filename=safe_filename, mime_type=mime_type, data=raw_data)


def split_text_for_realtime_tts(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []

    parts = re.split(r"(?<=[。！？!?\.])\s+", stripped)
    chunks = [part.strip() for part in parts if part.strip()]
    if chunks:
        return chunks
    return [stripped]


class ComposedRealtimeSession:
    def __init__(
        self,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_id: str,
    ) -> None:
        self.workspace_id = workspace_id
        self.project_id = project_id
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.turn_count = 0
        self._loop = asyncio.get_event_loop()
        self._last_activity = self._loop.time()
        self._audio_buffer = bytearray()
        self._pending_media: PendingMedia | None = None
        self._generation_epoch = 0
        self._turn_task: asyncio.Task[dict[str, str] | None] | None = None

    @property
    def has_buffered_audio(self) -> bool:
        return bool(self._audio_buffer)

    @property
    def idle_seconds(self) -> float:
        return max(self._loop.time() - self._last_activity, 0.0)

    @property
    def is_processing(self) -> bool:
        return self._turn_task is not None and not self._turn_task.done()

    def append_audio_chunk(self, chunk: bytes) -> None:
        self._audio_buffer.extend(chunk)
        self.touch_activity()

    def touch_activity(self) -> None:
        self._last_activity = self._loop.time()

    def replace_pending_media(self, media: PendingMedia) -> dict[str, str]:
        self._pending_media = media
        return {
            "type": "media.attached",
            "kind": media.kind,
            "filename": media.filename,
            "mime_type": media.mime_type,
        }

    def clear_pending_media(self) -> dict[str, str]:
        self._pending_media = None
        return {"type": "media.cleared"}

    async def interrupt(self) -> bool:
        if not self.is_processing:
            return False
        self._generation_epoch += 1
        task = self._turn_task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        return True

    async def start_turn(self, ws: WebSocket) -> tuple[asyncio.Task[dict[str, str] | None] | None, bool]:
        if not self._audio_buffer:
            await ws.send_json({
                "type": "turn.notice",
                "code": "no_audio_input",
                "message": "No audio detected.",
            })
            return None, False

        audio_bytes = bytes(self._audio_buffer)
        self._audio_buffer.clear()
        pending_media = self._pending_media
        self._pending_media = None
        self._generation_epoch += 1
        epoch = self._generation_epoch
        task = asyncio.create_task(self._run_turn(ws, audio_bytes, pending_media, epoch))
        self._turn_task = task
        return task, pending_media is not None

    async def _run_turn(
        self,
        ws: WebSocket,
        audio_bytes: bytes,
        pending_media: PendingMedia | None,
        epoch: int,
    ) -> dict[str, str] | None:
        try:
            image_bytes = pending_media.data if pending_media and pending_media.kind == "image" else None
            image_mime_type = pending_media.mime_type if pending_media and pending_media.kind == "image" else "image/jpeg"
            video_bytes = pending_media.data if pending_media and pending_media.kind == "video" else None
            video_mime_type = pending_media.mime_type if pending_media and pending_media.kind == "video" else "video/mp4"

            with SessionLocal() as db:
                result = await orchestrate_synthetic_realtime_turn(
                    db,
                    workspace_id=self.workspace_id,
                    project_id=self.project_id,
                    conversation_id=self.conversation_id,
                    audio_bytes=audio_bytes,
                    image_bytes=image_bytes,
                    image_mime_type=image_mime_type,
                    video_bytes=video_bytes,
                    video_mime_type=video_mime_type,
                )

            if epoch != self._generation_epoch:
                return None

            user_text = result.get("text_input", "").strip()
            assistant_text = result.get("text_response", "").strip()
            self.touch_activity()
            if not user_text.strip():
                await ws.send_json({
                    "type": "turn.notice",
                    "code": "empty_transcription",
                    "message": "No speech recognized.",
                })
                return
            if user_text:
                await ws.send_json({"type": "transcript.final", "text": user_text})

            if not assistant_text or epoch != self._generation_epoch:
                return {"user_text": user_text, "assistant_text": assistant_text}

            audio_degraded = False
            audio_meta_sent = False
            for segment in split_text_for_realtime_tts(assistant_text):
                if epoch != self._generation_epoch:
                    return None
                await ws.send_json({"type": "response.text", "text": segment})
                try:
                    with SessionLocal() as db:
                        audio_chunk = await synthesize_realtime_speech_for_project(
                            db,
                            project_id=self.project_id,
                            text=segment,
                        )
                except UpstreamServiceError:
                    logger.warning(
                        "Composed realtime TTS failed; continuing with text-only response",
                        exc_info=True,
                    )
                    audio_degraded = True
                    audio_chunk = b""
                if epoch != self._generation_epoch:
                    return None
                if audio_chunk and not audio_meta_sent:
                    await ws.send_json({
                        "type": "audio.meta",
                        "mime": "audio/mpeg",
                        "sample_rate": 24000,
                    })
                    audio_meta_sent = True
                if audio_chunk:
                    await ws.send_bytes(audio_chunk)
                    self.touch_activity()

            if epoch == self._generation_epoch:
                self.turn_count += 1
                await ws.send_json({"type": "response.done"})
                if audio_degraded:
                    await ws.send_json({
                        "type": "turn.notice",
                        "code": "audio_unavailable",
                        "message": "语音输出暂时不可用，已切换为文字回复",
                    })
                self.touch_activity()
                return {"user_text": user_text, "assistant_text": assistant_text}
            return None
        finally:
            if self._turn_task is asyncio.current_task():
                self._turn_task = None

    async def close(self) -> None:
        await self.interrupt()
