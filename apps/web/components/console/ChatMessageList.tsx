"use client";

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { apiPost } from "@/lib/api";
import {
  type Message,
  type SearchSource,
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
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--console-accent, #6366f1)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {visibleText}
      </ReactMarkdown>
      {showCursor ? <span className="chat-inline-cursor">&#x2588;</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CollapsibleReasoning                                               */
/* ------------------------------------------------------------------ */

function CollapsibleReasoning({
  content,
  animate,
  label,
}: {
  content: string;
  animate: boolean;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewLength = 80;
  const isLong = content.length > previewLength;
  const preview = isLong ? content.slice(0, previewLength) + "..." : content;

  return (
    <div className="chat-reasoning" aria-label={label}>
      <button
        type="button"
        className="chat-reasoning-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 200ms",
            flexShrink: 0,
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="chat-reasoning-label">{label}</span>
        {!expanded && isLong && (
          <span className="chat-reasoning-preview">{preview}</span>
        )}
      </button>
      {expanded && (
        <div className="chat-reasoning-content">
          <AnimatedMessageText text={content} animate={animate} />
        </div>
      )}
    </div>
  );
}

const CITATION_PATTERN = /\[ref_(\d+)\]/g;

type CitationPart =
  | { kind: "text"; value: string }
  | { kind: "citation"; index: number; raw: string };

function getSourceDisplayIndex(source: SearchSource, fallbackIndex: number): number {
  return source.index > 0 ? source.index : fallbackIndex;
}

function getSourceCardId(messageId: string, sourceIndex: number): string {
  return `chat-source-${messageId}-${sourceIndex}`;
}

function parseCitationParts(text: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, start) });
    }
    parts.push({
      kind: "citation",
      index: Number.parseInt(match[1] || "0", 10),
      raw: match[0],
    });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return parts.length ? parts : [{ kind: "text", value: text }];
}

function buildCitationSnippetMap(text: string): Map<number, string> {
  const snippets = new Map<number, string>();
  const blocks = text
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const indices = Array.from(block.matchAll(CITATION_PATTERN)).map((match) =>
      Number.parseInt(match[1] || "0", 10),
    );
    if (!indices.length) {
      continue;
    }
    const cleaned = block.replace(CITATION_PATTERN, "").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    for (const index of indices) {
      if (!snippets.has(index)) {
        snippets.set(index, cleaned);
      }
    }
  }

  return snippets;
}

function formatSourceDomain(source: SearchSource): string {
  const siteName = source.site_name?.trim();
  const domain = source.domain.trim();
  if (siteName && domain && siteName !== domain) {
    return `${siteName} · ${domain}`;
  }
  return siteName || domain;
}

function getSourceIconUrl(source: SearchSource): string | null {
  const explicitIcon = source.icon?.trim();
  if (explicitIcon) {
    return explicitIcon;
  }

  try {
    return new URL("/favicon.ico", source.url).toString();
  } catch {
    return null;
  }
}

function resolveSourceSummary(
  source: SearchSource,
  citationSnippets: Map<number, string>,
  fallbackIndex: number,
): string | null {
  const explicitSummary = source.summary?.trim();
  if (explicitSummary) {
    return explicitSummary;
  }
  return citationSnippets.get(getSourceDisplayIndex(source, fallbackIndex)) || null;
}

