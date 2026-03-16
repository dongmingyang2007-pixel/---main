import httpx
from app.core.config import settings

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


async def synthesize_speech(
    text: str,
    model: str | None = None,
    voice: str = "alloy",
) -> bytes:
    """Synthesize speech from text using DashScope TTS API.

    Args:
        text: Text to convert to speech
        model: TTS model ID (default: cosyvoice-v1)
        voice: Voice ID/name

    Returns:
        Audio bytes (MP3 format)
    """
    model = model or "cosyvoice-v1"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/audio/speech",
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": text,
                "voice": voice,
            },
        )
        response.raise_for_status()
        # TTS API returns raw audio bytes
        return response.content
