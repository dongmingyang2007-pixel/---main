# Chat System Overhaul Design

**Date:** 2026-03-21
**Scope:** Console chat/conversation system — architecture refactor, bug fixes, streaming, polish
**Approach:** Per-module incremental overhaul (Approach C) — each phase delivers testable improvements

---

## Problem Statement

The console chat system (v0.1.6) has functional coverage across three modes (standard text, omni realtime voice, synthetic realtime voice) with RAG, memory, and multimodal support. However, it suffers from:

1. **Omni realtime cannot interrupt AI** — no client-side VAD; relies entirely on unreliable upstream `speech_started` events
2. **Standard voice input broken** — MIME type hardcoded as `recording.webm` regardless of actual browser format (MP4 on Safari/iOS)
3. **No real streaming** — backend returns complete response, frontend fakes streaming with character animation (6-22ms/char)
4. **Synthetic realtime unstable** — fixed speech threshold, silent failures on empty buffer, hardcoded audio MIME, poor error signaling
5. **Architectural debt** — ChatInterface.tsx (1234 lines, 18 useState + 9 useRef), two realtime hooks with 70-80% duplication (1572 lines combined)

---

## Phase 1: Shared Foundation

### 1.1 ChatInterface Split

Split the 1234-line monolith into 5 focused components:

```
ChatInterface.tsx (~150 lines, thin container)
├── ChatMessageList.tsx        — message rendering, scroll, animation
├── ChatInputBar.tsx           — text input, image attachment, voice record button, search/think toggles
├── ChatModePanel.tsx          — mode switching UI + current mode display
├── StandardVoiceControls.tsx  — record/dictate/read-aloud (standard mode only)
└── RealtimeVoicePanel.tsx     — unified realtime voice panel (omni + synthetic shared shell)
```

**ChatInterface responsibilities (only):**
- Hold `conversationId`, `projectId`
- Load messages and pipeline config
- Render child components based on `chatMode`
- Wire children via props/callbacks

**State ownership rules:**
- Message list state → ChatMessageList manages internally, exposes `appendMessage()`, `updateMessage()` imperative API (useImperativeHandle)
- Input state → ChatInputBar self-manages, notifies parent via `onSend(content, options)` callback
- Voice state → each voice component manages internally

### 1.2 Merge Realtime Hooks

Extract shared logic from `useRealtimeVoice` (716 lines) and `useSyntheticRealtimeVoice` (856 lines):

```
useRealtimeVoiceBase.ts (~400 lines)
  — WebSocket lifecycle (connect/disconnect/reconnect/heartbeat)
  — State machine (idle → connecting → ready → listening ↔ ai_speaking)
  — Audio capture (ScriptProcessorNode → PCM16)
  — Audio playback queue
  — Transcript management (partial/final)
  — Volume detection (userVolume/aiVolume)
  — Timer
  — Mute toggle

useRealtimeVoice.ts (~120 lines)
  — extends Base
  — Omni-specific: client-side VAD + interrupt signal (new)
  — Connects to /realtime/voice

useSyntheticRealtimeVoice.ts (~200 lines)
  — extends Base
  — Synthetic-specific: client-side VAD + audio.stop signal
  — Media attachment (attachMediaFile/clearPendingMedia)
  — Connects to /realtime/composed-voice
```

Deduplicates ~1000 lines. Bug fixes to shared logic apply to both modes.

### 1.3 SSE Streaming Infrastructure

**Backend** — new streaming utility:

```python
# app/services/streaming.py
async def stream_chat_completion(messages, model, ...):
    """Wrap DashScope streaming API into SSE events."""
    async for chunk in dashscope_stream(..., stream=True):
        yield {"event": "token", "data": {"content": chunk.delta, "reasoning": chunk.reasoning_delta}}
    yield {"event": "done", "data": {"message_id": saved_msg.id}}
```

**Frontend** — new SSE consumer:

```typescript
// lib/api-stream.ts
export async function* apiStream(path, body): AsyncGenerator<StreamEvent> {
    const response = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    const reader = response.body.getReader();
    // parse SSE lines, yield typed events
}
```

---

## Phase 2: Standard Text Mode

### 2.1 SSE Streaming Endpoint

New endpoint: `POST /api/v1/chat/conversations/{id}/stream`

