"""Streaming variant of DashScope chat completion API."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings
from app.services.dashscope_client import (
    InferenceTimeoutError,
    UpstreamServiceError,
)
from app.services.dashscope_http import DASHSCOPE_BASE_URL, dashscope_headers, get_client

logger = logging.getLogger(__name__)


@dataclass
class StreamChunk:
    content: str = ""
    reasoning_content: str = ""
    finish_reason: str | None = None


async def chat_completion_stream(
    messages: list[dict],
    model: str | None = None,
    *,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    enable_thinking: bool | None = None,
    timeout: float = 120.0,
) -> AsyncIterator[StreamChunk]:
    """Stream chat completion tokens from DashScope OpenAI-compatible API.

    Yields StreamChunk objects as they arrive from the API.
    The caller is responsible for accumulating content.
    """
    model = model or settings.dashscope_model

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if enable_thinking is not None:
        payload["enable_thinking"] = enable_thinking

    try:
        client = get_client()
        async with client.stream(
            "POST",
            f"{DASHSCOPE_BASE_URL}/chat/completions",
            headers=dashscope_headers(),
            json=payload,
            timeout=timeout,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[len("data:"):].strip()
                if raw == "[DONE]":
                    break
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("dashscope_stream: failed to parse SSE line: %r", raw)
                    continue

                choices = data.get("choices")
                if not choices:
                    # Could be a usage-only chunk; skip silently
                    continue

                delta = choices[0].get("delta", {})
                finish_reason = choices[0].get("finish_reason")

                content = delta.get("content") or ""
                reasoning_content = delta.get("reasoning_content") or ""

                if content or reasoning_content or finish_reason:
                    yield StreamChunk(
                        content=content,
                        reasoning_content=reasoning_content,
                        finish_reason=finish_reason,
                    )
    except (InferenceTimeoutError, UpstreamServiceError):
        raise
    except httpx.TimeoutException as exc:
        raise InferenceTimeoutError("Inference timeout") from exc
    except httpx.HTTPError as exc:
        raise UpstreamServiceError("Model API unavailable") from exc
    except Exception as exc:  # noqa: BLE001
        raise UpstreamServiceError(f"Unexpected model API error: {exc}") from exc
