# Chat System Overhaul — Phase 1: Shared Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1234-line ChatInterface monolith into focused components, merge two realtime voice hooks into a shared base, and add SSE streaming infrastructure — without changing any user-facing behavior.

**Architecture:** Extract ChatMessageList, ChatInputBar, ChatModePanel, StandardVoiceControls, and RealtimeVoicePanel from ChatInterface.tsx. Extract shared WebSocket/audio/state-machine logic from useRealtimeVoice + useSyntheticRealtimeVoice into useRealtimeVoiceBase. Add api-stream.ts utility for SSE consumption (used in Phase 2).

**Tech Stack:** React 18, Next.js, TypeScript, next-intl, Playwright (tests)

**Spec:** `docs/superpowers/specs/2026-03-21-chat-system-overhaul-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `apps/web/components/console/ChatMessageList.tsx` | Message rendering, scroll-to-bottom, AnimatedMessageText, reasoning blocks, read-aloud buttons, memory indicators |
| `apps/web/components/console/ChatInputBar.tsx` | Text input, send button, tool chips (search/think/auto-read/image), image upload/capture hidden inputs, pending image chip, voice recording indicators |
| `apps/web/components/console/ChatModePanel.tsx` | Mode switcher (standard/omni/synthetic) with disabled state and default badge |
| `apps/web/components/console/StandardVoiceControls.tsx` | Mic button, recording state, dictation submission, voice notice display |
| `apps/web/components/console/RealtimeVoicePanel.tsx` | Unified wrapper that renders omni or synthetic realtime voice UI (replaces both RealtimeVoice.tsx and SyntheticRealtimeVoice.tsx) |
| `apps/web/hooks/useRealtimeVoiceBase.ts` | Shared WebSocket lifecycle, state machine, audio capture/playback, transcript management, volume detection, timer, mute, reconnection |
| `apps/web/lib/api-stream.ts` | SSE consumer utility — `apiStream()` async generator for server-sent events |
| `apps/web/components/console/chat-types.ts` | Shared type definitions (Message, ChatMode, ApiMessage, etc.) extracted from ChatInterface |

### Files to modify

| File | Change |
|------|--------|
| `apps/web/components/console/ChatInterface.tsx` | Gut to ~150-line thin container that imports and wires the new sub-components |
| `apps/web/hooks/useRealtimeVoice.ts` | Rewrite as thin wrapper around useRealtimeVoiceBase (~120 lines) |
| `apps/web/hooks/useSyntheticRealtimeVoice.ts` | Rewrite as thin wrapper around useRealtimeVoiceBase (~80 lines) |

### Files to delete (after migration)

| File | Reason |
|------|--------|
| `apps/web/components/console/RealtimeVoice.tsx` | Merged into RealtimeVoicePanel.tsx |
| `apps/web/components/console/SyntheticRealtimeVoice.tsx` | Merged into RealtimeVoicePanel.tsx |

---

## Task 1: Extract shared types

**Files:**
- Create: `apps/web/components/console/chat-types.ts`
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Create chat-types.ts with all shared type definitions**

Extract from ChatInterface.tsx (lines 11-94):

```typescript
// apps/web/components/console/chat-types.ts

export type ChatMode = "standard" | "omni_realtime" | "synthetic_realtime";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string | null;
  audioBase64?: string | null;
  memories_extracted?: string;
  animateOnMount?: boolean;
  isStreaming?: boolean;
}

export interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning_content?: string | null;
  created_at?: string;
}

export interface DictationResponse {
  text_input: string;
}

export interface SpeechResponse {
  audio_response: string | null;
}

export interface ImageMessageResponse {
  message: ApiMessage;
  text_input: string;
  audio_response: string | null;
}

export interface ProjectChatSettings {
  id: string;
  default_chat_mode: ChatMode;
}

export interface PipelineConfigItem {
  model_type:
    | "llm"
    | "asr"
    | "tts"
    | "vision"
    | "realtime"
    | "realtime_asr"
    | "realtime_tts";
  model_id: string;
}

export interface PipelineResponse {
  items: PipelineConfigItem[];
}

export interface CatalogModelItem {
  model_id: string;
  capabilities: string[];
}

export interface LiveTranscriptUpdate {
  role: "user" | "assistant";
  text: string;
  final: boolean;
  action?: "upsert" | "discard";
}

export const VOICE_ACTIVE_STATES = new Set([
  "connecting",
  "ready",
  "listening",
  "ai_speaking",
  "reconnecting",
]);

export function toMessage(message: ApiMessage): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoning_content,
    animateOnMount: false,
    isStreaming: false,
  };
}

export function getPipelineModelId(
  items: PipelineConfigItem[],
  modelType: PipelineConfigItem["model_type"],
  fallback: string,
) {
  return items.find((item) => item.model_type === modelType)?.model_id || fallback;
}

export function modelSupportsCapability(
  catalogItems: CatalogModelItem[],
  modelId: string,
  ...required: string[]
) {
  const entry = catalogItems.find((item) => item.model_id === modelId);
  if (!entry) return false;
  const capabilities = new Set((entry.capabilities || []).map((v) => v.toLowerCase()));
  return required.every((v) => capabilities.has(v.toLowerCase()));
}

