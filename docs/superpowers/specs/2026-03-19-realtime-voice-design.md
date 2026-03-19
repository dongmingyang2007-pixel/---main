# Real-Time Full-Duplex Voice Conversation Design

**Date**: 2026-03-19
**Status**: Draft
**Scope**: Full-duplex voice conversation with smart interruption, RAG/memory participation, and dynamic island floating UI

## Context

The platform currently supports voice interaction through a "walkie-talkie" HTTP pipeline: user records complete audio → uploads → ASR → LLM → TTS → receives complete response. This creates noticeable latency and prevents natural conversational flow.

The goal is to achieve phone-call-like real-time voice conversation where the user and AI can speak simultaneously, with intelligent interruption handling. This serves two use cases:
1. **Web console demo** — immediate implementation for customer/investor demos
2. **Earphone hardware** — future earphone AI assistant reuses the same backend

## Architecture: Dual WebSocket Bridge

```
┌─────────────┐     WebSocket      ┌──────────────────┐     WebSocket      ┌─────────────┐
│  Browser /   │ ◄══════════════► │   FastAPI Backend  │ ◄══════════════► │  DashScope   │
│  Earphone    │  bidirectional    │  (smart relay)     │  bidirectional    │  Omni API    │
└─────────────┘  audio + control   └──────────────────┘  audio + control   └─────────────┘
                                          │
                                          │ async queries
                                          ▼
                                   ┌──────────────┐
                                   │  PostgreSQL   │
                                   │  RAG/Memory   │
                                   └──────────────┘
```

The backend acts as a smart relay between the client and DashScope's `qwen3-omni-flash-realtime` model. It injects context (personality, memories, RAG results) and manages interruption logic.

### Why this approach

- **Security**: API keys stay server-side; clients never touch DashScope directly
- **RAG integration**: backend can asynchronously enrich context between turns
- **Client portability**: browser and earphone connect to the same WebSocket endpoint
- **Smart interruption**: backend interprets VAD events and applies filtering logic before relaying

### Alternatives considered

- **Direct client-to-DashScope**: simpler but exposes API key, no RAG injection, no client portability
- **Separated pipeline (ASR + LLM HTTP + TTS)**: not truly full-duplex, cumulative latency from three stages, interruption logic must be built from scratch

## WebSocket Protocol

### Authentication

WebSocket handshake includes `token` query parameter (bearer token). Backend validates in `on_connect` before accepting the connection.

### Client → Server Messages

| Type | Format | Payload | Description |
|------|--------|---------|-------------|
| `session.start` | JSON | `{conversation_id, project_id}` | Initiate voice session |
| `audio.chunk` | Binary | PCM 16kHz 16bit mono | Streaming audio data |
| `audio.stop` | JSON | `{}` | User manually stops speaking (backup for VAD) |
| `session.end` | JSON | `{}` | Hang up |

### Server → Client Messages

| Type | Format | Payload | Description |
|------|--------|---------|-------------|
| `session.ready` | JSON | `{}` | Context loaded, ready to talk |
| `transcript.partial` | JSON | `{text}` | Real-time partial transcription of user speech |
| `transcript.final` | JSON | `{text}` | Final transcription of user utterance |
| `audio.delta` | Binary | MP3/PCM audio chunk | AI response audio for immediate playback |
| `response.text` | JSON | `{text}` | AI response text (for display in expanded panel) |
| `response.done` | JSON | `{}` | Current response turn complete |
| `interrupt.ack` | JSON | `{}` | AI response interrupted, client should stop playback |
| `session.idle` | JSON | `{}` | No user input for 60s warning |
| `error` | JSON | `{code, message}` | Error information |

## Smart Interruption

DashScope Omni provides server-side VAD (Voice Activity Detection) that emits `input_audio_buffer.speech_started` events.

**Logic**:
1. DashScope detects user speech start → backend receives VAD event
2. If AI is currently outputting audio AND user speech continues for > **500ms** → trigger interruption
3. Backend sends `response.cancel` to DashScope to stop generation
4. Backend sends `interrupt.ack` to client → client stops audio playback
5. Speech shorter than 500ms (e.g., "嗯", "对") does not interrupt; processed after AI finishes

The 500ms threshold is configurable via `REALTIME_INTERRUPT_THRESHOLD_MS` setting.

## RAG and Memory Strategy

### Three context-loading stages

**1. Connection establishment (synchronous, blocking)**
- Load assistant personality prompt
- Load permanent memories
- Load recent N conversation history messages
- Assemble into system prompt → send to DashScope via `session.update`
- `session.ready` sent to client only after this completes

**2. Post-response (asynchronous, non-blocking)**
- After `response.done`, take user's transcribed text
- Run RAG search (embedding similarity against knowledge base)
- Dispatch Celery task for memory extraction
- If RAG hits relevant knowledge → append to DashScope context via `session.update`
- Next turn naturally benefits from updated context

**3. Periodic refresh in long conversations (asynchronous, non-blocking)**
- Every 5 turns or every 3 minutes: reload temporary memories
- Prevents stale context in extended conversations

