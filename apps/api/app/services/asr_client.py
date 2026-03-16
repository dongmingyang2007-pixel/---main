import httpx
from app.core.config import settings

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    model: str | None = None,
) -> str:
    """Transcribe audio to text using DashScope ASR API.

    Args:
        audio_bytes: Raw audio data (WAV, MP3, etc.)
        filename: Filename with extension for content type detection
        model: ASR model ID (default: paraformer-v2)

    Returns:
        Transcribed text string
    """
    model = model or "paraformer-v2"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/audio/transcriptions",
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
            },
            files={
                "file": (filename, audio_bytes, "audio/wav"),
            },
            data={
                "model": model,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data.get("text", "")
