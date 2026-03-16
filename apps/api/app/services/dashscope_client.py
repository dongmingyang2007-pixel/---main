import httpx
from app.core.config import settings


DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


async def chat_completion(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Call DashScope chat completion API (OpenAI-compatible).
    Returns the assistant's response text."""
    model = model or settings.dashscope_model

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


async def create_embedding(
    text: str,
    model: str | None = None,
) -> list[float]:
    """Create a text embedding vector using DashScope embedding API.
    Returns a list of floats (1024 dimensions for text-embedding-v3)."""
    model = model or settings.dashscope_embedding_model

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


async def create_embeddings_batch(
    texts: list[str],
    model: str | None = None,
) -> list[list[float]]:
    """Batch embed multiple texts. Returns list of vectors."""
    model = model or settings.dashscope_embedding_model

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