```
Request: same as /messages (MessageCreate)
Response: text/event-stream

Event sequence:
  event: message_start
  data: {"message_id": "uuid", "role": "assistant"}

  event: token
  data: {"content": "..."}

  event: reasoning          ← only when enable_thinking=true
  data: {"content": "..."}

  event: message_done
  data: {"message_id": "uuid", "memories_extracted": "..."}
```

Flow:
1. Receive user message → save to DB immediately
2. Assemble context (memory + RAG + system prompt) — reuse existing orchestrator logic
3. Call DashScope with `stream=True` → relay tokens as SSE events
4. On stream end: save assistant message async + trigger memory extraction
5. Existing `POST /messages` stays as non-streaming fallback

### 2.2 DashScope Streaming Client

New function in `dashscope_client.py`:

```python
async def chat_completion_stream(messages, model, enable_thinking=False):
    payload = {..., "stream": True, "stream_options": {"include_usage": True}}
    async with client.stream("POST", url, json=payload) as resp:
        async for line in resp.aiter_lines():
            # Parse OpenAI-compatible SSE format
            # yield ContentDelta(content=..., reasoning_content=...)
```

Multimodal variant: `chat_completion_multimodal_stream()` for image-attached messages.

### 2.3 Frontend Streaming Rendering

```typescript
// 1. Immediately add empty assistant message
messageList.appendMessage({ id: tempId, role: "assistant", content: "", isStreaming: true });

// 2. Consume SSE stream
for await (const event of apiStream(`/chat/conversations/${id}/stream`, payload)) {
  if (event.type === "token") {
    messageList.updateMessage(tempId, prev => prev + event.content);
  }
  if (event.type === "reasoning") {
    messageList.updateReasoning(tempId, prev => prev + event.content);
  }
  if (event.type === "message_done") {
    messageList.finalizeMessage(tempId, { id: event.message_id, isStreaming: false });
  }
}
```

AnimatedMessageText: when `isStreaming=true`, display all received text immediately without character animation. Animation only applies to historical message entrance effects.

### 2.4 Fix Voice Input MIME Bug

**useAudioRecorder.ts:**
```typescript
// Return correct extension based on actual MediaRecorder.mimeType
const ext = mimeType.includes("mp4") ? "mp4"
          : mimeType.includes("webm") ? "webm"
          : mimeType.includes("ogg") ? "ogg" : "wav";
return { blob, filename: `recording.${ext}`, mimeType };
```

**ChatInputBar (formerly ChatInterface):**
```typescript
// Use actual filename instead of hardcoded "recording.webm"
formData.append("audio", audioBlob, recording.filename);
```

**Backend asr_client.py:** Prioritize `UploadFile.content_type` for MIME detection, filename extension as fallback.

---

## Phase 3: Omni Realtime Mode

### 3.1 Client-Side VAD for Interrupt

Add client-side VAD in `useRealtimeVoiceBase`, enabled for omni mode:

```typescript
processor.onaudioprocess = (e) => {
  const rms = calculateRMS(e.inputBuffer);
  updateUserVolume(rms);

  const isSpeech = rms >= speechThreshold;
  if (isSpeech) {
    speechStartRef.current ??= Date.now();
    lastSpeechAtRef.current = Date.now();
  }

  // Always send audio (omni mode is continuous)
  ws.send(pcm.buffer);

  // Interrupt detection: AI speaking + user speaking > threshold
  if (stateRef.current === "ai_speaking" && speechStartRef.current) {
    const elapsed = Date.now() - speechStartRef.current;
    if (elapsed >= INTERRUPT_THRESHOLD_MS) {
      ws.send(JSON.stringify({ type: "input.interrupt" }));
      speechStartRef.current = null;
    }
  }
};
```

### 3.2 Server-Side Interrupt Handler

New message type in `realtime_bridge.py`:

```python
if msg_type == "input.interrupt":
    if self._ai_speaking:
        await self.cancel_response()
        outgoing.append({"type": "interrupt.ack"})
```

Dual interrupt paths (both idempotent via `cancel_response()`):
1. DashScope upstream VAD → server auto-interrupt (existing, kept)
2. Client VAD → `input.interrupt` → server interrupt (new)

### 3.3 VAD Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `SPEECH_THRESHOLD` | 0.015 | Lower than synthetic's 0.018 — AI audio may leak into mic |
| `INTERRUPT_THRESHOLD_MS` | 400 | Sustained speech for 400ms before interrupt; avoids cough/noise |
| `SPEECH_COOLDOWN_MS` | 200 | Don't reset speechStart for 200ms after silence; handles natural pauses |

