import base64
from dataclasses import dataclass
from typing import Any, NoReturn

import httpx

from app.core.config import settings
from app.services.dashscope_http import DASHSCOPE_BASE_URL, dashscope_headers, get_client


class UpstreamServiceError(Exception):
    """Third-party model provider failed or returned an invalid response."""


class InferenceTimeoutError(UpstreamServiceError):
    """Third-party model provider timed out."""


@dataclass(slots=True)
class ChatCompletionResult:
    content: str
    reasoning_content: str | None = None


def raise_upstream_error(exc: Exception) -> NoReturn:
    if isinstance(exc, InferenceTimeoutError | UpstreamServiceError):
        raise exc
    if isinstance(exc, httpx.TimeoutException):
        raise InferenceTimeoutError("Inference timeout") from exc
    if isinstance(exc, httpx.HTTPError):
        raise UpstreamServiceError("Model API unavailable") from exc
    raise UpstreamServiceError(f"Unexpected model API error: {exc}") from exc


def _build_multimodal_messages(
    messages: list[dict],
    *,
    audio_bytes: bytes | None = None,
    audio_mime_type: str = "audio/wav",
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
) -> list[dict]:
    formatted_messages: list[dict] = []
    for msg in messages:
        if msg["role"] == "user" and msg is messages[-1]:
            content_parts: list[dict] = []

            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                content_parts.append({
                    "type": "input_audio",
                    "input_audio": {
                        "data": f"data:{audio_mime_type};base64,{audio_b64}",
                    },
                })

            if image_bytes:
                image_b64 = base64.b64encode(image_bytes).decode("utf-8")
                content_parts.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image_mime_type};base64,{image_b64}",
                    },
                })

            if video_bytes:
                video_b64 = base64.b64encode(video_bytes).decode("utf-8")
                content_parts.append({
                    "type": "video_url",
                    "video_url": {
                        "url": f"data:{video_mime_type};base64,{video_b64}",
                    },
                })

            text_content = msg.get("content", "")
            if text_content:
                content_parts.append({"type": "text", "text": text_content})

            formatted_messages.append({"role": "user", "content": content_parts})
        else:
            formatted_messages.append(msg)
    return formatted_messages


def _flatten_message_field(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                    continue
                if item.get("type") == "text" and isinstance(item.get("content"), str):
                    parts.append(item["content"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(part.strip() for part in parts if part and part.strip())
    return ""


def _parse_chat_completion_result(data: dict[str, Any]) -> ChatCompletionResult:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise UpstreamServiceError("Model API returned no choices")

    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise UpstreamServiceError("Model API returned an invalid message payload")

    content = _flatten_message_field(message.get("content"))
    reasoning_content = _flatten_message_field(message.get("reasoning_content")) or None
    return ChatCompletionResult(content=content, reasoning_content=reasoning_content)


async def chat_completion_detailed(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
) -> ChatCompletionResult:
    """Call DashScope chat completion API and return answer + reasoning."""
    model = model or settings.dashscope_model

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if enable_thinking is not None:
        payload["enable_thinking"] = enable_thinking

    try:
        client = get_client()
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/chat/completions",
            headers=dashscope_headers(),
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return _parse_chat_completion_result(data)
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)


async def chat_completion(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
) -> str:
    """Call DashScope chat completion API (OpenAI-compatible).
    Returns the assistant's response text."""
    result = await chat_completion_detailed(
        messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        enable_thinking=enable_thinking,
    )
    return result.content


async def chat_completion_multimodal_detailed(
    messages: list[dict],
    *,
    model: str | None = None,
    audio_bytes: bytes | None = None,
    audio_mime_type: str = "audio/wav",
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
) -> ChatCompletionResult:
    model = model or settings.dashscope_model
    formatted_messages = _build_multimodal_messages(
        messages,
        audio_bytes=audio_bytes,
        audio_mime_type=audio_mime_type,
        image_bytes=image_bytes,
        image_mime_type=image_mime_type,
        video_bytes=video_bytes,
        video_mime_type=video_mime_type,
    )

    payload: dict[str, Any] = {
        "model": model,
        "messages": formatted_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if enable_thinking is not None:
        payload["enable_thinking"] = enable_thinking

    try:
        client = get_client()
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/chat/completions",
            headers=dashscope_headers(),
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return _parse_chat_completion_result(data)
    except Exception as exc:  # noqa: BLE001
        raise_upstream_error(exc)


async def chat_completion_multimodal(
    messages: list[dict],
    *,
    model: str | None = None,
    audio_bytes: bytes | None = None,
    audio_mime_type: str = "audio/wav",
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
) -> str:
    result = await chat_completion_multimodal_detailed(
        messages,
        model=model,
        audio_bytes=audio_bytes,
        audio_mime_type=audio_mime_type,
        image_bytes=image_bytes,
        image_mime_type=image_mime_type,
        video_bytes=video_bytes,
        video_mime_type=video_mime_type,
        temperature=temperature,
        max_tokens=max_tokens,
        enable_thinking=enable_thinking,
    )
    return result.content


async def create_embedding(
    text: str,
    model: str | None = None,
) -> list[float]:
    """Create a text embedding vector using DashScope embedding API.
    Returns a list of floats (1024 dimensions for text-embedding-v3)."""
    model = model or settings.dashscope_embedding_model

    try:
        client = get_client()
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/embeddings",
            headers=dashscope_headers(),
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
        client = get_client()
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/embeddings",
            headers=dashscope_headers(),
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
    image_mime_type: str = "image/jpeg",
    model: str = "qwen3-omni-flash-realtime",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
) -> dict:
    """Call an omni model with multimodal input (audio and/or image).

    The omni model understands audio and images directly via the same
    chat/completions endpoint, using multimodal content blocks.

    Returns ``{"text": "...", "audio": None}`` -- audio output requires
    WebSocket streaming which will be added in a future phase.
    """
    result = await chat_completion_multimodal_detailed(
        messages,
        model=model,
        audio_bytes=audio_bytes,
        image_bytes=image_bytes,
        image_mime_type=image_mime_type,
        temperature=temperature,
        max_tokens=max_tokens,
        enable_thinking=enable_thinking,
    )

    return {"text": result.content, "audio": None, "reasoning_content": result.reasoning_content}
