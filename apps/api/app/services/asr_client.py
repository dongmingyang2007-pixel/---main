import base64

import httpx
from app.core.config import settings

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


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
