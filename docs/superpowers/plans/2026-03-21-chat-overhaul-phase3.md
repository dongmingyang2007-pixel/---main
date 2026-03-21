# Chat System Overhaul — Phase 3: Omni Realtime Interrupt Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to interrupt the AI during omni realtime voice by adding server-side handling for the `input.interrupt` message that the client now sends (added in Phase 1).

**Architecture:** Client-side VAD and `input.interrupt` sending already implemented in `useRealtimeVoiceBase.ts` (Phase 1). This phase adds the server-side handler in `realtime_bridge.py` and the WebSocket relay in `realtime.py`.

**Tech Stack:** FastAPI WebSocket, Python async

**Spec:** `docs/superpowers/specs/2026-03-21-chat-system-overhaul-design.md` — Phase 3

**Depends on:** Phase 1 complete (client-side VAD + input.interrupt in useRealtimeVoiceBase)

---

## What's Already Done (Phase 1)

- `useRealtimeVoiceBase.ts` sends `input.interrupt` JSON message when:
  - `enableInterrupt` is true
  - State is `ai_speaking`
  - User speech RMS exceeds threshold for `interruptThresholdMs` (400ms)
- `useRealtimeVoice.ts` wrapper configures: `enableInterrupt: true`, `speechThreshold: 0.015`, `interruptThresholdMs: 400`
- Client handles `interrupt.ack` response (stops playback, clears queue, reverts to listening)

## What's Needed

Server-side handling of `input.interrupt` in the omni realtime WebSocket path.

---

## Task 1: Add input.interrupt handler to realtime_bridge.py

**Files:**
- Modify: `apps/api/app/services/realtime_bridge.py`

- [ ] **Step 1: Read realtime_bridge.py fully**

Understand:
- The `RealtimeSession` class and its state machine
- The `should_interrupt()` method
- The `cancel_response()` method
- How upstream DashScope events are handled in `handle_upstream_event()`
- How client messages are processed

- [ ] **Step 2: Add input.interrupt handling**

In the method that processes client messages (the WebSocket receive loop), add handling for the `input.interrupt` message type:

```python
if msg_type == "input.interrupt":
    if self._ai_speaking:
        await self.cancel_response()
        outgoing.append({"type": "interrupt.ack"})
        logger.info("Client-initiated interrupt acknowledged")
```

This is idempotent with the existing server-side VAD interrupt path — both call `cancel_response()`.

- [ ] **Step 3: Verify the interrupt path in cancel_response()**

Ensure `cancel_response()`:
1. Sends cancellation to DashScope upstream
2. Sets `_ai_speaking = False`
3. Clears any pending audio buffers

- [ ] **Step 4: Run tests**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v --tb=short`

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/realtime_bridge.py
git commit -m "feat: handle client-initiated input.interrupt for omni realtime"
```

---

## Task 2: Wire input.interrupt in realtime router

**Files:**
- Modify: `apps/api/app/routers/realtime.py`

- [ ] **Step 1: Read the /realtime/voice WebSocket handler**

Find where client messages are received and dispatched to the session.

- [ ] **Step 2: Ensure input.interrupt is forwarded to session**

If the router has a message type whitelist or switch statement, add `input.interrupt` to it. If it forwards all JSON messages to the session, verify it reaches the handler added in Task 1.

- [ ] **Step 3: Run tests**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v --tb=short`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/routers/realtime.py
git commit -m "feat: relay input.interrupt through realtime WebSocket router"
```

---

## Task 3: Add test for client-initiated interrupt

**Files:**
- Modify: `apps/api/tests/test_realtime.py`

- [ ] **Step 1: Read existing interrupt tests**

Understand how existing interrupt tests work (if any).

- [ ] **Step 2: Add test for input.interrupt**

```python
async def test_client_interrupt_during_ai_speaking():
    """Client sends input.interrupt while AI is speaking → interrupt.ack returned."""
    session = RealtimeSession(...)
    # Set up session in ai_speaking state
    session._ai_speaking = True

    # Process client input.interrupt message
    outgoing = await session.handle_client_message({"type": "input.interrupt"})

    # Verify interrupt.ack is returned
    assert any(msg["type"] == "interrupt.ack" for msg in outgoing)
    assert not session._ai_speaking

async def test_client_interrupt_when_not_speaking():
    """Client sends input.interrupt while not AI speaking → no-op."""
    session = RealtimeSession(...)
    session._ai_speaking = False

    outgoing = await session.handle_client_message({"type": "input.interrupt"})

    assert not any(msg["type"] == "interrupt.ack" for msg in outgoing)
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && python -m pytest tests/test_realtime.py -v --tb=short`

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/test_realtime.py
git commit -m "test: add client-initiated interrupt tests for omni realtime"
```