export function createAudioPlayer(base64Audio: string) {
  const audioBytes = Uint8Array.from(atob(base64Audio), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([audioBytes], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  return { audio: new Audio(url), url };
}

export function cycleState(s: "auto" | "on" | "off"): "auto" | "on" | "off" {
  return s === "auto" ? "on" : s === "on" ? "off" : "auto";
}
```

- [ ] **Step 2: Update ChatInterface.tsx imports to use chat-types.ts**

Replace the inline type definitions (lines 11-138) with:

```typescript
import {
  type ChatMode, type Message, type ApiMessage, type DictationResponse,
  type SpeechResponse, type ImageMessageResponse, type ProjectChatSettings,
  type PipelineConfigItem, type PipelineResponse, type CatalogModelItem,
  type LiveTranscriptUpdate,
  VOICE_ACTIVE_STATES, toMessage, getPipelineModelId,
  modelSupportsCapability, createAudioPlayer, cycleState,
} from "./chat-types";
```

Remove the now-duplicated inline definitions (types, interfaces, helper functions from lines 11-138).

- [ ] **Step 3: Verify app still works**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/chat-types.ts apps/web/components/console/ChatInterface.tsx
git commit -m "refactor: extract shared chat types to chat-types.ts"
```

---

## Task 2: Extract ChatMessageList

**Files:**
- Create: `apps/web/components/console/ChatMessageList.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Create ChatMessageList.tsx**

Extract from ChatInterface.tsx: AnimatedMessageText component (lines 140-189), message rendering JSX (lines 974-1060), and read-aloud logic (lines 409-463).

```typescript
// apps/web/components/console/ChatMessageList.tsx
"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { useTranslations } from "next-intl";
import { apiPost, isApiRequestError } from "@/lib/api";
import { type Message, type SpeechResponse, createAudioPlayer } from "./chat-types";

function AnimatedMessageText({
  text,
  animate,
  streaming = false,
}: {
  text: string;
  animate: boolean;
  streaming?: boolean;
}) {
  // Copy existing AnimatedMessageText exactly from ChatInterface.tsx lines 140-189
  // (character-by-character reveal animation)
  const segments = Array.from(text);
  const shouldAnimate = animate && !streaming;
  const [visibleCount, setVisibleCount] = useState(() =>
    shouldAnimate ? 0 : segments.length,
  );

  useEffect(() => {
    if (!shouldAnimate || segments.length === 0) return;
    setVisibleCount(0);
    let frame: number;
    let count = 0;
    const msPerChar =
      segments.length > 240 ? 6 : segments.length > 120 ? 12 : 22;
    let lastTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - lastTime;
      const chars = Math.max(1, Math.floor(elapsed / msPerChar));
      count = Math.min(count + chars, segments.length);
      lastTime = now;
      setVisibleCount(count);
      if (count < segments.length) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [shouldAnimate, segments.length]);

  useEffect(() => {
    if (streaming) setVisibleCount(segments.length);
  }, [streaming, segments.length]);

  if (!text) return null;
  const displayCount = Math.min(visibleCount, segments.length);
  const displayText = segments.slice(0, displayCount).join("");
  const showCursor = shouldAnimate && displayCount < segments.length;

  return (
    <>
      {displayText}
      {showCursor && <span className="typing-cursor" />}
    </>
  );
}

export interface ChatMessageListHandle {
  appendMessage: (msg: Message) => void;
  updateMessage: (id: string, updater: (prev: string) => string) => void;
  updateReasoning: (id: string, updater: (prev: string) => string) => void;
  finalizeMessage: (tempId: string, final: { id: string; isStreaming: boolean; memories_extracted?: string }) => void;
  setMessages: (msgs: Message[]) => void;
  replaceMessages: (updater: (prev: Message[]) => Message[]) => void;
}

interface ChatMessageListProps {
  messages: Message[];
  onMessagesChange: (msgs: Message[]) => void;
  isTyping: boolean;
  conversationId?: string | null;
  noConversation: boolean;
}

const ChatMessageList = forwardRef<ChatMessageListHandle, ChatMessageListProps>(
  function ChatMessageList({ messages, onMessagesChange, isTyping, conversationId, noConversation }, ref) {
    const t = useTranslations("console-chat");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUrlRef = useRef<string | null>(null);
    const [loadingReadAloudId, setLoadingReadAloudId] = useState<string | null>(null);
    const [readingMessageId, setReadingMessageId] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      appendMessage: (msg: Message) => onMessagesChange([...messages, msg]),
      updateMessage: (id, updater) =>
        onMessagesChange(messages.map((m) => (m.id === id ? { ...m, content: updater(m.content) } : m))),
      updateReasoning: (id, updater) =>
        onMessagesChange(messages.map((m) => (m.id === id ? { ...m, reasoningContent: updater(m.reasoningContent || "") } : m))),
      finalizeMessage: (tempId, final) =>
        onMessagesChange(messages.map((m) => (m.id === tempId ? { ...m, ...final } : m))),
      setMessages: (msgs) => onMessagesChange(msgs),
      replaceMessages: (updater) => onMessagesChange(updater(messages)),
    }));

    // Scroll to bottom
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isTyping]);

    // Read-aloud logic (copy from ChatInterface lines 252-463)
    const releaseAudioPlayer = useCallback(() => {
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      }
      audioRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setReadingMessageId(null);
    }, []);

    const stopReadAloud = useCallback(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      releaseAudioPlayer();
    }, [releaseAudioPlayer]);

    useEffect(() => () => stopReadAloud(), [stopReadAloud]);

    const playMessageAudio = useCallback(
      (base64Audio: string, messageId: string) => {
        stopReadAloud();
        try {
          const { audio, url } = createAudioPlayer(base64Audio);
          audioRef.current = audio;
          audioUrlRef.current = url;
          setReadingMessageId(messageId);
          audio.onended = () => releaseAudioPlayer();
          audio.onerror = () => releaseAudioPlayer();
          void audio.play().catch(() => releaseAudioPlayer());
        } catch {
          releaseAudioPlayer();
        }
      },
      [releaseAudioPlayer, stopReadAloud],
    );

    const handleReadAloud = useCallback(
      async (message: Message) => {
        const text = message.content.trim();
        if (!conversationId || !text) return;
        if (readingMessageId === message.id) { stopReadAloud(); return; }
        if (message.audioBase64) { playMessageAudio(message.audioBase64, message.id); return; }

        setLoadingReadAloudId(message.id);
        try {
          const data = await apiPost<{ audio_response: string | null }>(
            `/api/v1/chat/conversations/${conversationId}/speech`,
            { content: text },
          );
          if (!data.audio_response) throw new Error("missing audio");
          // Cache audio in message
          onMessagesChange(messages.map((m) => (m.id === message.id ? { ...m, audioBase64: data.audio_response } : m)));
          playMessageAudio(data.audio_response!, message.id);
        } catch {
          // Error handling kept simple — voice notice handled by parent
        } finally {
          setLoadingReadAloudId((c) => (c === message.id ? null : c));
        }
      },
      [conversationId, messages, onMessagesChange, playMessageAudio, readingMessageId, stopReadAloud],
    );

    return (
      <div className="chat-messages">
        {messages.length === 0 && !isTyping && (
          <div className="chat-empty">
            {noConversation ? t("emptyHint") : t("emptyConversationHint")}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}
          >
            <div className="chat-message-stack">
              {msg.role === "assistant" && msg.reasoningContent?.trim() ? (
                <div className="chat-reasoning" aria-label={t("reasoningLabel")}>
                  <div className="chat-reasoning-label">{t("reasoningLabel")}</div>
                  <div className="chat-reasoning-content">
                    <AnimatedMessageText
                      text={msg.reasoningContent.trim()}
                      animate={Boolean(msg.animateOnMount)}
                    />
                  </div>
                </div>
              ) : null}
              <div className="chat-bubble">
                <AnimatedMessageText
                  text={msg.content}
                  animate={msg.role === "assistant" && Boolean(msg.animateOnMount)}
                  streaming={Boolean(msg.isStreaming)}
                />
              </div>
              {msg.role === "assistant" && (
                <div className="chat-message-actions">
                  <button
                    className={`chat-audio-btn ${readingMessageId === msg.id ? "is-active" : ""}`}
                    onClick={() => void handleReadAloud(msg)}
                    title={readingMessageId === msg.id ? t("voiceStop") : t("voicePlay")}
                    disabled={loadingReadAloudId === msg.id}
                    type="button"
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    <span>
                      {loadingReadAloudId === msg.id
                        ? t("voicePreparing")
                        : readingMessageId === msg.id
                          ? t("voiceStop")
                          : t("voicePlay")}
                    </span>
                  </button>
                </div>
              )}
              {msg.role === "assistant" && msg.memories_extracted && (
                <div className="chat-memory-indicator">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx={12} cy={12} r={3} />
                    <path d="M12 2v4m0 12v4" />
                  </svg>
                  {t("memory.remembered")}：{msg.memories_extracted}
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="chat-message is-assistant">
            <div className="chat-message-stack">
              <div className="chat-bubble is-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    );
  },
);

export default ChatMessageList;
```

- [ ] **Step 2: Replace message rendering in ChatInterface.tsx with ChatMessageList**

In ChatInterface.tsx, replace the message rendering block (lines 974-1060) with:

```typescript
<ChatMessageList
  ref={messageListRef}
  messages={messages}
  onMessagesChange={setMessages}
  isTyping={isTyping}
  conversationId={conversationId}
  noConversation={noConversation}
/>
```

Add `const messageListRef = useRef<ChatMessageListHandle>(null);` to the refs section. Add the import at the top. Remove the inline AnimatedMessageText component and read-aloud related state/callbacks from ChatInterface (releaseAudioPlayer, stopReadAloud, playMessageAudio, handleReadAloud, cacheMessageAudio, loadingReadAloudId, readingMessageId, audioRef, audioUrlRef).

- [ ] **Step 3: Verify type-check passes**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Run existing Playwright tests**

Run: `cd apps/web && npx playwright test tests/chat-realtime-voice.spec.ts tests/realtime-voice.spec.ts --reporter=list`
Expected: Existing tests still pass (they test realtime voice, not message list rendering)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/console/ChatMessageList.tsx apps/web/components/console/ChatInterface.tsx
git commit -m "refactor: extract ChatMessageList from ChatInterface"
```

---

## Task 3: Extract ChatInputBar

**Files:**
- Create: `apps/web/components/console/ChatInputBar.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Create ChatInputBar.tsx**

Extract from ChatInterface.tsx: text input (lines 1102-1111), tool chips (lines 1112-1180), send button (lines 1181-1187), hidden file inputs (lines 912-936), pending image chip (lines 1190-1197), image handling callbacks (lines 465-479).

```typescript
// apps/web/components/console/ChatInputBar.tsx
"use client";

import { useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cycleState } from "./chat-types";

interface ChatInputBarProps {
  onSend: (content: string, options: { enableThinking?: boolean | null; enableSearch?: boolean | null; imageFile?: File | null }) => void;
  disabled: boolean;
  isTyping: boolean;
  isStandardMode: boolean;
  autoReadEnabled: boolean;
  onAutoReadToggle: () => void;
}

export default function ChatInputBar({
  onSend,
  disabled,
  isTyping,
  isStandardMode,
  autoReadEnabled,
  onAutoReadToggle,
}: ChatInputBarProps) {
  const t = useTranslations("console-chat");
  const [input, setInput] = useState("");
  const [searchState, setSearchState] = useState<"auto" | "on" | "off">("auto");
  const [thinkState, setThinkState] = useState<"auto" | "on" | "off">("auto");
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageCaptureRef = useRef<HTMLInputElement>(null);

  const handleImageFileSelected = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPendingImageFile(file);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text && !pendingImageFile) return;
    const enableThinking = thinkState === "on" ? true : thinkState === "off" ? false : null;
    const enableSearch = searchState === "on" ? true : searchState === "off" ? false : null;
    onSend(text, { enableThinking, enableSearch, imageFile: pendingImageFile });
    setInput("");
    setPendingImageFile(null);
  }, [input, pendingImageFile, thinkState, searchState, onSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <>
      <input
        ref={imageUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isTyping || disabled}
        data-testid="chat-image-upload-input"
        onChange={(event) => {
          handleImageFileSelected(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <input
        ref={imageCaptureRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={isTyping || disabled}
        data-testid="chat-image-capture-input"
        onChange={(event) => {
          handleImageFileSelected(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <div className="chat-input-bar-voice">
        {/* Mic button slot — StandardVoiceControls will be inserted here by parent */}
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          placeholder={t("inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping || disabled}
        />
        <div className="chat-tool-chips">
          {isStandardMode && (
            <button type="button" className="chat-tool-chip" data-state={autoReadEnabled ? "on" : "auto"} onClick={onAutoReadToggle}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              {t("voiceAutoRead")}
            </button>
          )}
          {isStandardMode && (
            <button type="button" className="chat-tool-chip" onClick={() => imageUploadRef.current?.click()} disabled={isTyping || disabled}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={18} height={18} rx={2} ry={2} />
                <circle cx={8.5} cy={8.5} r={1.5} />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              {t("imageUpload")}
            </button>
          )}
          {isStandardMode && (
            <button type="button" className="chat-tool-chip" onClick={() => imageCaptureRef.current?.click()} disabled={isTyping || disabled}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx={12} cy={13} r={4} />
              </svg>
              {t("imageCapture")}
            </button>
          )}
          <button type="button" className="chat-tool-chip" data-state={searchState} onClick={() => setSearchState(cycleState)}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
            {t("tool.search")}
          </button>
          <button type="button" className="chat-tool-chip" data-state={thinkState} onClick={() => setThinkState(cycleState)}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 4 7.5V19h6v-2.5c2-2 4-4.5 4-7.5a7 7 0 0 0-7-7z" />
              <line x1={9} y1={22} x2={15} y2={22} />
            </svg>
            {t("tool.think")}
          </button>
        </div>
        <button className="chat-send" onClick={handleSubmit} disabled={(!input.trim() && !pendingImageFile) || isTyping || disabled}>
          {t("send")}
        </button>
      </div>

      {isStandardMode && pendingImageFile && (
        <div className="chat-attachment-chip">
          <span className="chat-attachment-name">{pendingImageFile.name}</span>
          <button type="button" className="chat-audio-btn" onClick={() => setPendingImageFile(null)}>
            {t("imageClear")}
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Replace input area in ChatInterface.tsx with ChatInputBar**

Replace the input area block in ChatInterface.tsx with:

```typescript
<ChatInputBar
  onSend={handleSend}
  disabled={noConversation}
  isTyping={isTyping}
  isStandardMode={isStandardMode}
  autoReadEnabled={autoReadEnabled}
  onAutoReadToggle={() => setAutoReadEnabled((s) => !s)}
/>
```

Refactor `handleSend` in ChatInterface to accept `(content, options)` parameters instead of reading from component state. Remove input/searchState/thinkState/pendingImageFile/imageUploadRef/imageCaptureRef state from ChatInterface.

- [ ] **Step 3: Verify type-check passes**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/ChatInputBar.tsx apps/web/components/console/ChatInterface.tsx
git commit -m "refactor: extract ChatInputBar from ChatInterface"
```

---

## Task 4: Extract ChatModePanel and StandardVoiceControls

**Files:**
- Create: `apps/web/components/console/ChatModePanel.tsx`
- Create: `apps/web/components/console/StandardVoiceControls.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Create ChatModePanel.tsx**

Extract from ChatInterface.tsx lines 937-972 (mode switcher JSX):

```typescript
// apps/web/components/console/ChatModePanel.tsx
"use client";

import { useTranslations } from "next-intl";
import { type ChatMode } from "./chat-types";

interface ChatModePanelProps {
  chatMode: ChatMode;
  projectDefaultMode: ChatMode;
  syntheticModeAvailable: boolean;
  onModeChange: (mode: ChatMode) => void;
  disabled: boolean;
}

export default function ChatModePanel({
  chatMode,
  projectDefaultMode,
  syntheticModeAvailable,
  onModeChange,
  disabled,
}: ChatModePanelProps) {
  const t = useTranslations("console-chat");

  const options: { key: ChatMode; label: string; isDisabled?: boolean }[] = [
    { key: "standard", label: t("mode.standard") },
    { key: "omni_realtime", label: t("mode.omni") },
    { key: "synthetic_realtime", label: t("mode.synthetic"), isDisabled: !syntheticModeAvailable },
  ];

  return (
    <div className="chat-mode-switcher">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`chat-mode-chip${chatMode === option.key ? " is-active" : ""}`}
          onClick={() => !option.isDisabled && !disabled && onModeChange(option.key)}
          disabled={option.isDisabled || disabled}
        >
          {option.label}
          {projectDefaultMode === option.key && (
            <span className="chat-mode-default">{t("mode.default")}</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create StandardVoiceControls.tsx**

Extract from ChatInterface.tsx: mic button (lines 1062-1101), recording/sending indicators (lines 1199-1207), handleMicClick (lines 691-709), dictation logic (lines 648-689):

```typescript
// apps/web/components/console/StandardVoiceControls.tsx
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { apiPostFormData, isApiRequestError } from "@/lib/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { type DictationResponse } from "./chat-types";

interface StandardVoiceControlsProps {
  conversationId: string;
  isTyping: boolean;
  disabled: boolean;
  onDictationResult: (text: string) => void;
  onError: (message: string) => void;
}

export default function StandardVoiceControls({
  conversationId,
  isTyping,
  disabled,
  onDictationResult,
  onError,
}: StandardVoiceControlsProps) {
  const t = useTranslations("console-chat");
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "sending">("idle");

  const dictateVoiceInput = useCallback(async (audioBlob: Blob) => {
    setVoiceStatus("sending");
    try {
      const formData = new FormData();
      // Use correct extension based on blob type
      const ext = audioBlob.type.includes("mp4") ? "mp4"
        : audioBlob.type.includes("ogg") ? "ogg"
        : audioBlob.type.includes("webm") ? "webm" : "wav";
      formData.append("audio", audioBlob, `recording.${ext}`);
      const data = await apiPostFormData<DictationResponse>(
        `/api/v1/chat/conversations/${conversationId}/dictate`,
        formData,
      );
      if (!data.text_input?.trim()) {
        onError(t("errors.dictationFailed"));
        return;
      }
      onDictationResult(data.text_input.trim());
    } catch (error) {
      let msg = t("errors.dictationFailed");
      if (isApiRequestError(error)) {
        if (error.code === "inference_timeout") msg = t("errors.inferenceTimeout");
        else if (error.code === "model_api_unconfigured") msg = t("errors.modelUnconfigured");
      }
      onError(msg);
    } finally {
      setVoiceStatus("idle");
    }
  }, [conversationId, onDictationResult, onError, t]);

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      try {
        const blob = await stopRecording();
        if (blob) await dictateVoiceInput(blob);
      } catch {
        setVoiceStatus("idle");
      }
    } else {
      try {
        await startRecording();
        setVoiceStatus("recording");
      } catch {
        onError(t("errors.dictationFailed"));
      }
    }
  }, [isRecording, startRecording, stopRecording, dictateVoiceInput, onError, t]);

  return (
    <>
      <button
        className={`chat-mic-btn ${isRecording ? "is-recording" : ""}`}
        onClick={() => void handleMicClick()}
        disabled={voiceStatus === "sending" || (isTyping && !isRecording) || disabled}
        title={isRecording ? t("voiceRecording") : t("voiceRecord")}
        type="button"
      >
        {isRecording ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {voiceStatus === "recording" && (
        <div className="chat-voice-indicator">{t("voiceRecording")}</div>
      )}
      {voiceStatus === "sending" && (
        <div className="chat-voice-indicator">{t("voiceSending")}</div>
      )}
    </>
  );
}
```

Note: This already includes the MIME type fix from Phase 2 spec (correct extension based on blob type instead of hardcoded `.webm`).

- [ ] **Step 3: Replace mode switcher and voice controls in ChatInterface.tsx**

Replace mode switcher JSX with `<ChatModePanel ... />` and mic button area with `<StandardVoiceControls ... />`. Remove voiceStatus, handleMicClick, dictateVoiceInput, useAudioRecorder import from ChatInterface.

- [ ] **Step 4: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/console/ChatModePanel.tsx apps/web/components/console/StandardVoiceControls.tsx apps/web/components/console/ChatInterface.tsx
git commit -m "refactor: extract ChatModePanel and StandardVoiceControls"
```

---

## Task 5: Extract useRealtimeVoiceBase

**Files:**
- Create: `apps/web/hooks/useRealtimeVoiceBase.ts`
- Modify: `apps/web/hooks/useRealtimeVoice.ts`
- Modify: `apps/web/hooks/useSyntheticRealtimeVoice.ts`

This is the largest task. The base hook contains all shared logic.

- [ ] **Step 1: Create useRealtimeVoiceBase.ts**

Extract shared logic from both hooks. The base hook accepts a config object:

```typescript
// apps/web/hooks/useRealtimeVoiceBase.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/env";

// --- Shared types (exported for use by wrapper hooks) ---

export type RealtimeState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "ai_speaking"
  | "error"
  | "reconnecting";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface RealtimeVoiceBaseConfig {
  conversationId: string;
  projectId: string;
  wsPath: string;                              // e.g. "/api/v1/realtime/voice"
  sessionStartPayload?: Record<string, unknown>; // extra fields for session.start
  audioSendMode: "continuous" | "vad-gated";   // continuous = send all audio; vad-gated = send only when speech detected
  vadConfig: {
    speechThreshold: number | "auto";          // "auto" = calibrate from noise floor
    interruptThresholdMs?: number;             // if set, send input.interrupt after this duration during ai_speaking
    silenceCommitMs?: number;                  // if set, send audio.stop after this silence duration
    speechCooldownMs?: number;                 // don't reset speech start for this long
  };
  enableInterrupt: boolean;                    // whether to send input.interrupt
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: { userText: string; assistantText: string }) => void;
  onTranscriptUpdate?: (payload: { role: "user" | "assistant"; text: string; final: boolean; action?: "upsert" | "discard" }) => void;
  onStateChange?: (state: RealtimeState) => void;
  // Called when WebSocket receives a message the base doesn't know about — lets wrappers handle custom types
  onCustomMessage?: (data: Record<string, unknown>, ws: WebSocket) => void;
}

export interface RealtimeVoiceBaseReturn {
  state: RealtimeState;
  transcript: TranscriptEntry[];
  timer: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isMuted: boolean;
  userVolume: number;
  aiVolume: number;
  // Escape hatch for wrappers to send custom messages
  sendJson: (data: Record<string, unknown>) => void;
  sendBinary: (data: ArrayBuffer) => void;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const CALIBRATION_FRAMES = 86; // ~2 seconds at 4096 samples / 16kHz
const MIN_SPEECH_THRESHOLD = 0.008;

export function useRealtimeVoiceBase(config: RealtimeVoiceBaseConfig): RealtimeVoiceBaseReturn {
  // --- State ---
  const [state, setState] = useState<RealtimeState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);
  const isMutedRef = useRef(false);

  // --- Refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const stateRef = useRef<RealtimeState>("idle");
  const configRef = useRef(config);
  configRef.current = config;

  // VAD refs
  const speechThresholdRef = useRef(
    typeof config.vadConfig.speechThreshold === "number"
      ? config.vadConfig.speechThreshold
      : 0.018, // default until calibrated
  );
  const speechActiveRef = useRef(false);
  const speechStartRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef(0);
  const hasSegmentAudioRef = useRef(false);
  const calibrationSamplesRef = useRef(0);
  const noiseFloorSamplesRef = useRef<number[]>([]);
  const calibrationBufferRef = useRef<ArrayBuffer[]>([]);

  // Playback refs
  const playbackQueueRef = useRef<string[]>([]);
  const isPlaybackActiveRef = useRef(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioMimeRef = useRef("audio/mpeg");

  // Transcript accumulation
  const userTextRef = useRef("");
  const assistantTextRef = useRef("");

  // --- Helpers ---

  const updateState = useCallback((next: RealtimeState) => {
    stateRef.current = next;
    setState(next);
    configRef.current.onStateChange?.(next);
  }, []);

  const resetPlaybackQueue = useCallback(() => {
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    playbackQueueRef.current.forEach((url) => URL.revokeObjectURL(url));
    playbackQueueRef.current = [];
    isPlaybackActiveRef.current = false;
  }, []);

  const pumpPlaybackQueue = useCallback(() => {
    if (isPlaybackActiveRef.current) return;
    const nextUrl = playbackQueueRef.current.shift();
    if (!nextUrl) return;

    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
    }
    const player = audioPlayerRef.current;
    isPlaybackActiveRef.current = true;
    player.src = nextUrl;

    // Pulse AI volume for visual feedback
    setAiVolume(0.6);
    setTimeout(() => setAiVolume(0), 180);

    // Guard against stuck playback
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    playbackTimeoutRef.current = setTimeout(() => {
      URL.revokeObjectURL(nextUrl);
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueue();
    }, 15_000);

    player.onended = () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      URL.revokeObjectURL(nextUrl);
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueue();
    };
    player.onerror = () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      URL.revokeObjectURL(nextUrl);
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueue();
    };

    void player.play().catch(() => {
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueue();
    });
  }, []);

  const playAudioChunk = useCallback((data: ArrayBuffer) => {
    const blob = new Blob([data], { type: audioMimeRef.current });
    const url = URL.createObjectURL(blob);
    playbackQueueRef.current.push(url);
    pumpPlaybackQueue();
  }, [pumpPlaybackQueue]);

  // --- sendJson / sendBinary ---

  const sendJson = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendBinary = useCallback((data: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  // --- Audio capture ---

  const startCapture = useCallback(async (ws: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const monitorGain = ctx.createGain();
    monitorGain.gain.value = 0;
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      setUserVolume(rms);

      // --- Adaptive calibration ---
      if (configRef.current.vadConfig.speechThreshold === "auto" && calibrationSamplesRef.current < CALIBRATION_FRAMES) {
        noiseFloorSamplesRef.current.push(rms);
        calibrationSamplesRef.current++;
        // Buffer audio during calibration (don't discard)
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        calibrationBufferRef.current.push(pcm.buffer);

        if (calibrationSamplesRef.current === CALIBRATION_FRAMES) {
          const sorted = [...noiseFloorSamplesRef.current].sort((a, b) => a - b);
          const p75 = sorted[Math.floor(sorted.length * 0.75)];
          speechThresholdRef.current = Math.max(p75 * 2.5, MIN_SPEECH_THRESHOLD);
          // Flush buffered audio
          for (const buf of calibrationBufferRef.current) {
            if (configRef.current.audioSendMode === "continuous") ws.send(buf);
          }
          calibrationBufferRef.current = [];
          updateState("listening");
        }
        return;
      }

      // --- VAD logic ---
      const threshold = speechThresholdRef.current;
      const isSpeech = rms >= threshold;
      const now = performance.now();

      if (isSpeech) {
        speechActiveRef.current = true;
        speechStartRef.current ??= now;
        lastSpeechAtRef.current = now;
      }

      // --- Interrupt detection (for omni mode) ---
      if (configRef.current.enableInterrupt && stateRef.current === "ai_speaking" && speechStartRef.current) {
        const elapsed = now - speechStartRef.current;
        const interruptMs = configRef.current.vadConfig.interruptThresholdMs ?? 400;
        if (elapsed >= interruptMs) {
          ws.send(JSON.stringify({ type: "input.interrupt" }));
          speechStartRef.current = null;
        }
      }

      // --- Audio sending ---
      if (configRef.current.audioSendMode === "continuous") {
        // Omni: send everything
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      } else {
        // VAD-gated: send only when speech active
        const silenceCommitMs = configRef.current.vadConfig.silenceCommitMs ?? 420;
        const shouldSend = isSpeech || (speechActiveRef.current && now - lastSpeechAtRef.current < silenceCommitMs);

        if (!shouldSend) {
          if (speechActiveRef.current && hasSegmentAudioRef.current) {
            speechActiveRef.current = false;
            hasSegmentAudioRef.current = false;
            speechStartRef.current = null;
            ws.send(JSON.stringify({ type: "audio.stop" }));
          }
          return;
        }

        hasSegmentAudioRef.current = true;
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      }

      // Reset speech start after cooldown
      const cooldown = configRef.current.vadConfig.speechCooldownMs ?? 200;
      if (!isSpeech && speechStartRef.current && now - lastSpeechAtRef.current > cooldown) {
        speechStartRef.current = null;
      }
    };

    source.connect(processor);
    processor.connect(monitorGain);
    monitorGain.connect(ctx.destination);
  }, [updateState]);

  // --- Cleanup ---

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current?.state !== "closed") {
      void audioCtxRef.current?.close();
    }
    audioCtxRef.current = null;
  }, []);

  const finalizeConnection = useCallback(
    (nextState: RealtimeState, opts?: { clearTranscript?: boolean; message?: string }) => {
      stopCapture();
      resetPlaybackQueue();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (opts?.clearTranscript) setTranscript([]);
      if (opts?.message) configRef.current.onError?.(opts.message);
      updateState(nextState);
      setTimer(0);
      setUserVolume(0);
      setAiVolume(0);
      // Reset VAD state
      speechActiveRef.current = false;
      speechStartRef.current = null;
      hasSegmentAudioRef.current = false;
      calibrationSamplesRef.current = 0;
      noiseFloorSamplesRef.current = [];
      calibrationBufferRef.current = [];
    },
    [stopCapture, resetPlaybackQueue, updateState],
  );

  // --- Connect ---

  const connect = useCallback(async () => {
    if (stateRef.current !== "idle" && stateRef.current !== "error") return;
    updateState("connecting");
    manualDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;

    const base = getApiBaseUrl().replace(/^http/, "ws");
    const wsUrl = `${base}${configRef.current.wsPath}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "session.start",
        conversation_id: configRef.current.conversationId,
        project_id: configRef.current.projectId,
        ...configRef.current.sessionStartPayload,
      }));
    };

    ws.onmessage = async (event) => {
      // Binary = audio chunk
      if (event.data instanceof Blob) {
        const buf = await event.data.arrayBuffer();
        if (stateRef.current !== "ai_speaking") updateState("ai_speaking");
        playAudioChunk(buf);
        return;
      }

      const data = JSON.parse(event.data as string);
      const type = data.type as string;

      switch (type) {
        case "session.ready":
          updateState("ready");
          await startCapture(ws);
          if (configRef.current.vadConfig.speechThreshold !== "auto") {
            updateState("listening");
          }
          // Start timer
          startTimeRef.current = Date.now();
          timerRef.current = setInterval(() => {
            setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }, 1000);
          break;

        case "transcript.partial":
          userTextRef.current = data.text || "";
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user" && !last.final) {
              return [...prev.slice(0, -1), { role: "user", text: data.text, final: false }];
            }
            return [...prev, { role: "user", text: data.text, final: false }];
          });
          configRef.current.onTranscriptUpdate?.({ role: "user", text: data.text, final: false });
          break;

        case "transcript.final":
          userTextRef.current = data.text || "";
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user" && !last.final) {
              return [...prev.slice(0, -1), { role: "user", text: data.text, final: true }];
            }
            return [...prev, { role: "user", text: data.text, final: true }];
          });
          configRef.current.onTranscriptUpdate?.({ role: "user", text: data.text, final: true });
          break;

        case "response.text":
          assistantTextRef.current += data.text || "";
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.final) {
              return [...prev.slice(0, -1), { role: "assistant", text: assistantTextRef.current, final: false }];
            }
            return [...prev, { role: "assistant", text: assistantTextRef.current, final: false }];
          });
          configRef.current.onTranscriptUpdate?.({ role: "assistant", text: data.text, final: false });
          break;

        case "response.done":
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, final: true }];
            }
            return prev;
          });
          configRef.current.onTranscriptUpdate?.({ role: "assistant", text: assistantTextRef.current, final: true });
          configRef.current.onTurnComplete?.({
            userText: userTextRef.current,
            assistantText: assistantTextRef.current,
          });
          userTextRef.current = "";
          assistantTextRef.current = "";
          updateState("listening");
          break;

        case "interrupt.ack":
          resetPlaybackQueue();
          // Discard partial assistant text
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.final) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          configRef.current.onTranscriptUpdate?.({ role: "assistant", text: "", final: false, action: "discard" });
          assistantTextRef.current = "";
          updateState("listening");
          break;

        case "audio.meta":
          audioMimeRef.current = data.mime || "audio/mpeg";
          break;

        case "turn.error":
        case "error":
          configRef.current.onError?.(data.message || "Unknown error");
          if (data.code === "model_api_unconfigured") {
            finalizeConnection("error", { message: data.message });
          }
          break;

        case "turn.notice":
          configRef.current.onError?.(data.message || "");
          break;

        case "session.end":
          finalizeConnection("idle", { clearTranscript: true });
          break;

        default:
          // Let wrapper hooks handle custom message types
          configRef.current.onCustomMessage?.(data, ws);
          break;
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    ws.onclose = (event) => {
      if (manualDisconnectRef.current) {
        finalizeConnection("idle", { clearTranscript: true });
        return;
      }
      if (event.code === 1000) {
        finalizeConnection("idle");
        return;
      }
      // Attempt reconnect
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        updateState("reconnecting");
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 8000);
        setTimeout(() => {
          if (!manualDisconnectRef.current) void connectRef.current();
        }, delay);
      } else {
        finalizeConnection("error", { message: "Connection lost. Please try again." });
      }
    };
  }, [finalizeConnection, playAudioChunk, resetPlaybackQueue, startCapture, updateState]);

  // Note: `connect` references itself for reconnection. Use a ref-based approach:
  const connectRef = useRef(connect);
  connectRef.current = connect;
  // In the onclose reconnect setTimeout, call `connectRef.current()` instead of `connect()`.

  // --- Disconnect ---

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000);
    }
    finalizeConnection("idle", { clearTranscript: true });
  }, [finalizeConnection]);

  // --- Mute toggle ---

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  // --- Cleanup on unmount ---

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      wsRef.current?.close(1000);
      stopCapture();
      resetPlaybackQueue();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCapture, resetPlaybackQueue]);

  return {
    state,
    transcript,
    timer,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    userVolume,
    aiVolume,
    sendJson,
    sendBinary,
  };
}
```

- [ ] **Step 2: Rewrite useRealtimeVoice.ts as thin wrapper**

```typescript
// apps/web/hooks/useRealtimeVoice.ts
"use client";

