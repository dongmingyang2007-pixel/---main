"use client";

import {
  type ComponentPropsWithoutRef,
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
  type InspectorSection,
  type InspectorTab,
  type Message,
  type MessageInspectorOverride,
  type SearchSource,
  type SpeechResponse,
  createAudioPlayer,
} from "./chat-types";
import { ChatMessageMetaRail } from "./chat/ChatMessageMetaRail";
import { buildChatMetaRailItems } from "./chat/chat-view-models";

const FENCED_CODE_BLOCK_SPLIT_PATTERN = /(```[\s\S]*?```)/g;
const FENCED_CODE_BLOCK_FULL_PATTERN = /^```[\s\S]*```$/;
const MATH_BLOCK_GLUE_PATTERN =
  /(\$\$[^$]{1,800})\${3,4}(?=(?:\\|[A-Za-z([{]))/gu;
const MATH_AFTER_COLON_PATTERN =
  /([：:])\s*(\$\$)(?=(?:\\|[A-Za-z([{]))/gu;
const DANGLING_COLON_LINE_PATTERN = /^[ \t]*([：:])([ \t]*)(.*\S)?[ \t]*$/u;
const INLINE_HEADING_GLUE_PATTERN =
  /([^\s#])[ \t]*(#{2,6})(?=[ \t]*[0-9A-Za-z\u4e00-\u9fff([{(（【])/gu;
const HEADING_WITHOUT_SPACE_PATTERN =
  /^([ \t]*#{1,6})(?=[0-9A-Za-z\u4e00-\u9fff([{(（【])/gmu;
const DISPLAY_MATH_PATTERN = /\$\$([\s\S]*?)\$\$/gu;
const INLINE_MATH_PATTERN = /(?<!\$)\$([^$\n]+?)\$(?!\$)/gu;
const HEADING_TABLE_GLUE_PATTERN =
  /(^|\n)([ \t]*#{1,6}[^\n|]+?)\|(?=[^\n]*\|[ \t]*:?-{3,}:?)/gu;
const TABLE_SEPARATOR_ROW_PATTERN =
  /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|){2,}[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/u;
const TERMINAL_MATH_COMMANDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "varpi",
  "rho",
  "varrho",
  "sigma",
  "varsigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  "partial",
  "nabla",
  "hbar",
  "ell",
  "infty",
  "imath",
  "jmath",
];
const TERMINAL_MATH_COMMAND_PATTERN = new RegExp(
  String.raw`\\(?:${TERMINAL_MATH_COMMANDS.join("|")})(?=[A-Za-z0-9])`,
  "gu",
);

function mergeDanglingColonLines(lines: string[]): string[] {
  if (!lines.length) {
    return lines;
  }

  const merged: string[] = [];
  for (const line of lines) {
    const match = line.match(DANGLING_COLON_LINE_PATTERN);
    if (
      match &&
      merged.length > 0 &&
      merged[merged.length - 1]?.trim() &&
      !merged[merged.length - 1]?.trimEnd().endsWith(match[1])
    ) {
      const previous = merged.pop()?.trimEnd() ?? "";
      const gap = match[2] ?? "";
      const content = match[3] ?? "";
      merged.push(`${previous}${match[1]}${gap}${content}`.trimEnd());
      continue;
    }
    merged.push(line);
  }

  return merged;
}

function normalizeMathRenderingLine(line: string): string {
  if (!line.includes("$$")) {
    return line;
  }

  return line
    .replace(MATH_BLOCK_GLUE_PATTERN, (_, prefix: string) => `${prefix}$$\n$$`)
    .replace(MATH_AFTER_COLON_PATTERN, "$1\n$2");
}

function normalizeMathBody(body: string): string {
  if (!body.includes("\\")) {
    return body;
  }
  return body.replace(TERMINAL_MATH_COMMAND_PATTERN, (match) => `${match} `);
}

function normalizeMathExpressions(segment: string): string {
  return segment
    .replace(DISPLAY_MATH_PATTERN, (_, body: string) => {
      return `$$${normalizeMathBody(body)}$$`;
    })
    .replace(INLINE_MATH_PATTERN, (_, body: string) => {
      return `$${normalizeMathBody(body)}$`;
    });
}

function normalizeHeadingMarkers(segment: string): string {
  return segment
    .replace(INLINE_HEADING_GLUE_PATTERN, "$1\n$2")
    .replace(HEADING_WITHOUT_SPACE_PATTERN, "$1 ");
}

function ensureTableRowPipes(row: string): string {
  let normalized = row.trim();
  if (!normalized.startsWith("|")) {
    normalized = `|${normalized}`;
  }
  if (!normalized.endsWith("|")) {
    normalized = `${normalized}|`;
  }
  return normalized;
}

function normalizeTableLine(line: string): string {
  if (!line.includes("|") || !line.includes("||") || !line.includes("---")) {
    return line;
  }

  const rows = line
    .split("||")
    .map((row) => row.trim())
    .filter(Boolean)
    .map(ensureTableRowPipes);

  if (rows.length < 2 || !rows.some((row) => TABLE_SEPARATOR_ROW_PATTERN.test(row))) {
    return line;
  }

  return rows.join("\n");
}

function normalizeMarkdownTables(segment: string): string {
  return segment
    .replace(HEADING_TABLE_GLUE_PATTERN, "$1$2\n|")
    .split("\n")
    .map(normalizeTableLine)
    .join("\n");
}

function normalizeRenderableMarkdown(text: string): string {
  if (
    !text.includes("$") &&
    !text.includes("\n:") &&
    !text.includes("\n：") &&
    !text.includes("#") &&
    !text.includes("|")
  ) {
    return text;
  }

  return text
    .split(FENCED_CODE_BLOCK_SPLIT_PATTERN)
    .map((segment) => {
      if (FENCED_CODE_BLOCK_FULL_PATTERN.test(segment)) {
        return segment;
      }
      const mergedLines = mergeDanglingColonLines(
        segment.split("\n").map(normalizeMathRenderingLine),
      ).join("\n");
      return normalizeMarkdownTables(
        normalizeHeadingMarkers(normalizeMathExpressions(mergedLines)),
      );
    })
    .join("");
}

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

    const msPerChar =
      segments.length > 240 ? 6 : segments.length > 120 ? 12 : 22;
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
  const renderableText = normalizeRenderableMarkdown(visibleText);
  const showCursor =
    streaming || (shouldAnimate && displayCount < segments.length);

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--console-accent, #6366f1)",
                textDecoration: "underline",
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {renderableText}
      </ReactMarkdown>
      {showCursor ? <span className="chat-inline-cursor">&#x2588;</span> : null}
    </div>
  );
}

const CITATION_PATTERN = /\[ref_(\d+)\]/g;

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
};

function getSourceDisplayIndex(
  source: SearchSource,
  fallbackIndex: number,
): number {
  return source.index > 0 ? source.index : fallbackIndex;
}

function getSourceCardId(messageId: string, sourceIndex: number): string {
  return `chat-source-${messageId}-${sourceIndex}`;
}

function MarkdownLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "var(--console-accent, #6366f1)",
        textDecoration: "underline",
      }}
    >
      {children}
    </a>
  );
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
    const cleaned = block
      .replace(CITATION_PATTERN, "")
      .replace(/\s+/g, " ")
      .trim();
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

function replaceCitationTextNode(
  node: MarkdownNode,
  {
    messageId,
    sourceIndices,
  }: {
    messageId: string;
    sourceIndices: Set<number>;
  },
): MarkdownNode[] {
  const value = typeof node.value === "string" ? node.value : "";
  if (!value) {
    return [node];
  }

  const nextNodes: MarkdownNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(CITATION_PATTERN)) {
    const raw = match[0];
    const matchIndex = match.index ?? 0;
    const citationIndex = Number.parseInt(match[1] || "0", 10);
    if (!sourceIndices.has(citationIndex)) {
      continue;
    }
    if (matchIndex > lastIndex) {
      nextNodes.push({
        type: "text",
        value: value.slice(lastIndex, matchIndex),
      });
    }
    nextNodes.push({
      type: "link",
      url: `#${getSourceCardId(messageId, citationIndex)}`,
      title: raw,
      children: [{ type: "text", value: `[${citationIndex}]` }],
    });
    lastIndex = matchIndex + raw.length;
  }

  if (!nextNodes.length) {
    return [node];
  }

  if (lastIndex < value.length) {
    nextNodes.push({
      type: "text",
      value: value.slice(lastIndex),
    });
  }

  return nextNodes;
}

function injectCitationLinks(
  node: MarkdownNode,
  {
    messageId,
    sourceIndices,
  }: {
    messageId: string;
    sourceIndices: Set<number>;
  },
): void {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return;
  }

  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (!child || typeof child !== "object") {
      nextChildren.push(child);
      continue;
    }

    if (child.type === "text") {
      nextChildren.push(
        ...replaceCitationTextNode(child, {
          messageId,
          sourceIndices,
        }),
      );
      continue;
    }

    if (
      child.type !== "link" &&
      child.type !== "linkReference" &&
      child.type !== "definition" &&
      child.type !== "inlineCode" &&
      child.type !== "code" &&
      child.type !== "math" &&
      child.type !== "inlineMath" &&
      child.type !== "html"
    ) {
      injectCitationLinks(child, {
        messageId,
        sourceIndices,
      });
    }

    nextChildren.push(child);
  }

  node.children = nextChildren;
}

function createCitationRemarkPlugin(
  messageId: string,
  sourceIndices: Set<number>,
) {
  return function remarkCitationLinks() {
    return (tree: MarkdownNode) => {
      injectCitationLinks(tree, {
        messageId,
        sourceIndices,
      });
    };
  };
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
  return (
    citationSnippets.get(getSourceDisplayIndex(source, fallbackIndex)) || null
  );
}

function SourceFavicon({ source }: { source: SearchSource }) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconUrl = getSourceIconUrl(source);
  const fallbackLabel = (
    source.site_name ||
    source.domain ||
    source.title ||
    "?"
  )
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <span className="chat-source-favicon" aria-hidden="true">
      {iconUrl && !imageFailed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="chat-source-favicon-img"
          src={iconUrl}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="chat-source-favicon-fallback">
          {fallbackLabel || "?"}
        </span>
      )}
    </span>
  );
}

