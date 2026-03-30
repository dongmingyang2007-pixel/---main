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
  const [expanded, setExpanded] = useState(() => animate);
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

function formatRetrievalPercent(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

function formatRetrievalSourceLabel(
  source: string | null | undefined,
  t: (key: string) => string,
): string {
  const labels: Record<string, string> = {
    static: t("retrievalSourceStatic"),
    semantic: t("retrievalSourceSemantic"),
    lexical: t("retrievalSourceLexical"),
    graph_parent: t("retrievalSourceGraphParent"),
    graph_child: t("retrievalSourceGraphChild"),
    graph_edge: t("retrievalSourceGraphEdge"),
    recent_temporary: t("retrievalSourceRecentTemporary"),
    context: t("retrievalSourceContext"),
  };
  if (!source) {
    return labels.context;
  }
  return labels[source] || source.replace(/_/g, " ");
}

function formatRetrievalMemoryKind(
  memoryKind: string | null | undefined,
  t: (key: string) => string,
): string {
  const labels: Record<string, string> = {
    profile: t("retrievalKindProfile"),
    preference: t("retrievalKindPreference"),
    goal: t("retrievalKindGoal"),
    episodic: t("retrievalKindEpisodic"),
    fact: t("retrievalKindFact"),
    summary: t("retrievalKindSummary"),
  };
  if (!memoryKind) {
    return t("retrievalKindUnknown");
  }
  return labels[memoryKind] || memoryKind;
}

function formatMemoryResultLabel(
  status: string | null | undefined,
  t: (key: string) => string,
): string {
  const labels: Record<string, string> = {
    permanent: t("memory.resultPermanent"),
    temporary: t("memory.resultTemporary"),
    appended: t("memory.resultAppended"),
    merged: t("memory.resultMerged"),
    replaced: t("memory.resultReplaced"),
    duplicate: t("memory.resultDuplicate"),
    discarded: t("memory.resultDiscarded"),
    ignored: t("memory.resultIgnored"),
  };
  if (!status) {
    return t("memory.resultUnknown");
  }
  return labels[status] || status;
}

function formatMemoryTriageActionLabel(
  action: string | null | undefined,
  t: (key: string) => string,
): string | null {
  const labels: Record<string, string> = {
    create: t("memory.actionCreate"),
    append: t("memory.actionAppend"),
    merge: t("memory.actionMerge"),
    replace: t("memory.actionReplace"),
    discard: t("memory.actionDiscard"),
  };
  if (!action) {
    return null;
  }
  return labels[action] || action;
}

function CollapsibleRetrievalTrace({
  message,
  t,
}: {
  message: Message;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const trace = message.retrievalTrace;
  const [expanded, setExpanded] = useState(false);

  if (!trace || message.isStreaming) {
    return null;
  }

  const contextLevel = trace.context_level ?? null;
  if (contextLevel === "none" || contextLevel === "profile_only") {
    return null;
  }

  const memories = trace.memories ?? [];
  const knowledgeChunks = trace.knowledge_chunks ?? [];
  const linkedFileChunks = trace.linked_file_chunks ?? [];
  const hasRetrievedItems =
    memories.length > 0 ||
    knowledgeChunks.length > 0 ||
    linkedFileChunks.length > 0;
  const shouldForceVisible =
    contextLevel === "memory_only" || contextLevel === "full_rag";
  const countBadges = [
    { label: t("retrievalBadgeMemory"), value: memories.length },
    { label: t("retrievalBadgeKnowledge"), value: knowledgeChunks.length },
    { label: t("retrievalBadgeLinked"), value: linkedFileChunks.length },
  ].filter((item) => item.value > 0);

  if (!shouldForceVisible && !countBadges.length) {
    return null;
  }

  return (
    <div className="chat-context-trace" aria-label={t("retrievalLabel")}>
      <button
        type="button"
        className="chat-context-trace-toggle"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="chat-context-trace-toggle-main">
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
          <span className="chat-context-trace-label">
            {t("retrievalLabel")}
          </span>
          {trace.strategy ? (
            <span className="chat-context-trace-strategy">
              {trace.strategy}
            </span>
          ) : null}
        </div>
        <div className="chat-context-trace-badges">
          {countBadges.map((item) => (
            <span key={item.label} className="chat-context-trace-badge">
              {t("retrievalBadgeCount", {
                label: item.label,
                count: item.value,
              })}
            </span>
          ))}
        </div>
      </button>
      {expanded ? (
        <div className="chat-context-trace-content">
          {trace.memory_counts ? (
            <div className="chat-context-trace-summary">
              {typeof trace.memory_counts.static === "number" ? (
                <span>
                  {t("retrievalSummaryStatic", {
                    count: trace.memory_counts.static,
                  })}
                </span>
              ) : null}
              {typeof trace.memory_counts.relevant === "number" ? (
                <span>
                  {t("retrievalSummaryRelevant", {
                    count: trace.memory_counts.relevant,
                  })}
                </span>
              ) : null}
              {typeof trace.memory_counts.graph === "number" ? (
                <span>
                  {t("retrievalSummaryGraph", {
                    count: trace.memory_counts.graph,
                  })}
                </span>
              ) : null}
              {typeof trace.memory_counts.temporary === "number" ? (
                <span>
                  {t("retrievalSummaryTemporary", {
                    count: trace.memory_counts.temporary,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}

          {memories.length ? (
            <div className="chat-context-section">
              <div className="chat-context-section-title">
                {t("retrievalMemories")}
              </div>
              <div className="chat-context-list">
                {memories.map((memory) => (
                  <article key={memory.id} className="chat-context-card">
                    <div className="chat-context-card-head">
                      <div className="chat-context-card-tags">
                        <span className="chat-context-card-tag is-kind">
                          {formatRetrievalMemoryKind(memory.memory_kind, t)}
                        </span>
                        {memory.source ? (
                          <span className="chat-context-card-tag">
                            {formatRetrievalSourceLabel(memory.source, t)}
                          </span>
                        ) : null}
                        {memory.pinned ? (
                          <span className="chat-context-card-tag is-pinned">
                            {t("retrievalPinned")}
                          </span>
                        ) : null}
                      </div>
                      <div className="chat-context-card-metrics">
                        {formatRetrievalPercent(
                          typeof memory.score === "number"
                            ? memory.score
                            : memory.semantic_score,
                        ) ? (
                          <span>
                            {formatRetrievalPercent(
                              typeof memory.score === "number"
                                ? memory.score
                                : memory.semantic_score,
                            )}
                          </span>
                        ) : null}
                        {formatRetrievalPercent(memory.salience) ? (
                          <span>
                            {t("retrievalSalience", {
                              score:
                                formatRetrievalPercent(memory.salience) || "",
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {memory.category ? (
                      <div className="chat-context-card-subtitle">
                        {memory.category}
                      </div>
                    ) : null}
                    <div className="chat-context-card-body">
                      {memory.content}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {knowledgeChunks.length ? (
            <div className="chat-context-section">
              <div className="chat-context-section-title">
                {t("retrievalKnowledge")}
              </div>
              <div className="chat-context-list">
                {knowledgeChunks.map((chunk, index) => (
                  <article
                    key={`${chunk.id || chunk.data_item_id || "knowledge"}-${index}`}
                    className="chat-context-card"
                  >
                    <div className="chat-context-card-head">
                      <div className="chat-context-card-tags">
                        <span className="chat-context-card-tag is-knowledge">
                          {chunk.filename || t("retrievalKnowledgeChunk")}
                        </span>
                      </div>
                      {formatRetrievalPercent(chunk.score) ? (
                        <div className="chat-context-card-metrics">
                          <span>{formatRetrievalPercent(chunk.score)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="chat-context-card-body">
                      {chunk.chunk_text}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {linkedFileChunks.length ? (
            <div className="chat-context-section">
              <div className="chat-context-section-title">
                {t("retrievalLinkedFiles")}
              </div>
              <div className="chat-context-list">
                {linkedFileChunks.map((chunk, index) => (
                  <article
                    key={`${chunk.id || chunk.data_item_id || "linked"}-${index}`}
                    className="chat-context-card"
                  >
                    <div className="chat-context-card-head">
                      <div className="chat-context-card-tags">
                        <span className="chat-context-card-tag is-linked">
                          {chunk.filename || t("retrievalLinkedChunk")}
                        </span>
                      </div>
                      {formatRetrievalPercent(chunk.score) ? (
                        <div className="chat-context-card-metrics">
                          <span>{formatRetrievalPercent(chunk.score)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="chat-context-card-body">
                      {chunk.chunk_text}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {!hasRetrievedItems ? (
            <div className="chat-context-trace-empty">
              {t("retrievalEmpty")}
            </div>
          ) : null}
        </div>
      ) : null}
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
  sourceEntries,
}: {
  message: Message;
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
        {message.content}
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
  if (!sources.length || message.isStreaming) {
    return (
      <AnimatedMessageText
        text={message.content}
        animate={Boolean(message.animateOnMount)}
        streaming={Boolean(message.isStreaming)}
      />
    );
  }

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
  const hasCitationAnchors = Array.from(
    message.content.matchAll(CITATION_PATTERN),
  ).some((match) => sourceEntries.has(Number.parseInt(match[1] || "0", 10)));

  return (
    <>
      <SourceAwareAssistantMarkdown
        message={message}
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

function MemorySummaryCard({
  message,
  t,
}: {
  message: Message;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const facts = message.extracted_facts ?? [];

  if (
    !facts.length &&
    !message.memories_extracted &&
    message.memory_extraction_status !== "pending"
  ) {
    return null;
  }

  return (
    <div className="chat-memory-card">
      <div className="chat-memory-card-header">
        <div className="chat-memory-card-icon">
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
            <circle cx={12} cy={12} r={10} />
            <path d="M12 8v4l3 3" />
          </svg>
        </div>
        <span className="chat-memory-card-label">{t("memory.remembered")}</span>
      </div>
      {message.memories_extracted ? (
        <div className="chat-memory-card-body">
          {message.memories_extracted}
        </div>
      ) : null}
      {facts.length ? (
        <div className="chat-memory-card-facts">
          {facts.map((fact, idx) => (
            <div key={idx} className="chat-memory-fact">
              <div className="chat-memory-fact-header">
                <span className="chat-memory-fact-category">
                  {fact.category || "general"}
                </span>
                <div className="chat-memory-fact-metrics">
                  <span
                    className={`chat-memory-fact-result ${fact.importance >= 0.9 ? "is-high" : fact.importance >= 0.7 ? "is-medium" : "is-low"}`}
                  >
                    {formatMemoryResultLabel(fact.status, t)}
                  </span>
                  <span
                    className={`chat-memory-fact-score ${fact.importance >= 0.9 ? "is-high" : fact.importance >= 0.7 ? "is-medium" : "is-low"}`}
                    title={t("memory.importanceTitle", {
                      score: (fact.importance * 100).toFixed(0),
                    })}
                  >
                    {t("memory.importanceValue", {
                      score: (fact.importance * 100).toFixed(0),
                    })}
                  </span>
                </div>
              </div>
              <div className="chat-memory-fact-text">{fact.fact}</div>
              {fact.triage_action || fact.triage_reason ? (
                <div className="chat-memory-fact-meta">
                  {fact.triage_action ? (
                    <span className="chat-memory-fact-decision">
                      {t("memory.decisionPrefix")}
                      {formatMemoryTriageActionLabel(fact.triage_action, t)}
                    </span>
                  ) : null}
                  {fact.triage_reason ? (
                    <span className="chat-memory-fact-reason">
                      {t("memory.reasonPrefix")}
                      {fact.triage_reason}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {!facts.length &&
      !message.memories_extracted &&
      message.memory_extraction_status === "pending" ? (
        <div className="chat-memory-card-body">{t("memory.processing")}</div>
      ) : null}
    </div>
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
        const showReasoning =
          msg.role === "assistant" && Boolean(msg.reasoningContent?.trim());
        const showMemoryCard =
          msg.role === "assistant" &&
          ((msg.extracted_facts?.length ?? 0) > 0 ||
            Boolean(msg.memories_extracted) ||
            msg.memory_extraction_status === "pending");
        const showMessageActions =
          msg.role === "assistant" &&
          (msg.content.trim() ||
            msg.audioBase64 ||
            loadingReadAloudId === msg.id ||
            readingMessageId === msg.id);

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
                    {showReasoning ? (
                      <CollapsibleReasoning
                        content={msg.reasoningContent?.trim() || ""}
                        animate={Boolean(msg.animateOnMount)}
                        label={t("reasoningLabel")}
                      />
                    ) : null}
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
                    <CollapsibleRetrievalTrace message={msg} t={t} />
                    {showMemoryCard ? (
                      <MemorySummaryCard message={msg} t={t} />
                    ) : null}
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
