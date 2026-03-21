# Chat System Overhaul — Phase 2: SSE Streaming + Standard Text Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the request-response chat flow with real SSE streaming so users see tokens as they arrive, plus add abort/stop-generating support.

**Architecture:** New streaming DashScope client function → new SSE endpoint in chat router → frontend consumes via api-stream.ts → ChatInterface streams into ChatMessageList via imperative handle.

**Tech Stack:** FastAPI (SSE via StreamingResponse), httpx (async streaming), React, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-chat-system-overhaul-design.md` — Phase 2

**Depends on:** Phase 1 complete (api-stream.ts, ChatMessageList with imperative handle)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `apps/api/app/services/dashscope_stream.py` | Streaming wrapper around DashScope chat completions API — yields token chunks |

### Files to modify

| File | Change |
|------|--------|
| `apps/api/app/routers/chat.py` | Add `POST /api/v1/chat/conversations/{id}/stream` SSE endpoint |
| `apps/api/app/services/orchestrator.py` | Add `orchestrate_inference_stream()` that yields SSE events |
| `apps/web/components/console/ChatInterface.tsx` | Replace `apiPost` in handleSend with `apiStream` for streaming |
| `apps/web/components/console/ChatMessageList.tsx` | Ensure AnimatedMessageText handles `isStreaming=true` correctly (show all text, no animation) |

---

## Task 1: DashScope streaming client

**Files:**
- Create: `apps/api/app/services/dashscope_stream.py`

- [ ] **Step 1: Read existing dashscope_client.py to understand API patterns**

Read: `apps/api/app/services/dashscope_client.py` — understand how `chat_completion_detailed()` works, what endpoint it calls, what headers/auth it uses, the payload format.

- [ ] **Step 2: Create dashscope_stream.py**

```python
# apps/api/app/services/dashscope_stream.py
"""Streaming variant of DashScope chat completion API."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import AsyncIterator

import httpx

from app.core.config import settings

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
    enable_thinking: bool = False,
    timeout: float = 120.0,
) -> AsyncIterator[StreamChunk]:
    """Stream chat completion tokens from DashScope OpenAI-compatible API."""
    model = model or settings.dashscope_model
    url = f"{settings.dashscope_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key}",
        "Content-Type": "application/json",
    }

    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if enable_thinking:
        payload["enable_thinking"] = True

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise httpx.HTTPStatusError(
                    f"DashScope streaming error: {response.status_code}",
                    request=response.request,
                    response=response,
                )

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    return

                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                choices = data.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                chunk = StreamChunk(
                    content=delta.get("content", "") or "",
                    reasoning_content=delta.get("reasoning_content", "") or "",
                    finish_reason=choices[0].get("finish_reason"),
                )
                if chunk.content or chunk.reasoning_content or chunk.finish_reason:
                    yield chunk
```

- [ ] **Step 3: Verify syntax**

Run: `cd apps/api && python -c "from app.services.dashscope_stream import chat_completion_stream; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/services/dashscope_stream.py
git commit -m "feat: add DashScope streaming client (dashscope_stream.py)"
```

---

## Task 2: Streaming orchestrator function

**Files:**
- Modify: `apps/api/app/services/orchestrator.py`

- [ ] **Step 1: Read orchestrator.py to understand orchestrate_inference()**

Understand how context is assembled (memory + RAG + system prompt) and how the LLM is called.

- [ ] **Step 2: Add orchestrate_inference_stream()**

Add a new function that reuses the same context assembly logic but calls the streaming client and yields SSE-formatted events:

```python
from app.services.dashscope_stream import chat_completion_stream, StreamChunk

async def orchestrate_inference_stream(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    enable_thinking: bool | None = None,
    enable_search: bool | None = None,
    user_id: str | None = None,
) -> AsyncIterator[dict]:
    """Stream inference results as SSE event dicts."""
    # Reuse existing context assembly from _build_and_call_llm
    project, conversation = _load_active_conversation_context(
        db, workspace_id=workspace_id, project_id=project_id, conversation_id=conversation_id,
    )

    # Build system prompt + messages (same as _build_and_call_llm)
    # ... (extract shared logic or call shared helper) ...

    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")

    yield {"event": "message_start", "data": {"role": "assistant"}}

    full_content = ""
    full_reasoning = ""

    async for chunk in chat_completion_stream(
        messages=assembled_messages,
        model=llm_model_id,
        enable_thinking=resolved_thinking,
    ):
        if chunk.content:
            full_content += chunk.content
            yield {"event": "token", "data": {"content": chunk.content}}
        if chunk.reasoning_content:
            full_reasoning += chunk.reasoning_content
            yield {"event": "reasoning", "data": {"content": chunk.reasoning_content}}

    yield {
        "event": "message_done",
        "data": {"content": full_content, "reasoning_content": full_reasoning},
    }
```

The key challenge is extracting the shared context-assembly logic from `_build_and_call_llm()` into a reusable helper that both the streaming and non-streaming paths can call. Read the existing code carefully and decide the cleanest extraction.

- [ ] **Step 3: Verify import**

Run: `cd apps/api && python -c "from app.services.orchestrator import orchestrate_inference_stream; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/services/orchestrator.py
git commit -m "feat: add streaming orchestrator function"
```

---

## Task 3: SSE streaming endpoint

**Files:**
- Modify: `apps/api/app/routers/chat.py`

- [ ] **Step 1: Read chat.py send_message endpoint (around line 296)**

Understand the full flow: rate limit → save user message → orchestrate → save AI message → memory extraction.

- [ ] **Step 2: Add POST /stream endpoint**

```python
from fastapi.responses import StreamingResponse

@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: str,
    payload: MessageCreate,
    request: Request,
    db: Session = Depends(get_db_session),
    user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write: None = Depends(require_workspace_write_access),
    _csrf: None = Depends(require_csrf_protection),
    _rate: None = Depends(lambda r: enforce_rate_limit(r, "chat-send", 10, 60)),
):
    """Stream AI response as Server-Sent Events."""
    _ensure_model_api_configured()

    # Verify access
    conversation = can_access_workspace_conversation(db, workspace_id, conversation_id, user)
    project = db.query(Project).filter_by(id=conversation.project_id).first()

    # Save user message immediately
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=payload.content.strip(),
    )
    db.add(user_msg)
    db.flush()

    async def event_generator():
        full_content = ""
        full_reasoning = ""

        try:
            async for event in orchestrate_inference_stream(
                db,
                workspace_id=workspace_id,
                project_id=str(project.id),
                conversation_id=conversation_id,
                user_message=payload.content.strip(),
                enable_thinking=payload.enable_thinking,
                user_id=str(user.id),
            ):
                if event["event"] == "token":
                    full_content += event["data"]["content"]
                elif event["event"] == "reasoning":
                    full_reasoning += event["data"]["content"]

                yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

            # Save assistant message after stream completes
            ai_msg = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_content,
                reasoning_content=full_reasoning or None,
            )
            db.add(ai_msg)
            conversation.updated_at = datetime.now(timezone.utc)
            db.commit()

            # Send final event with message ID
            yield f"event: message_done\ndata: {json.dumps({'message_id': str(ai_msg.id)})}\n\n"

            # Trigger async memory extraction
            # ... (same as existing endpoint)

        except Exception as e:
            error_data = {"code": "stream_error", "message": str(e)}
            yield f"event: error\ndata: {json.dumps(error_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 3: Run backend tests**

Run: `cd apps/api && python -m pytest tests/test_api_integration.py -q --tb=short`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/routers/chat.py
git commit -m "feat: add SSE streaming endpoint POST /stream"
```

---

## Task 4: Frontend streaming integration

**Files:**
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Read current handleSend in ChatInterface.tsx**

Understand the current flow: text or image → apiPost → receive complete response → add to messages.

- [ ] **Step 2: Replace text message sending with SSE streaming**

In `handleSend`, when sending a text message (not image):

```typescript
import { apiStream } from "@/lib/api-stream";

// Replace the apiPost call with streaming:
const abortController = new AbortController();
// Store abort controller for "stop generating" button
abortControllerRef.current = abortController;

// Add empty assistant message immediately
const tempId = `stream-${Date.now()}`;
messageListRef.current?.appendMessage({
  id: tempId,
  role: "assistant",
  content: "",
  isStreaming: true,
});
setIsTyping(false); // Not "typing" anymore — we're streaming

try {
  for await (const event of apiStream(
    `/api/v1/chat/conversations/${conversationId}/stream`,
    { content, enable_thinking: options.enableThinking },
    abortController.signal,
  )) {
    switch (event.event) {
      case "token":
        messageListRef.current?.updateMessage(
          tempId,
          (prev) => prev + (event.data.content as string),
        );
        break;
      case "reasoning":
        messageListRef.current?.updateReasoning(
          tempId,
          (prev) => prev + (event.data.content as string),
        );
        break;
      case "message_done":
        messageListRef.current?.finalizeMessage(tempId, {
          id: (event.data.message_id as string) || tempId,
          isStreaming: false,
          memories_extracted: event.data.memories_extracted as string | undefined,
        });
        break;
      case "error":
        messageListRef.current?.updateMessage(
          tempId,
          () => t(`errors.${(event.data.code as string) || "streamError"}`),
        );
        messageListRef.current?.finalizeMessage(tempId, { id: tempId, isStreaming: false });
        break;
    }
  }
} catch (err) {
  if ((err as Error).name === "AbortError") {
    // User clicked "stop generating"
    messageListRef.current?.finalizeMessage(tempId, { id: tempId, isStreaming: false });
  } else {
    // Fallback: try non-streaming endpoint
    // ... existing apiPost logic as fallback ...
  }
} finally {
  abortControllerRef.current = null;
}
```

- [ ] **Step 3: Add "Stop generating" button**

Add an `abortControllerRef = useRef<AbortController | null>(null)` and expose a stop button in the UI when streaming is active (when any message has `isStreaming: true`).

- [ ] **Step 4: Keep image messages as non-streaming**

Image messages still use the existing `apiPost` to `/image` endpoint (multimodal streaming is out of scope for now).

- [ ] **Step 5: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/console/ChatInterface.tsx
git commit -m "feat: integrate SSE streaming for text chat messages"
```

---

## Task 5: Add "stop generating" i18n + error keys

**Files:**
- Modify: `apps/web/messages/en/console-chat.json`
- Modify: `apps/web/messages/zh/console-chat.json`

- [ ] **Step 1: Add new i18n keys**

English:
```json
{
  "stopGenerating": "Stop generating",
  "errors.streamError": "An error occurred while streaming the response."
}
```

Chinese:
```json
{
  "stopGenerating": "停止生成",
  "errors.streamError": "流式响应时发生错误。"
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add streaming i18n keys (stop generating, stream error)"
```

---

## Task 6: Backend ASR MIME detection improvement

**Files:**
- Modify: `apps/api/app/services/asr_client.py` (or wherever ASR transcription handles MIME)

- [ ] **Step 1: Read the ASR transcription code**

Find where MIME type is detected from filename extension and improve it to prioritize `UploadFile.content_type`.

- [ ] **Step 2: Update MIME detection**

Prioritize the `content_type` from the upload over filename extension:

```python
def _detect_audio_mime(content_type: str | None, filename: str) -> str:
    """Detect audio MIME type, preferring content_type over filename."""
    if content_type and content_type.startswith("audio/"):
        return content_type
    # Fallback to filename extension
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    return {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "webm": "audio/webm",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
        "mp4": "audio/mp4",
    }.get(ext, "audio/wav")
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && python -m pytest tests/ -q --tb=short`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/services/
git commit -m "fix: prioritize content_type over filename for ASR MIME detection"
```

---

## Task 7: Final Phase 2 verification

- [ ] **Step 1: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 2: Backend tests**

Run: `cd apps/api && python -m pytest tests/ -q --tb=short`

- [ ] **Step 3: Verify streaming endpoint responds**

Manual test or curl check that the `/stream` endpoint returns `text/event-stream` content type.

- [ ] **Step 4: Commit if needed**

Clean up any remaining issues.