function SourceAwareAssistantMarkdown({
  message,
  content,
  sourceEntries,
}: {
  message: Message;
  content: string;
  sourceEntries: Map<
    number,
    {
      source: SearchSource;
      displayIndex: number;
      previewSummary: string;
    }
  >;
}) {
  const citationPlugin = createCitationRemarkPlugin(
    message.id,
    new Set(sourceEntries.keys()),
  );
  const citationHrefMap = new Map(
    Array.from(sourceEntries.values()).map((entry) => [
      `#${getSourceCardId(message.id, entry.displayIndex)}`,
      entry,
    ]),
  );

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, citationPlugin]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const entry = href ? citationHrefMap.get(href) : undefined;
            if (entry) {
              return (
                <CitationAnchor
                  messageId={message.id}
                  source={entry.source}
                  displayIndex={entry.displayIndex}
                  previewSummary={entry.previewSummary}
                />
              );
            }

            return <MarkdownLink href={href}>{children}</MarkdownLink>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
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
        <span className="chat-citation-preview-meta">
          {formatSourceDomain(source)}
        </span>
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
  const normalizedContent = normalizeRenderableMarkdown(message.content);
  if (!sources.length || message.isStreaming) {
    return (
      <AnimatedMessageText
        text={message.content}
        animate={Boolean(message.animateOnMount)}
        streaming={Boolean(message.isStreaming)}
      />
    );
  }

  const citationSnippets = buildCitationSnippetMap(normalizedContent);
  const sourceEntries = new Map(
    sources.map((source, index) => {
      const displayIndex = getSourceDisplayIndex(source, index + 1);
      const previewSummary =
        resolveSourceSummary(source, citationSnippets, index + 1) ||
        t("sourceNoSummary");
      return [displayIndex, { source, displayIndex, previewSummary }];
    }),
  );
  const hasCitationAnchors = Array.from(
    normalizedContent.matchAll(CITATION_PATTERN),
  ).some((match) => sourceEntries.has(Number.parseInt(match[1] || "0", 10)));

  return (
    <>
      <SourceAwareAssistantMarkdown
        message={message}
        content={normalizedContent}
        sourceEntries={sourceEntries}
      />
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
  messageInspectorOverrides: Record<string, MessageInspectorOverride>;
  onOpenInspector: (payload: {
    tab: InspectorTab;
    messageId: string;
    section?: InspectorSection;
  }) => void;
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
      content?: string;
      reasoningContent?: string | null;
      memories_extracted?: string;
      sources?: SearchSource[];
      retrievalTrace?: Message["retrievalTrace"];
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
  {
    messages,
    onMessagesChange,
    isTyping,
    conversationId,
    noConversation,
    messageInspectorOverrides,
    onOpenInspector,
    onError,
  },
  ref,
) {
  const t = useTranslations("console-chat");

  /* ---------- keep a ref to the latest messages for imperative handle ---------- */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /* ---------- read-aloud state / refs ---------- */
  const [loadingReadAloudId, setLoadingReadAloudId] = useState<string | null>(
    null,
  );
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const conversationIdRef = useRef(conversationId);
  const readAloudRequestSeqRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  conversationIdRef.current = conversationId;

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

  useEffect(() => {
    return () => {
      readAloudRequestSeqRef.current += 1;
      stopReadAloud();
    };
  }, [conversationId, stopReadAloud]);

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

      const requestConversationId = conversationIdRef.current;
      const requestSeq = ++readAloudRequestSeqRef.current;

      if (message.audioBase64) {
        if (
          readAloudRequestSeqRef.current !== requestSeq ||
          conversationIdRef.current !== requestConversationId
        ) {
          return;
        }
        playMessageAudio(message.audioBase64, message.id);
        return;
      }

      setLoadingReadAloudId(message.id);
      try {
        const data = await apiPost<SpeechResponse>(
          `/api/v1/chat/conversations/${conversationId}/speech`,
          { content: text },
        );
        if (
          readAloudRequestSeqRef.current !== requestSeq ||
          conversationIdRef.current !== requestConversationId
        ) {
          return;
        }
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
        if (
          readAloudRequestSeqRef.current !== requestSeq ||
          conversationIdRef.current !== requestConversationId
        ) {
          return;
        }
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
          content?: string;
          reasoningContent?: string | null;
          memories_extracted?: string;
          sources?: SearchSource[];
          retrievalTrace?: Message["retrievalTrace"];
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
    [
      cacheMessageAudio,
      handleReadAloud,
      onMessagesChange,
      playMessageAudio,
      stopReadAloud,
    ],
  );

  /* ---------- render ---------- */

  return (
    <div
      className="chat-messages"
      role="log"
      aria-live="polite"
      aria-busy={isTyping}
      style={{ padding: "16px 24px" }}
    >
      {messages.length === 0 && !isTyping && (
        <div className="chat-empty">
          {noConversation ? t("emptyHint") : t("emptyConversationHint")}
        </div>
      )}

      {messages.map((msg, index) => {
        const assistantSources =
          msg.role === "assistant" ? (msg.sources ?? []) : [];
        const showAvatar =
          msg.role === "assistant" &&
          (index === 0 || messages[index - 1]?.role !== "assistant");
        const showMessageActions =
          msg.role === "assistant" &&
          (msg.content.trim() ||
            msg.audioBase64 ||
            loadingReadAloudId === msg.id ||
            readingMessageId === msg.id);
        const metaRailItems =
          msg.role === "assistant"
            ? buildChatMetaRailItems(msg, messageInspectorOverrides, t)
            : [];

        return (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}
          >
            {msg.role === "assistant" ? (
              <div
                className={`chat-avatar-ai${showAvatar ? "" : " is-ghost"}`}
                aria-hidden="true"
              >
                {showAvatar ? (
                  <span className="chat-avatar-ai-char">铭</span>
                ) : null}
              </div>
            ) : null}
            <div className="chat-message-wrapper">
              <div className="chat-message-stack">
                <div className="chat-message-primary">
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
                  {showMessageActions ? (
                    <div className="chat-message-hover-actions">
                      <button
                        className={`chat-audio-btn ${readingMessageId === msg.id ? "is-active" : ""}`}
                        onClick={() => void handleReadAloud(msg)}
                        title={
                          readingMessageId === msg.id
                            ? t("voiceStop")
                            : t("voicePlay")
                        }
                        aria-label={
                          loadingReadAloudId === msg.id
                            ? t("voicePreparing")
                            : readingMessageId === msg.id
                              ? t("voiceStop")
                              : t("voicePlay")
                        }
                        disabled={loadingReadAloudId === msg.id}
                        type="button"
                      >
                        <svg
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </div>
                {msg.role === "assistant" ? (
                  <div className="chat-message-support">
                    {assistantSources.length ? (
                      <div
                        className="chat-sources-compact"
                        aria-label={t("sourcesLabel")}
                      >
                        {assistantSources.map((source, index) => {
                          const displayIndex = getSourceDisplayIndex(
                            source,
                            index + 1,
                          );
                          return (
                            <a
                              key={`${source.url}-${displayIndex}`}
                              id={getSourceCardId(msg.id, displayIndex)}
                              className="chat-source-chip"
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              title={source.title || source.url}
                            >
                              <SourceFavicon source={source} />
                              <span className="chat-source-chip-domain">
                                {formatSourceDomain(source)}
                              </span>
                              <span className="chat-source-chip-index">
                                {displayIndex}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
                    <ChatMessageMetaRail
                      items={metaRailItems}
                      messageId={msg.id}
                      onOpenInspector={onOpenInspector}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      {isTyping && (
        <div className="chat-message is-assistant">
          <div className="chat-avatar-ai is-ghost" aria-hidden="true" />
          <div className="chat-message-wrapper">
            <div className="chat-message-stack">
              <div className="chat-message-primary">
                <div className="chat-bubble is-typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
});