Parameters in `useRealtimeVoiceBase` config object; omni and synthetic can override individually.

### 3.4 Omni Hook (Thin Wrapper)

```typescript
export function useRealtimeVoice(options) {
  return useRealtimeVoiceBase({
    ...options,
    wsPath: "/api/v1/realtime/voice",
    sessionStartPayload: { type: "session.start", ... },
    enableClientVAD: true,
    enableInterrupt: true,
    vadConfig: { speechThreshold: 0.015, interruptThresholdMs: 400 },
    audioSendMode: "continuous",
  });
}
```

---

## Phase 4: Synthetic Realtime Mode

### 4.1 Fix Audio Playback

Server sends audio metadata before binary:

```python
# composed_realtime.py
await ws.send_json({
    "type": "audio.meta",
    "mime": "audio/mpeg",       # actual format from TTS service
    "sample_rate": 24000,
})
await ws.send_bytes(audio_chunk)
```

Client uses metadata:

```typescript
case "audio.meta":
  audioMimeRef.current = data.mime;
  break;

// On binary received:
const blob = new Blob([pcmData], { type: audioMimeRef.current || "audio/mpeg" });
```

### 4.2 Adaptive Speech Detection Threshold

Calibrate during first 2 seconds after connection:

```typescript
if (calibrationSamplesRef.current < CALIBRATION_FRAMES) {
  noiseFloorSamplesRef.current.push(rms);
  calibrationSamplesRef.current++;

  if (calibrationSamplesRef.current === CALIBRATION_FRAMES) {
    const sorted = noiseFloorSamplesRef.current.sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    speechThresholdRef.current = Math.max(p75 * 2.5, MIN_SPEECH_THRESHOLD);
    // MIN_SPEECH_THRESHOLD = 0.008
  }
  return; // Don't send audio during calibration
}
```

State transitions from `ready` to `listening` after calibration. UI shows "Calibrating microphone..." briefly.

### 4.3 Empty Buffer Error Feedback

```python
# composed_realtime.py
async def start_turn(self, ws):
    if not self._audio_buffer:
        await ws.send_json({
            "type": "turn.notice",
            "code": "no_audio_input",
            "message": "No audio detected."
        })
        return None, False
```

### 4.4 Unified Error Signaling

| Failure | Server Event | Client Behavior |
|---------|-------------|-----------------|
| ASR empty result | `turn.notice` code=`empty_transcription` | toast: localized "no speech recognized" |
| Empty audio buffer | `turn.notice` code=`no_audio_input` | toast: localized "no audio detected" |
| LLM timeout | `turn.error` code=`inference_timeout` | toast + stay in listening |
| LLM unconfigured | `turn.error` code=`model_api_unconfigured` | toast + disconnect |
| TTS failure | `response.text` sent normally, no audio | show text, skip playback |
| Mic permission denied | — (client-only) | error state + localized message |

All notices and errors go through i18n with both Chinese and English translations.

### 4.5 Synthetic Hook (Thin Wrapper)

```typescript
export function useSyntheticRealtimeVoice(options) {
  const base = useRealtimeVoiceBase({
    ...options,
    wsPath: "/api/v1/realtime/composed-voice",
    enableClientVAD: true,
    enableInterrupt: true,
    vadConfig: { speechThreshold: "auto", silenceCommitMs: 420 },
    audioSendMode: "vad-gated",
  });

  // Synthetic-specific: media attachment
  const [pendingMedia, setPendingMedia] = useState(null);
  const attachMediaFile = useCallback(async (file) => {
    const dataUrl = await readFileAsDataUrl(file);
    setPendingMedia({ kind, filename, dataUrl });
    base.sendJson({ type: "media.set", data_url: dataUrl, filename: file.name });
  }, [base]);
  const clearPendingMedia = useCallback(() => {
    setPendingMedia(null);
    base.sendJson({ type: "media.clear" });
  }, [base]);

  return { ...base, pendingMedia, attachMediaFile, clearPendingMedia };
}
```

856 lines → ~80 lines. Media is the only differential logic.

---

## Phase 5: Polish & Hardening

### 5.1 chat/page.tsx Sidebar Split