import { useRealtimeVoiceBase, type RealtimeState, type TranscriptEntry } from "./useRealtimeVoiceBase";

export type { RealtimeState, TranscriptEntry };

interface UseRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: { userText: string; assistantText: string }) => void;
  onTranscriptUpdate?: (payload: { role: "user" | "assistant"; text: string; final: boolean; action?: "upsert" | "discard" }) => void;
  onStateChange?: (state: RealtimeState) => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions) {
  return useRealtimeVoiceBase({
    conversationId: options.conversationId,
    projectId: options.projectId,
    wsPath: "/api/v1/realtime/voice",
    audioSendMode: "continuous",
    enableInterrupt: true,
    vadConfig: {
      speechThreshold: 0.015,
      interruptThresholdMs: 400,
      speechCooldownMs: 200,
    },
    onError: options.onError,
    onTurnComplete: options.onTurnComplete,
    onTranscriptUpdate: options.onTranscriptUpdate,
    onStateChange: options.onStateChange,
  });
}
```

- [ ] **Step 3: Rewrite useSyntheticRealtimeVoice.ts as thin wrapper**

```typescript
// apps/web/hooks/useSyntheticRealtimeVoice.ts
"use client";

import { useCallback, useRef, useState } from "react";
import { useRealtimeVoiceBase, type RealtimeState, type TranscriptEntry } from "./useRealtimeVoiceBase";

