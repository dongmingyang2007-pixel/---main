"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";

import { apiPost, isApiRequestError } from "@/lib/api";
import {
  type Message,
  type SpeechResponse,
  createAudioPlayer,
} from "./chat-types";

/* ------------------------------------------------------------------ */
/*  AnimatedMessageText                                                */
/* ------------------------------------------------------------------ */

function AnimatedMessageText({
  text,
  animate,
  streaming = false,
}: {
  text: string;
  animate: boolean;
  streaming?: boolean;
}) {
  const segments = Array.from(text);
  const shouldAnimate = animate && !streaming;
  const [visibleCount, setVisibleCount] = useState(() =>
    shouldAnimate ? 0 : segments.length,
  );

  useEffect(() => {
    if (!shouldAnimate || segments.length === 0) {
      return;
    }

    const msPerChar = segments.length > 240 ? 6 : segments.length > 120 ? 12 : 22;
    let rafId = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const nextCount = Math.min(
        segments.length,
        Math.max(1, Math.floor((now - start) / msPerChar)),
      );
      setVisibleCount(nextCount);
      if (nextCount < segments.length) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [segments.length, shouldAnimate, text]);

  const displayCount = shouldAnimate ? visibleCount : segments.length;
  const visibleText = segments.slice(0, displayCount).join("");
  const showCursor = streaming || (shouldAnimate && displayCount < segments.length);

  return (
    <>
      {visibleText}
      {showCursor ? <span className="chat-inline-cursor">&#x2588;</span> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatMessageListProps {
  messages: Message[];
  onMessagesChange: (msgs: Message[]) => void;
  isTyping: boolean;
  conversationId?: string | null;
  noConversation: boolean;
  onError?: (message: string) => void;
}

export interface ChatMessageListHandle {
  appendMessage: (msg: Message) => void;
  updateMessage: (id: string, updater: (prev: string) => string) => void;
  updateReasoning: (id: string, updater: (prev: string) => string) => void;
  finalizeMessage: (
    tempId: string,
    final: { id: string; isStreaming: boolean; memories_extracted?: string },
  ) => void;
  setMessages: (msgs: Message[]) => void;
  replaceMessages: (updater: (prev: Message[]) => Message[]) => void;
  playReadAloud: (messageId: string, audioBase64?: string) => void;
  stopPlayback: () => void;
}

/* ------------------------------------------------------------------ */
/*  ChatMessageList                                                    */
/* ------------------------------------------------------------------ */

export const ChatMessageList = forwardRef<
  ChatMessageListHandle,
  ChatMessageListProps
>(function ChatMessageList(
  { messages, onMessagesChange, isTyping, conversationId, noConversation, onError },
  ref,
) {
  const t = useTranslations("console-chat");

  /* ---------- keep a ref to the latest messages for imperative handle ---------- */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /* ---------- read-aloud state / refs ---------- */
  const [loadingReadAloudId, setLoadingReadAloudId] = useState<string | null>(null);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ---------- read-aloud helpers ---------- */

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

  const playMessageAudio = useCallback(
    (base64Audio: string, messageId: string) => {
      stopReadAloud();
      try {
        const { audio, url } = createAudioPlayer(base64Audio);
        audioRef.current = audio;
        audioUrlRef.current = url;
        setReadingMessageId(messageId);
        audio.onended = () => {
          releaseAudioPlayer();
        };
        audio.onerror = () => {
          releaseAudioPlayer();
        };
        void audio.play().catch(() => {
          releaseAudioPlayer();
        });
      } catch {
        releaseAudioPlayer();
      }
    },
    [releaseAudioPlayer, stopReadAloud],
  );

  const cacheMessageAudio = useCallback(
    (messageId: string, audioBase64: string) => {
      onMessagesChange(
        messagesRef.current.map((message) =>
          message.id === messageId ? { ...message, audioBase64 } : message,
        ),
      );
    },
    [onMessagesChange],
  );

  const handleReadAloud = useCallback(
    async (message: Message) => {
      const text = message.content.trim();
      if (!conversationId || !text) {
        return;
      }

      if (readingMessageId === message.id) {
        stopReadAloud();
        return;
      }

      if (message.audioBase64) {
        playMessageAudio(message.audioBase64, message.id);
        return;
      }

      setLoadingReadAloudId(message.id);
      try {
        const data = await apiPost<SpeechResponse>(
          `/api/v1/chat/conversations/${conversationId}/speech`,
          { content: text },
        );
        if (!data.audio_response) {
          throw new Error("missing audio response");
        }
        cacheMessageAudio(message.id, data.audio_response);
        playMessageAudio(data.audio_response, message.id);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Read-aloud failed";
        onError?.(errorMessage);
      } finally {
        setLoadingReadAloudId((current) =>
          current === message.id ? null : current,
        );
      }
    },
    [
      cacheMessageAudio,
      conversationId,
      onError,
      playMessageAudio,
      readingMessageId,
      stopReadAloud,
    ],
  );

  /* ---------- scroll-to-bottom ---------- */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  /* ---------- cleanup on unmount ---------- */

  useEffect(() => () => stopReadAloud(), [stopReadAloud]);

  /* ---------- imperative handle ---------- */

  useImperativeHandle(
    ref,
    () => ({
      appendMessage(msg: Message) {
        onMessagesChange([...messagesRef.current, msg]);
      },
      updateMessage(id: string, updater: (prev: string) => string) {
        onMessagesChange(
          messagesRef.current.map((m) =>
            m.id === id ? { ...m, content: updater(m.content) } : m,
          ),
        );
      },
      updateReasoning(id: string, updater: (prev: string) => string) {
        onMessagesChange(
          messagesRef.current.map((m) =>
            m.id === id
              ? { ...m, reasoningContent: updater(m.reasoningContent ?? "") }
              : m,
          ),
        );
      },
      finalizeMessage(
        tempId: string,
        final: { id: string; isStreaming: boolean; memories_extracted?: string },
      ) {
        onMessagesChange(
          messagesRef.current.map((m) =>
            m.id === tempId ? { ...m, ...final } : m,
          ),
        );
      },
      setMessages(msgs: Message[]) {
        onMessagesChange(msgs);
      },
      replaceMessages(updater: (prev: Message[]) => Message[]) {
        onMessagesChange(updater(messagesRef.current));
      },
      playReadAloud(messageId: string, audioBase64?: string) {
        if (audioBase64) {
          cacheMessageAudio(messageId, audioBase64);
          playMessageAudio(audioBase64, messageId);
        } else {
          const msg = messagesRef.current.find((m) => m.id === messageId);
          if (msg) {
            void handleReadAloud(msg);
          }
        }
      },
      stopPlayback() {
        stopReadAloud();
      },
    }),
    [cacheMessageAudio, handleReadAloud, onMessagesChange, playMessageAudio, stopReadAloud],
  );

  /* ---------- render ---------- */

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
                  title={
                    readingMessageId === msg.id
                      ? t("voiceStop")
                      : t("voicePlay")
                  }
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
});