function SourceFavicon({
  source,
}: {
  source: SearchSource;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconUrl = getSourceIconUrl(source);
  const fallbackLabel = (source.site_name || source.domain || source.title || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <span className="chat-source-favicon" aria-hidden="true">
      {iconUrl && !imageFailed ? (
        <img
          className="chat-source-favicon-img"
          src={iconUrl}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="chat-source-favicon-fallback">{fallbackLabel || "?"}</span>
      )}
    </span>
  );
}

function CitationAnchor({
  messageId,
  source,
  displayIndex,
  previewSummary,
}: {
  messageId: string;
  source: SearchSource;
  displayIndex: number;
  previewSummary: string;
}) {
  return (
    <span className="chat-citation-anchor-wrap">
      <a
        className="chat-citation-anchor"
        href={`#${getSourceCardId(messageId, displayIndex)}`}
        title={source.title}
      >
        [{displayIndex}]
      </a>
      <span className="chat-citation-preview" role="tooltip">
        <span className="chat-citation-preview-title">{source.title}</span>
        <span className="chat-citation-preview-meta">{formatSourceDomain(source)}</span>
        <span className="chat-citation-preview-summary">{previewSummary}</span>
      </span>
    </span>
  );
}

function AssistantMessageBody({
  message,
  t,
}: {
  message: Message;
  t: (key: string) => string;
}) {
  const sources = message.sources ?? [];
  if (!sources.length || message.isStreaming) {
    return (
      <AnimatedMessageText
        text={message.content}
        animate={Boolean(message.animateOnMount)}
        streaming={Boolean(message.isStreaming)}
      />
    );
  }

  const citationParts = parseCitationParts(message.content);
  const citationSnippets = buildCitationSnippetMap(message.content);
  const sourceEntries = new Map(
    sources.map((source, index) => {
      const displayIndex = getSourceDisplayIndex(source, index + 1);
      const previewSummary =
        resolveSourceSummary(source, citationSnippets, index + 1) ||
        t("sourceNoSummary");
      return [displayIndex, { source, displayIndex, previewSummary }];
    }),
  );
  const hasCitationAnchors = citationParts.some((part) => part.kind === "citation");

  return (
    <>
      {citationParts.map((part, index) => {
        if (part.kind === "text") {
          return <Fragment key={`text-${index}`}>{part.value}</Fragment>;
        }

        const entry = sourceEntries.get(part.index);
        if (!entry) {
          return <Fragment key={`raw-${index}`}>{part.raw}</Fragment>;
        }

        return (
          <CitationAnchor
            key={`cite-${index}`}
            messageId={message.id}
            source={entry.source}
            displayIndex={entry.displayIndex}
            previewSummary={entry.previewSummary}
          />
        );
      })}
      {!hasCitationAnchors ? (
        <span className="chat-citation-inline-list">
          {" "}
          {t("sourceReferencePrefix")}{" "}
          {sources.map((source, index) => {
            const displayIndex = getSourceDisplayIndex(source, index + 1);
            return (
              <Fragment key={`${source.url}-${displayIndex}`}>
                {index > 0 ? " " : null}
                <CitationAnchor
                  messageId={message.id}
                  source={source}
                  displayIndex={displayIndex}
                  previewSummary={
                    resolveSourceSummary(source, citationSnippets, index + 1) ||
                    t("sourceNoSummary")
                  }
                />
              </Fragment>
            );
          })}
        </span>
      ) : null}
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
    final: {
      id: string;
      isStreaming: boolean;
      memories_extracted?: string;
      sources?: SearchSource[];
    },
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
        final: {
          id: string;
          isStreaming: boolean;
          memories_extracted?: string;
          sources?: SearchSource[];
        },
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
        (() => {
          const assistantSources = msg.role === "assistant" ? msg.sources ?? [] : [];
          const citationSnippets = buildCitationSnippetMap(msg.content);
          return (
        <div
          key={msg.id}
          className={`chat-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}
        >
          {msg.role === "assistant" && (
            <div className="chat-avatar-ai" aria-hidden="true">
              <span className="chat-avatar-ai-char">{"\u94ED"}</span>
            </div>
          )}
          <div className="chat-message-stack">
            {msg.role === "assistant" && msg.reasoningContent?.trim() ? (
              <CollapsibleReasoning
                content={msg.reasoningContent.trim()}
                animate={Boolean(msg.animateOnMount)}
                label={t("reasoningLabel")}
              />
            ) : null}
            <div className="chat-bubble">
              {msg.role === "assistant" ? (
                <AssistantMessageBody message={msg} t={t} />
              ) : (
                <AnimatedMessageText
                  text={msg.content}
                  animate={Boolean(msg.animateOnMount)}
                  streaming={Boolean(msg.isStreaming)}
                />
              )}
            </div>
            {msg.role === "assistant" && assistantSources.length ? (
              <div className="chat-sources" aria-label={t("sourcesLabel")}>
                {assistantSources.map((source, index) => {
                  const displayIndex = getSourceDisplayIndex(source, index + 1);
                  const summary =
                    resolveSourceSummary(source, citationSnippets, index + 1) ||
                    t("sourceNoSummary");

                  return (
                    <article
                      key={`${source.url}-${displayIndex}`}
                      id={getSourceCardId(msg.id, displayIndex)}
                      className="chat-source-card"
                    >
                      <div className="chat-source-head">
                        <div className="chat-source-head-main">
                          <SourceFavicon source={source} />
                          <div className="chat-source-head-copy">
                            <a
                              className="chat-source-title"
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title}
                            </a>
                            <div className="chat-source-domain">{formatSourceDomain(source)}</div>
                          </div>
                        </div>
                        <span className="chat-source-index">[{displayIndex}]</span>
                      </div>
                      <a
                        className="chat-source-url"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.url}
                      </a>
                      <div className="chat-source-summary">{summary}</div>
                    </article>
                  );
                })}
              </div>
            ) : null}
            {msg.role === "assistant" &&
            (msg.content.trim() ||
              msg.audioBase64 ||
              loadingReadAloudId === msg.id ||
              readingMessageId === msg.id) ? (
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
            ) : null}
            {msg.role === "assistant" && msg.extracted_facts && msg.extracted_facts.length > 0 && (
              <div className="chat-memory-card">
                <div className="chat-memory-card-header">
                  <div className="chat-memory-card-icon">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx={12} cy={12} r={10} />
                      <path d="M12 8v4l3 3" />
                    </svg>
                  </div>
                  <span className="chat-memory-card-label">{t("memory.remembered")}</span>
                </div>
                <div className="chat-memory-card-facts">
                  {msg.extracted_facts.map((fact, idx) => (
                    <div key={idx} className="chat-memory-fact">
                      <div className="chat-memory-fact-header">
                        <span className="chat-memory-fact-category">{fact.category || "general"}</span>
                        <span
                          className={`chat-memory-fact-score ${fact.importance >= 0.9 ? "is-high" : fact.importance >= 0.7 ? "is-medium" : "is-low"}`}
                          title={`Importance: ${(fact.importance * 100).toFixed(0)}%`}
                        >
                          {fact.importance >= 0.9 ? "permanent" : fact.importance >= 0.7 ? "temporary" : "ignored"}
                          {" "}
                          {(fact.importance * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="chat-memory-fact-text">{fact.fact}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {msg.role === "assistant" && msg.memories_extracted && !(msg.extracted_facts && msg.extracted_facts.length > 0) && (
              <div className="chat-memory-card">
                <div className="chat-memory-card-header">
                  <div className="chat-memory-card-icon">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx={12} cy={12} r={10} />
                      <path d="M12 8v4l3 3" />
                    </svg>
                  </div>
                  <span className="chat-memory-card-label">{t("memory.remembered")}</span>
                </div>
                <div className="chat-memory-card-body">{msg.memories_extracted}</div>
              </div>
            )}
          </div>
        </div>
          );
        })()
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