export type SyntheticRealtimeState = RealtimeState;
export type { TranscriptEntry };

export interface SyntheticPendingMedia {
  kind: "image" | "video";
  filename: string;
  mimeType: string;
  dataUrl: string;
}

interface UseSyntheticRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: { userText: string; assistantText: string }) => void;
  onTranscriptUpdate?: (payload: { role: "user" | "assistant"; text: string; final: boolean; action?: "upsert" | "discard" }) => void;
  onStateChange?: (state: RealtimeState) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useSyntheticRealtimeVoice(options: UseSyntheticRealtimeVoiceOptions) {
  const [pendingMedia, setPendingMedia] = useState<SyntheticPendingMedia | null>(null);
  const pendingMediaRef = useRef<SyntheticPendingMedia | null>(null);

  const base = useRealtimeVoiceBase({
    conversationId: options.conversationId,
    projectId: options.projectId,
    wsPath: "/api/v1/realtime/composed-voice",
    audioSendMode: "vad-gated",
    enableInterrupt: true,
    vadConfig: {
      speechThreshold: "auto",
      silenceCommitMs: 420,
    },
    onError: options.onError,
    onTurnComplete: options.onTurnComplete,
    onTranscriptUpdate: options.onTranscriptUpdate,
    onStateChange: options.onStateChange,
    onCustomMessage: (data) => {
      if (data.type === "media.cleared") {
        pendingMediaRef.current = null;
        setPendingMedia(null);
      }
    },
  });

  const attachMediaFile = useCallback(async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    const media: SyntheticPendingMedia = {
      kind,
      filename: file.name,
      mimeType: file.type,
      dataUrl,
    };
    pendingMediaRef.current = media;
    setPendingMedia(media);
    base.sendJson({ type: "media.set", data_url: dataUrl, filename: file.name });
  }, [base]);

  const clearPendingMedia = useCallback(() => {
    pendingMediaRef.current = null;
    setPendingMedia(null);
    base.sendJson({ type: "media.clear" });
  }, [base]);

  return {
    ...base,
    pendingMedia,
    attachMediaFile,
    clearPendingMedia,
  };
}
```

- [ ] **Step 4: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Run Playwright tests**

Run: `cd apps/web && npx playwright test tests/chat-realtime-voice.spec.ts tests/realtime-voice.spec.ts --reporter=list`
Expected: Tests pass (they mock WebSocket/audio, so internal refactoring should be transparent)

- [ ] **Step 6: Commit**

```bash
git add apps/web/hooks/useRealtimeVoiceBase.ts apps/web/hooks/useRealtimeVoice.ts apps/web/hooks/useSyntheticRealtimeVoice.ts
git commit -m "refactor: extract useRealtimeVoiceBase, rewrite voice hooks as thin wrappers"
```

---

## Task 6: Create RealtimeVoicePanel and wire ChatInterface

**Files:**
- Create: `apps/web/components/console/RealtimeVoicePanel.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`
- Delete: `apps/web/components/console/RealtimeVoice.tsx`
- Delete: `apps/web/components/console/SyntheticRealtimeVoice.tsx`

- [ ] **Step 1: Create RealtimeVoicePanel.tsx**

Unified panel that handles both omni and synthetic modes. Merges the UI from RealtimeVoice.tsx (203 lines) and SyntheticRealtimeVoice.tsx (262 lines):

```typescript
// apps/web/components/console/RealtimeVoicePanel.tsx
"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useRealtimeVoice, type RealtimeState } from "@/hooks/useRealtimeVoice";
import { useSyntheticRealtimeVoice, type SyntheticPendingMedia } from "@/hooks/useSyntheticRealtimeVoice";
import { type ChatMode } from "./chat-types";

