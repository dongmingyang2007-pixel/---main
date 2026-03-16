import base64
import json

import httpx
import websockets
from app.core.config import settings

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DASHSCOPE_WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    model: str | None = None,
) -> str:
    """Transcribe audio to text using Qwen3-ASR-Flash (OpenAI-compatible).

    Uses the chat/completions endpoint with input_audio content type.
    Supports Base64-encoded audio data for direct upload.

    Args:
        audio_bytes: Raw audio data (WAV, MP3, WebM, etc.)
        filename: Filename (used for logging, not sent to API)
        model: ASR model ID (default: qwen3-asr-flash)

    Returns:
        Transcribed text string
    """
    model = model or "qwen3-asr-flash"

    # Encode audio as base64 data URL
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    # Detect MIME type from filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    mime_map = {"wav": "audio/wav", "mp3": "audio/mpeg", "webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg"}
    mime = mime_map.get(ext, "audio/wav")
    data_url = f"data:{mime};base64,{audio_b64}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_audio",
                                "input_audio": {"data": data_url},
                            }
                        ],
                    }
                ],
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def transcribe_audio_realtime(
    audio_bytes: bytes,
    model: str | None = None,
    sample_rate: int = 16000,
) -> str:
    """Realtime: WebSocket, streams audio chunks, returns accumulated text.

    Despite being "realtime", we send the complete audio in chunks
    since we record first then send. The benefit is that the realtime
    model starts processing immediately as chunks arrive.
    """
    model = model or "qwen3-asr-flash-realtime"
    ws_url = f"{DASHSCOPE_WS_URL}?model={model}"

    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key}",
        "OpenAI-Beta": "realtime=v1",
    }

    transcript_parts: list[str] = []

    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        # 1. Configure session
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "modalities": ["text"],
                "input_audio_format": "pcm",
                "sample_rate": sample_rate,
                "input_audio_transcription": {"language": "zh"},
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.0,
                    "silence_duration_ms": 400,
                },
            },
        }))

        # Wait for session.updated confirmation
        await ws.recv()

        # 2. Send audio in chunks (16 KB each, base64-encoded)
        chunk_size = 16384
        audio_b64 = base64.b64encode(audio_bytes).decode()
        for i in range(0, len(audio_b64), chunk_size):
            chunk = audio_b64[i : i + chunk_size]
            await ws.send(json.dumps({
                "type": "input_audio_buffer.append",
                "audio": chunk,
            }))

        # 3. Signal end
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        await ws.send(json.dumps({"type": "session.finish"}))

        # 4. Collect transcription results
        async for message in ws:
            event = json.loads(message)
            event_type = event.get("type", "")

            if event_type == "conversation.item.input_audio_transcription.completed":
                transcript_parts.append(event.get("transcript", ""))
            elif event_type == "session.finished":
                break
            elif event_type == "error":
                raise RuntimeError(f"ASR WebSocket error: {event}")

    return "".join(transcript_parts)
