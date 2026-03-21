# Chat System Overhaul — Phase 4: Synthetic Realtime Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix synthetic realtime mode stability — add audio.meta before audio chunks, empty buffer error feedback, unified error signaling, and i18n for all error codes.

**Architecture:** Server-side changes in composed_realtime.py for audio.meta and error feedback. Client-side adaptive threshold and playback MIME handling already done in Phase 1.

**Tech Stack:** FastAPI WebSocket, Python async, next-intl

**Spec:** `docs/superpowers/specs/2026-03-21-chat-system-overhaul-design.md` — Phase 4

**Depends on:** Phase 1 complete (adaptive calibration, audio.meta handling in base hook, playback queue)

---

## What's Already Done (Phase 1)

- `useRealtimeVoiceBase.ts` handles `audio.meta` message — stores `audioMimeRef.current` for blob playback
- Adaptive speech threshold calibration (`speechThreshold: "auto"`) with 2s noise floor sampling
- 15s playback timeout guard
- Blob MIME type used from `audioMimeRef` instead of hardcoded "audio/mpeg"

## What's Needed

Server-side improvements to `composed_realtime.py` and `realtime.py` for better error signaling and audio metadata.

---

## Task 1: Add audio.meta before audio chunks

**Files:**
- Modify: `apps/api/app/services/composed_realtime.py`

- [ ] **Step 1: Read composed_realtime.py fully**

Find where TTS audio chunks are sent via WebSocket (`await ws.send_bytes(audio_chunk)`).

- [ ] **Step 2: Send audio.meta before first audio chunk of each turn**

Before sending the first audio bytes of a turn, send metadata:

```python
if audio_chunk and not audio_meta_sent:
    await ws.send_json({
        "type": "audio.meta",
        "mime": "audio/mpeg",  # TTS output format
        "sample_rate": 24000,
    })
    audio_meta_sent = True
await ws.send_bytes(audio_chunk)
```

Add `audio_meta_sent = False` flag at the start of each turn, reset it per turn.

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/services/composed_realtime.py
git commit -m "feat: send audio.meta before TTS chunks in synthetic realtime"
```

---

## Task 2: Empty buffer and ASR error feedback

**Files:**
- Modify: `apps/api/app/services/composed_realtime.py`

- [ ] **Step 1: Add turn.notice for empty audio buffer**

In `start_turn()`, when `_audio_buffer` is empty, instead of silently returning `(None, False)`:

```python
async def start_turn(self, ws):
    if not self._audio_buffer:
        await ws.send_json({
            "type": "turn.notice",
            "code": "no_audio_input",
            "message": "No audio detected. Please speak louder or check your microphone.",
        })
        return None, False
```

- [ ] **Step 2: Add turn.notice for empty ASR result**

In `_run_turn()`, after ASR returns empty text:

```python
if not user_text.strip():
    await ws.send_json({
        "type": "turn.notice",
        "code": "empty_transcription",
        "message": "No speech recognized. Please try again.",
    })
    return
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/services/composed_realtime.py
git commit -m "feat: add turn.notice for empty audio buffer and ASR result"
```

---

## Task 3: Add i18n keys for synthetic error codes

**Files:**
- Modify: `apps/web/messages/en/console-chat.json`
- Modify: `apps/web/messages/zh/console-chat.json`

- [ ] **Step 1: Add error/notice keys**

English:
```json
{
  "errors.noAudioInput": "No audio detected. Please check your microphone.",
  "errors.emptyTranscription": "No speech recognized. Please try again.",
  "calibrating": "Calibrating microphone..."
}
```

Chinese:
```json
{
  "errors.noAudioInput": "未检测到音频，请检查麦克风。",
  "errors.emptyTranscription": "未识别到语音，请重试。",
  "calibrating": "正在校准麦克风..."
}
```

- [ ] **Step 2: Update RealtimeVoicePanel to map error codes to i18n keys**

In `apps/web/components/console/RealtimeVoicePanel.tsx`, when the `onError` callback fires with a `turn.notice` message, map known error codes to localized strings. The base hook already calls `configRef.current.onError?.(data.message)` for `turn.notice` events. If the message from the server is English-only, consider mapping `code` to i18n key in the `onError` handler:

```typescript
const handleError = useCallback((msg: string) => {
  // The base hook passes through server messages; optionally map codes
  onError(msg);
}, [onError]);
```

For now, passing through the server message is acceptable since i18n mapping can be refined later. The important thing is that error messages are shown to the user (not silently swallowed).

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/ apps/web/components/console/RealtimeVoicePanel.tsx
git commit -m "feat: add i18n keys for synthetic realtime error codes"
```

---

## Task 4: Run tests and verify

- [ ] **Step 1: Backend tests**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v --tb=short`

- [ ] **Step 2: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit if needed**