interface RealtimeVoicePanelProps {
  chatMode: ChatMode; // "omni_realtime" | "synthetic_realtime"
  conversationId: string;
  projectId: string;
  allowVideoInput?: boolean;
  onTurnComplete: (payload: { userText: string; assistantText: string }) => void;
  onTranscriptUpdate: (payload: { role: "user" | "assistant"; text: string; final: boolean; action?: "upsert" | "discard" }) => void;
  onError: (msg: string) => void;
  onStateChange: (state: string) => void;
}

export default function RealtimeVoicePanel({
  chatMode,
  conversationId,
  projectId,
  allowVideoInput,
  onTurnComplete,
  onTranscriptUpdate,
  onError,
  onStateChange,
}: RealtimeVoicePanelProps) {
  const t = useTranslations("console-chat");
  const isOmni = chatMode === "omni_realtime";

  // Both hooks are instantiated because React hooks can't be called conditionally.
  // This is safe: hooks start idle and only activate when connect() is called.
  // The inactive hook allocates refs/state but has zero side effects.
  // Alternative: split into two keyed child components — acceptable refactor if perf matters.
  const omni = useRealtimeVoice({
    conversationId, projectId,
    onTurnComplete, onTranscriptUpdate, onError, onStateChange,
  });
  const synthetic = useSyntheticRealtimeVoice({
    conversationId, projectId,
    onTurnComplete, onTranscriptUpdate, onError, onStateChange,
  });

  const voice = isOmni ? omni : synthetic;
  const pendingMedia = isOmni ? null : synthetic.pendingMedia;
  const attachMediaFile = isOmni ? undefined : synthetic.attachMediaFile;
  const clearPendingMedia = isOmni ? undefined : synthetic.clearPendingMedia;

  // File input refs for synthetic mode
  const uploadRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  const stateLabel = (() => {
    switch (voice.state) {
      case "connecting": return isOmni ? t("realtimePreparing") : t("syntheticPreparing");
      case "ready": return isOmni ? t("realtimePreparing") : t("syntheticPreparing");
      case "listening": return isOmni ? t("realtimeListening") : t("syntheticListening");
      case "ai_speaking": return isOmni ? t("realtimeSpeaking") : t("syntheticSpeaking");
      case "reconnecting": return t("realtimeReconnecting");
      default: return "";
    }
  })();

  const isActive = voice.state !== "idle" && voice.state !== "error";
  const timerText = `${Math.floor(voice.timer / 60).toString().padStart(2, "0")}:${(voice.timer % 60).toString().padStart(2, "0")}`;

  // Waveform bars
  const volume = voice.state === "ai_speaking" ? voice.aiVolume : voice.userVolume;
  const bars = Array.from({ length: 5 }, (_, i) => {
    const base = 4;
    const max = 20;
    const h = base + (max - base) * Math.min(1, volume * (3 + Math.sin(i * 1.2)));
    return h;
  });

  const stateColor = voice.state === "ai_speaking" ? "var(--accent-purple, #a78bfa)" : voice.state === "listening" ? "var(--accent-green, #34d399)" : "var(--text-tertiary)";

  if (!isActive && voice.state !== "error") {
    // Entry button
    return (
      <div className="realtime-voice-entry">
        <button type="button" className="realtime-voice-start" onClick={() => void voice.connect()}>
          {isOmni ? t("realtimeEntry") : t("syntheticEntry")}
        </button>
      </div>
    );
  }

  // Render full panel, including media toolbar for synthetic
  return (
    <div className="realtime-voice-panel">
      {/* Hidden file inputs for synthetic media */}
      {!isOmni && (
        <>
          <input ref={uploadRef} type="file" accept={allowVideoInput ? "image/*,video/*" : "image/*"} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && attachMediaFile) void attachMediaFile(f); e.target.value = ""; }} />
          <input ref={captureRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && attachMediaFile) void attachMediaFile(f); e.target.value = ""; }} />
        </>
      )}

      {/* Media toolbar for synthetic */}
      {!isOmni && isActive && (
        <div className="realtime-media-toolbar">
          <button type="button" onClick={() => uploadRef.current?.click()}>{t("syntheticUpload")}</button>
          <button type="button" onClick={() => captureRef.current?.click()}>{t("imageCapture")}</button>
          {pendingMedia && (
            <span className="realtime-media-badge">
              {pendingMedia.kind === "video" ? t("syntheticVideo") : ""} {pendingMedia.filename}
              <button type="button" onClick={clearPendingMedia}>&times;</button>
            </span>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="realtime-status">
        <div className="realtime-waveform" style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {bars.map((h, i) => (
            <div key={i} style={{ width: 3, height: h, borderRadius: 1.5, background: stateColor, transition: "height 0.1s" }} />
          ))}
        </div>
        <span className="realtime-status-text">{stateLabel}</span>
        <span className="realtime-timer">{timerText}</span>
      </div>

      {/* Transcript */}
      <div className="realtime-transcript">
        {voice.transcript.map((entry, i) => (
          <div key={i} className={`realtime-transcript-entry is-${entry.role}`}>
            {entry.text}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="realtime-controls">
        <button type="button" onClick={voice.toggleMute}>
          {voice.isMuted ? t("voiceUnmute") : t("voiceMute")}
        </button>
        <button type="button" onClick={voice.disconnect}>
          {t("voiceHangup")}
        </button>
      </div>

      {voice.state === "error" && (
        <div className="realtime-error">
          <button type="button" onClick={() => void voice.connect()}>{t("voiceRetry")}</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update ChatInterface.tsx to use RealtimeVoicePanel**

Replace the two conditional voice component renders (lines 1209-1231) with a single:

```typescript
{conversationId && projectId && (chatMode === "omni_realtime" || (chatMode === "synthetic_realtime" && syntheticModeAvailable)) && (
  <RealtimeVoicePanel
    key={`voice:${projectId}:${conversationId}:${chatMode}`}
    chatMode={chatMode}
    conversationId={conversationId}
    projectId={projectId}
    allowVideoInput={syntheticVideoAvailable}
    onTurnComplete={handleRealtimeTurnComplete}
    onTranscriptUpdate={handleLiveTranscriptUpdate}
    onError={setVoiceNotice}
    onStateChange={setVoiceSessionState}
  />
)}
```

Remove the imports of RealtimeVoice and SyntheticRealtimeVoice.

- [ ] **Step 3: Delete old files**

```bash
rm apps/web/components/console/RealtimeVoice.tsx
rm apps/web/components/console/SyntheticRealtimeVoice.tsx
```

- [ ] **Step 4: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Run Playwright tests**

Run: `cd apps/web && npx playwright test tests/chat-realtime-voice.spec.ts tests/realtime-voice.spec.ts --reporter=list`

If tests import the old component names, update imports in test files to use the new RealtimeVoicePanel.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/console/RealtimeVoicePanel.tsx apps/web/components/console/ChatInterface.tsx
git add -u apps/web/components/console/RealtimeVoice.tsx apps/web/components/console/SyntheticRealtimeVoice.tsx
git commit -m "refactor: merge voice components into RealtimeVoicePanel, delete old files"
```

---

## Task 7: Create SSE streaming infrastructure

**Files:**
- Create: `apps/web/lib/api-stream.ts`

- [ ] **Step 1: Create api-stream.ts**

```typescript
// apps/web/lib/api-stream.ts
import { getApiBaseUrl } from "./env";

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * SSE consumer for streaming chat responses.
 * Sends a POST request and yields parsed SSE events.
 */
export async function* apiStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const base = getApiBaseUrl();
  const url = `${base}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    throw Object.assign(new Error(`Stream request failed: ${response.status}`), {
      status: response.status,
      body: parsed,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || "";

    let currentEvent = "message";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "") {
        // Empty line = end of event
        if (currentData) {
          try {
            yield { event: currentEvent, data: JSON.parse(currentData) };
          } catch {
            yield { event: currentEvent, data: { raw: currentData } };
          }
          currentEvent = "message";
          currentData = "";
        }
      }
    }
  }

  // Flush remaining
  if (buffer.trim()) {
    const lines = buffer.split("\n");
    let currentEvent = "message";
    let currentData = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
      else if (line.startsWith("data: ")) currentData = line.slice(6);
    }
    if (currentData) {
      try {
        yield { event: currentEvent, data: JSON.parse(currentData) };
      } catch {
        yield { event: currentEvent, data: { raw: currentData } };
      }
    }
  }
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api-stream.ts
git commit -m "feat: add SSE streaming client utility (api-stream.ts)"
```

---

## Task 8: Final verification and cleanup

- [ ] **Step 1: Verify ChatInterface.tsx is under 200 lines**

Run: `wc -l apps/web/components/console/ChatInterface.tsx`
Expected: ~150-200 lines

If it's still too large, identify remaining logic that can be pushed down into child components.

- [ ] **Step 2: Full type-check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Full Playwright test suite**

Run: `cd apps/web && npx playwright test --reporter=list`

- [ ] **Step 4: Verify no broken imports**

Run: `cd apps/web && grep -r "RealtimeVoice\|SyntheticRealtimeVoice" --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v RealtimeVoicePanel | grep -v useRealtimeVoice | grep -v useSyntheticRealtimeVoice`

Expected: No results (all old references removed)

- [ ] **Step 5: Final commit**

```bash
git add apps/web/components/console/ apps/web/hooks/ apps/web/lib/api-stream.ts
git commit -m "refactor: Phase 1 complete — ChatInterface split, voice hooks merged, SSE infra"
```