```
chat/page.tsx (~80 lines, layout container)
├── ConversationSidebar.tsx    — conversation list, search, grouping, CRUD
└── ChatInterface.tsx          — already thinned in Phase 1
```

ConversationSidebar self-manages conversation list, date grouping, search filtering, CRUD operations. Notifies parent via `onSelectConversation(id)` callback. page.tsx only handles two-column layout + route params (`project_id`, `conv`) sync.

### 5.2 Playback Queue Robustness

**Interrupt cleanup:**
```typescript
function handleInterrupt() {
  audioPlayerRef.current?.pause();
  playbackQueueRef.current.forEach(url => URL.revokeObjectURL(url));
  playbackQueueRef.current = [];
  isPlaybackActiveRef.current = false;
}
```

**Stuck playback guard:**
```typescript
player.onended = () => { isPlaybackActiveRef.current = false; pumpQueue(); };
player.onerror = () => { isPlaybackActiveRef.current = false; pumpQueue(); };
// Timeout fallback: 15s max per audio chunk
playbackTimeoutRef.current = setTimeout(() => {
  isPlaybackActiveRef.current = false;
  pumpQueue();
}, 15_000);
```

### 5.3 Object URL Memory Leak Cleanup

```typescript
player.onended = () => {
  URL.revokeObjectURL(player.src);
  isPlaybackActiveRef.current = false;
  pumpQueue();
};

useEffect(() => {
  return () => {
    playbackQueueRef.current.forEach(url => URL.revokeObjectURL(url));
  };
}, []);
```

### 5.4 Connection State UI

| State | Display |
|-------|---------|
| `connecting` | Pulse animation + "Connecting..." |
| `ready` (calibrating) | "Calibrating microphone..." |
| `listening` | Green waveform + "Listening" |
| `ai_speaking` | Purple waveform + "Responding" |
| `reconnecting` | Yellow indicator + "Reconnecting (1/3)" |
| `error` | Red + error description + retry button |

### 5.5 Graceful Degradation

```
Realtime voice connection failure → auto-fallback to standard text mode + toast
SSE stream interrupted → fallback to POST /messages non-streaming + re-fetch complete message
TTS service unavailable → show text only, hide read-aloud button
ASR service unavailable → hide microphone button + toast
```

### 5.6 Final File Structure

```
components/console/
├── ChatInterface.tsx           (~150 lines, thin container)
├── ChatMessageList.tsx         (~250 lines, message rendering)
├── ChatInputBar.tsx            (~200 lines, input area)
├── ChatModePanel.tsx           (~80 lines, mode switching)
├── StandardVoiceControls.tsx   (~120 lines, record/read-aloud)
├── RealtimeVoicePanel.tsx      (~180 lines, unified realtime voice UI)
├── RealtimeVoice.tsx           (deleted, merged into RealtimeVoicePanel)
└── SyntheticRealtimeVoice.tsx  (deleted, merged into RealtimeVoicePanel)

hooks/
├── useRealtimeVoiceBase.ts     (~400 lines, shared foundation)
├── useRealtimeVoice.ts         (~120 lines, omni wrapper)
├── useSyntheticRealtimeVoice.ts(~80 lines, synthetic wrapper)
└── useAudioRecorder.ts         (MIME fix, ~60 lines)

app/[locale]/(console)/app/chat/
├── page.tsx                    (~80 lines, layout)
└── ConversationSidebar.tsx     (~300 lines, conversation list)
```

**Estimated code change:**
- Current: ~3900 lines (core chat files)
- After overhaul: ~2020 lines
- Net reduction: ~48%, with added functionality (SSE streaming, client VAD, adaptive threshold, degradation)

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| DashScope stream=true support uncertainty | Verify API docs first; if unsupported, use WebSocket streaming variant or chunked polling |
| ScriptProcessorNode deprecated | Current approach works; future migration to AudioWorklet is separate scope |
| Adaptive VAD calibration in noisy environments | MIN_SPEECH_THRESHOLD (0.008) as absolute floor; user can manually trigger recalibration |
| SSE through reverse proxy / CDN | Ensure `X-Accel-Buffering: no` header; test with nginx/cloudflare |

## Out of Scope

- Conversation branching / message editing (future feature)
- Conversation export (future feature)
- AudioWorklet migration (separate task)
- Mobile-specific audio handling (separate task)
