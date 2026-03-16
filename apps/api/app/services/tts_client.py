import base64

import httpx
from app.core.config import settings

DASHSCOPE_NATIVE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


async def synthesize_speech(
    text: str,
    model: str | None = None,
    voice: str = "Cherry",
) -> bytes:
    """Synthesize speech from text using Qwen3-TTS-Flash (DashScope native API).

    Uses the non-streaming multimodal generation endpoint.

    Args:
        text: Text to convert to speech (max ~2000 chars recommended)
        model: TTS model ID (default: qwen3-tts-flash)
        voice: Voice name (Cherry, Serena, Ethan, Chelsie, etc.)

    Returns:
        Audio bytes
    """
    model = model or "qwen3-tts-flash"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            DASHSCOPE_NATIVE_URL,
            headers={
                "Authorization": f"Bearer {settings.dashscope_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": {
                    "text": text,
                    "voice": voice,
                },
            },
        )
        response.raise_for_status()
        data = response.json()

        # Response contains audio URL or base64 data
        output = data.get("output", {})
        audio_info = output.get("audio", {})

        # If URL is returned, download the audio
        audio_url = audio_info.get("url")
        if audio_url:
            audio_resp = await client.get(audio_url)
            audio_resp.raise_for_status()
            return audio_resp.content

        # If base64 data is returned directly
        audio_data = audio_info.get("data")
        if audio_data:
            return base64.b64decode(audio_data)

        raise ValueError("No audio data in TTS response")
