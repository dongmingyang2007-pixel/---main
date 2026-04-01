import {
  type ChatMetaRailItem,
  type Message,
  type MessageInspectorOverride,
  type MemoryWriteSummaryItem,
  type MemoryWriteSummaryView,
  type RetrievalSummaryView,
  type ThinkingSummaryView,
} from "../chat-types";

export type InspectorTranslationFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function getOverrideKey(messageId: string, targetMemoryId: string): string {
  return `${messageId}:${targetMemoryId}`;
}

function resolveMemoryOverride(
  messageId: string,
  targetMemoryId: string | null | undefined,
  overrides: Record<string, MessageInspectorOverride>,
): MessageInspectorOverride | null {
  if (!targetMemoryId) {
    return null;
  }
  return overrides[getOverrideKey(messageId, targetMemoryId)] ?? null;
}

export function buildSourceSummary(
  message: Message,
  t: InspectorTranslationFn,
): ChatMetaRailItem | null {
  const count = message.sources?.length ?? 0;
  if (!count) {
    return null;
  }
  return {
    key: "sources",
    label: t("inspector.meta.sources", { count }),
    tab: "context",
    section: "sources",
    count,
  };
}

export function buildRetrievalSummary(
  message: Message,
  t: InspectorTranslationFn,
): RetrievalSummaryView {
  const trace = message.retrievalTrace;
  const contextLevel = trace?.context_level ?? null;
  const memoryCount = trace?.memories.length ?? 0;
  const materialCount =
    (trace?.knowledge_chunks.length ?? 0) +
    (trace?.linked_file_chunks.length ?? 0);

  if (!trace || contextLevel === "none") {
    return {
      contextLevel,
      memoryCount,
      materialCount,
      label: null,
    };
  }

  if (contextLevel === "profile_only") {
    return {
      contextLevel,
      memoryCount,
      materialCount,
      label: t("inspector.meta.profile"),
    };
  }

  if (contextLevel === "memory_only") {
    return {
      contextLevel,
      memoryCount,
      materialCount,
      label: t("inspector.meta.memoryOnly", {
        memoryCount,
      }),
    };
  }

  return {
    contextLevel,
    memoryCount,
    materialCount,
    label: t("inspector.meta.fullRag", {
      memoryCount,
      materialCount,
    }),
  };
}

function resolveMemoryBadgeKey(item: {
  triageAction: string | null;
  status: string | null;
  memoryType: "permanent" | "temporary" | null;
}): MemoryWriteSummaryItem["badgeKey"] {
  if (item.triageAction === "discard") {
    return "not_written";
  }

  if (
    item.triageAction === "append" ||
    item.triageAction === "merge" ||
    item.triageAction === "replace" ||
    item.status === "merged" ||
    item.status === "appended" ||
    item.status === "replaced"
  ) {
    return "merged";
  }

  if (item.memoryType === "temporary" || item.status === "temporary") {
    return "temporary";
  }

  if (item.memoryType === "permanent" || item.status === "permanent") {
    return "long_term";
  }

  return "not_written";
}

export function buildMemoryWriteSummary(
  message: Message,
  overrides: Record<string, MessageInspectorOverride>,
  t: InspectorTranslationFn,
): MemoryWriteSummaryView {
  const baseItems = (message.extracted_facts ?? []).map((fact, index) => {
    const override = resolveMemoryOverride(
      message.id,
      fact.target_memory_id,
      overrides,
    );
    const hidden = override?.hidden === true;
    const triageAction = fact.triage_action ?? null;
    const status = override?.status ?? fact.status ?? null;
    const memoryType = override?.memoryType ?? null;

    return {
      id: fact.target_memory_id || `${message.id}-fact-${index}`,
      fact: override?.fact ?? fact.fact,
      category: fact.category,
      importance: fact.importance,
      triageAction,
      triageReason: fact.triage_reason ?? null,
      status,
      targetMemoryId: fact.target_memory_id ?? null,
      memoryType,
      badgeKey: resolveMemoryBadgeKey({
        triageAction,
        status,
        memoryType,
      }),
      isActionable:
        triageAction !== "discard" && Boolean(fact.target_memory_id) && !hidden,
      hidden,
    };
  });

  const items = baseItems
    .filter((item) => !item.hidden)
    .map(({ hidden: _hidden, ...item }) => item);
  const count = items.filter((item) => item.triageAction !== "discard").length;

  return {
    count,
    label: count > 0 ? t("inspector.meta.memoryWrite", { count }) : null,
    items,
  };
}

export function buildThinkingSummary(
  message: Message,
  t: InspectorTranslationFn,
): ThinkingSummaryView {
  const content = message.reasoningContent?.trim() || null;
  return {
    content,
    label: content ? t("inspector.meta.thinking") : null,
  };
}

export function buildChatMetaRailItems(
  message: Message,
  overrides: Record<string, MessageInspectorOverride>,
  t: InspectorTranslationFn,
): ChatMetaRailItem[] {
  const sourceItem = buildSourceSummary(message, t);
  const retrievalSummary = buildRetrievalSummary(message, t);
  const memorySummary = buildMemoryWriteSummary(message, overrides, t);
  const thinkingSummary = buildThinkingSummary(message, t);

  return [
    sourceItem,
    retrievalSummary.label
      ? {
          key: "context",
          label: retrievalSummary.label,
          tab: "context",
          section:
            retrievalSummary.contextLevel === "profile_only" ? "profile" : "recent",
        }
      : null,
    memorySummary.label
      ? {
          key: "memory_write",
          label: memorySummary.label,
          tab: "memory_write",
          count: memorySummary.count,
        }
      : null,
    thinkingSummary.label
      ? {
          key: "thinking",
          label: thinkingSummary.label,
          tab: "thinking",
        }
      : null,
  ].filter((item): item is ChatMetaRailItem => item !== null);
}

export function getMessageInspectorOverrideKey(
  messageId: string,
  targetMemoryId: string,
): string {
  return getOverrideKey(messageId, targetMemoryId);
}