### Context window management
- DashScope Omni has limited context
- Strategy: retain system prompt (personality + memories) + last 10 conversation turns
- Older turns dropped from context but preserved in database

### Code reuse
- Reuses `orchestrator.py`: `_load_personality()`, `_load_memories()`, `_rag_search()`
- Reuses `worker_tasks.py`: `extract_memories_from_conversation` Celery task
- No rewrite needed; functions called at appropriate points in WebSocket lifecycle

## Frontend UI: Dynamic Island Floating Widget

### State Machine

```
[Entry Button] ──click──→ [Connecting] ──ready──→ [Listening]
                                                     ↕ (auto)
                                                  [AI Speaking]
                                                     │
                              [Listening] ←──────────┘
                                  │
                          hang up / timeout
                                  │
                                  ▼
                           [Entry Button]
```

All active states (Listening, AI Speaking) have two sub-states: **collapsed pill** and **expanded panel**.

### Five visual states

1. **Entry button** (disconnected): Fixed bottom-right, pill shape showing "实时对话". Click to connect.

2. **Connecting**: Pill with spinner animation. Backend loading personality/memories/history.

3. **Listening** (collapsed pill): Green indicator + waveform bars following user audio volume. Shows "聆听中" + timer.

4. **AI Speaking** (collapsed pill): Purple indicator + waveform bars following AI audio output. Shows "回复中" + timer.

5. **Expanded panel** (click pill to toggle):
   - Header: status indicator + assistant name + timer + collapse button
   - Transcript area: scrollable real-time conversation text (user bubbles + AI bubbles with typing cursor)
   - Controls: mute mic / hang up (red) / speaker toggle

### Color semantics
- Green (#22c55e) = listening to user
- Purple (#818cf8) = AI speaking
- Red (#ef4444) = hang up / end

### Interactions
- Pill is draggable (position persists in session)
- Click pill to expand/collapse
- Hang up → graceful close → pill shrinks back to entry button
- Conversation content auto-saved to current conversation record

## Error Handling

### Network disconnection
- Client WebSocket drops → pill shows "连接中断，正在重连..."
- Auto-reconnect with exponential backoff (1s, 2s, 4s), max 3 attempts
- Success → reload context, resume conversation (history saved in DB)
- Failure → show "连接失败" + manual retry button

### DashScope upstream failure
- Backend-to-DashScope WebSocket drops → attempt to rebuild upstream connection
- During rebuild → send `error` to client, pill briefly shows "AI 暂时无响应"
- Persistent failure → degrade to separated pipeline (ASR HTTP + LLM HTTP + TTS HTTP)

### Audio permissions
- Microphone denied → pill shows "需要麦克风权限" with instructions, no connection attempt
- Permission revoked mid-session → detect MediaStream end, graceful close

### Concurrency limits
- 1 active voice session per user
- Attempt to open second → "您已有一个进行中的对话"
- Server global limit: configurable max concurrent WebSocket sessions (default 50), excess returns 503

### Timeouts
- 60s no user input → `session.idle` warning
- 120s no input → auto-close, save conversation, pill returns to entry state
- Max session duration: 30 minutes

## New Configuration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `realtime_interrupt_threshold_ms` | 500 | Minimum speech duration to trigger AI interruption |
| `realtime_idle_timeout_seconds` | 60 | Seconds before idle warning |
| `realtime_close_timeout_seconds` | 120 | Seconds before auto-close |
| `realtime_max_session_seconds` | 1800 | Maximum session duration |
| `realtime_max_concurrent_sessions` | 50 | Server-wide concurrent WebSocket limit |
| `realtime_context_history_turns` | 10 | Conversation turns kept in DashScope context |
| `realtime_rag_refresh_turns` | 5 | Turns between async context refreshes |
| `realtime_reconnect_max_attempts` | 3 | Client reconnection attempts |

## New Files

| File | Purpose |
|------|---------|
| `apps/api/app/routers/realtime.py` | FastAPI WebSocket endpoint |
| `apps/api/app/services/realtime_bridge.py` | Dual WebSocket bridge logic, interruption handling, context management |
| `apps/web/components/console/RealtimeVoice.tsx` | Dynamic island floating widget component |
| `apps/web/hooks/useRealtimeVoice.ts` | WebSocket client hook, audio capture/playback, state machine |
| `apps/api/alembic/versions/..._add_realtime_settings.py` | Migration for new config columns if needed |

## Dependencies on Existing Code

- `app/services/orchestrator.py` — `_load_personality()`, `_load_memories()`, `_rag_search()`
- `app/services/dashscope_client.py` — `UpstreamServiceError`, `InferenceTimeoutError`
- `app/tasks/worker_tasks.py` — `extract_memories_from_conversation`
- `app/services/embedding.py` — `search_similar()`, `find_duplicate_memory()`
- `app/core/config.py` — new settings fields
- `app/routers/chat.py` — conversation/message DB operations pattern
