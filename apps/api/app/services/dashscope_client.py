import base64

import httpx

from app.core.config import settings


DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class UpstreamServiceError(Exception):
    """Third-party model provider failed or returned an invalid response."""


class InferenceTimeoutError(UpstreamServiceError):
    """Third-party model provider timed out."""


def raise_upstream_error(exc: Exception) -> None:
    if isinstance(exc, InferenceTimeoutError | UpstreamServiceError):
        raise exc
    if isinstance(exc, httpx.TimeoutException):
        raise InferenceTimeoutError("Inference timeout") from exc
    if isinstance(exc, httpx.HTTPError):
        raise UpstreamServiceError("Model API unavailable") from exc
    raise exc


async def chat_completion(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Call DashScope chat completion API (OpenAI-compatible).
    Returns the assistant's response text."""
    model = model or settings.dashscope_model

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{DASHSCOPE_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.dashscope_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)


async def create_embedding(
    text: str,
    model: str | None = None,
) -> list[float]:
    """Create a text embedding vector using DashScope embedding API.
    Returns a list of floats (1024 dimensions for text-embedding-v3)."""
    model = model or settings.dashscope_embedding_model

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{DASHSCOPE_BASE_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {settings.dashscope_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": text,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)


async def create_embeddings_batch(
    texts: list[str],
    model: str | None = None,
) -> list[list[float]]:
    """Batch embed multiple texts. Returns list of vectors."""
    model = model or settings.dashscope_embedding_model

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{DASHSCOPE_BASE_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {settings.dashscope_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": texts,
                },
            )
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)


async def omni_completion(
    messages: list[dict],
    audio_bytes: bytes | None = None,
    image_bytes: bytes | None = None,
    model: str = "qwen3-omni-flash-realtime",
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> dict:
    """Call an omni model with multimodal input (audio and/or image).

    The omni model understands audio and images directly via the same
    chat/completions endpoint, using multimodal content blocks.

    Returns ``{"text": "...", "audio": None}`` -- audio output requires
    WebSocket streaming which will be added in a future phase.
    """
    # Build the last user message as multimodal content blocks
    # Find the last user message and convert it to multimodal format
    formatted_messages: list[dict] = []
    for msg in messages:
        if msg["role"] == "user" and msg is messages[-1]:
            # Convert last user message to multimodal content
            content_parts: list[dict] = []

            # Add audio input if provided
            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                content_parts.append({
                    "type": "input_audio",
                    "input_audio": {
                        "data": f"data:audio/wav;base64,{audio_b64}",
                    },
                })

            # Add image input if provided
            if image_bytes:
                image_b64 = base64.b64encode(image_bytes).decode("utf-8")
                content_parts.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_b64}",
                    },
                })

            # Add text content
            text_content = msg.get("content", "")
            if text_content:
                content_parts.append({"type": "text", "text": text_content})

            formatted_messages.append({"role": "user", "content": content_parts})
        else:
            formatted_messages.append(msg)

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{DASHSCOPE_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.dashscope_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": formatted_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
            response_text = data["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)

    return {"text": response_text, "audio": None}
