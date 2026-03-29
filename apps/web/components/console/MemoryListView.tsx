"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  type MemoryNode,
  getMemoryCategoryLabel,
  getMemoryCategorySegments,
  getMemoryKind,
  getMemoryLastUsedAt,
  getMemoryLastUsedSource,
  getMemoryRetrievalCount,
  getMemorySalience,
  getSummarySourceCount,
  isAssistantRootMemoryNode,
  isFileMemoryNode,
  isPinnedMemoryNode,
  isStructuralOnlyMemoryNode,
  isSummaryMemoryNode,
} from "@/hooks/useGraphData";
import { formatRelativeTime } from "@/lib/format-time";

interface MemoryListViewProps {
  nodes: MemoryNode[];
  onUpdateMemory: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
}

type FilterKey = "all" | "profile" | "preference" | "goal" | "summary" | "temporary";

function getTypeClass(node: MemoryNode): string {
  if (isSummaryMemoryNode(node)) return "summary";
  if (isPinnedMemoryNode(node)) return "pinned";
  if (node.type === "permanent") return "permanent";
  return "temporary";
}

function getMemoryKindLabel(kind: string | null, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    profile: t("memory.kindProfile"),
    preference: t("memory.kindPreference"),
    goal: t("memory.kindGoal"),
    episodic: t("memory.kindEpisodic"),
    fact: t("memory.kindFact"),
    summary: t("memory.kindSummary"),
  };
  if (!kind) {
    return t("memory.kindUnknown");
  }
  return labels[kind] || kind;
}

export default function MemoryListView({
  nodes,
  onUpdateMemory,
  onDeleteMemory,
}: MemoryListViewProps) {
  const t = useTranslations("console");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string | null>(null);

  const memoryNodes = useMemo(
    () =>
      nodes.filter(
        (node) =>
          !isFileMemoryNode(node) &&
          !isAssistantRootMemoryNode(node) &&
          !isStructuralOnlyMemoryNode(node),
      ),
    [nodes],
  );

  const filteredNodes = useMemo(() => {
    let result = memoryNodes;

    if (activeFilter !== "all") {
      result = result.filter((node) => {
        if (activeFilter === "temporary") {
          return node.type === "temporary";
        }
        if (activeFilter === "summary") {
          return isSummaryMemoryNode(node);
        }
        return getMemoryKind(node) === activeFilter;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (n) =>
          n.content.toLowerCase().includes(q) ||
          n.category.toLowerCase().includes(q),
      );
    }

    // Sort by updated_at descending
    return [...result].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [memoryNodes, activeFilter, search]);

  const selectedNode = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) : null),
    [nodes, selectedId],
  );
  const selectedKind = selectedNode ? getMemoryKind(selectedNode) : null;
  const selectedRetrievalCount = selectedNode ? getMemoryRetrievalCount(selectedNode) : 0;
  const selectedLastUsedAt = selectedNode ? getMemoryLastUsedAt(selectedNode) : null;
  const selectedLastUsedSource = selectedNode ? getMemoryLastUsedSource(selectedNode) : null;
  const selectedSalience = selectedNode ? getMemorySalience(selectedNode) : null;
  const selectedSummaryCount = selectedNode ? getSummarySourceCount(selectedNode) : 0;

  const filters: { key: FilterKey; labelKey: string }[] = [
    { key: "all", labelKey: "memory.filterAll" },
    { key: "profile", labelKey: "memory.filterProfile" },
    { key: "preference", labelKey: "memory.filterPreference" },
    { key: "goal", labelKey: "memory.filterGoal" },
    { key: "summary", labelKey: "memory.filterSummary" },
    { key: "temporary", labelKey: "memory.filterTemporary" },
  ];

  const handleSave = async () => {
    if (!selectedNode || editingContent === null) return;
    await onUpdateMemory(selectedNode.id, { content: editingContent });
    setEditingContent(null);
  };

  const handleDelete = async () => {
    if (!selectedNode) return;
    await onDeleteMemory(selectedNode.id);
    setSelectedId(null);
    setEditingContent(null);
  };

  return (
    <div className="memory-list-layout">
      {/* Left panel */}
      <div className="memory-list-panel">
        <div className="memory-list-search">
          <input
            type="text"
            placeholder={t("memory.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="memory-list-filters">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`memory-list-filter${activeFilter === f.key ? " active" : ""}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>

        <div className="memory-list-items">
          {filteredNodes.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              {t("memory.noResults")}
            </div>
          )}
          {filteredNodes.map((node) => (
            <div
              key={node.id}
              className={`memory-list-item${selectedId === node.id ? " active" : ""}`}
              onClick={() => {
                setSelectedId(node.id);
                setEditingContent(null);
              }}
            >
              <div className="memory-list-item-header">
                <span className={`memory-type-dot ${getTypeClass(node)}`} />
                <span className="memory-list-category">
                  {getMemoryCategoryLabel(node) || node.category || getMemoryKindLabel(getMemoryKind(node), t)}
                </span>
                {isSummaryMemoryNode(node) ? (
                  <span className="memory-list-chip is-summary">{t("memory.summaryBadge")}</span>
                ) : null}
                {isPinnedMemoryNode(node) ? (
                  <span className="memory-list-chip is-pinned">{t("memory.pinnedBadge")}</span>
                ) : null}
                {getMemoryRetrievalCount(node) > 0 ? (
                  <span className="memory-list-chip">
                    {t("memory.usedCount", { count: getMemoryRetrievalCount(node) })}
                  </span>
                ) : null}
                <span className="memory-list-time">
                  {formatRelativeTime(node.updated_at, t)}
                </span>
              </div>
              <div className="memory-list-meta-row">
                <span>{getMemoryKindLabel(getMemoryKind(node), t)}</span>
                {getMemoryLastUsedAt(node) ? (
                  <span>{t("memory.lastUsedShort", { time: formatRelativeTime(getMemoryLastUsedAt(node) || node.updated_at, t) })}</span>
                ) : null}
              </div>
              <div className="memory-list-content">{node.content}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="memory-detail-panel">
        {!selectedNode ? (
          <div className="memory-detail-empty">{t("memory.selectToView")}</div>
        ) : (
          <div className="memory-detail-content">
            <div className="memory-detail-header">
              <div className="memory-detail-header-row">
                <span className={`memory-type-dot ${getTypeClass(selectedNode)}`} />
                <span className="memory-detail-category">
                  {getMemoryCategoryLabel(selectedNode) || selectedNode.category || getMemoryKindLabel(selectedKind, t)}
                </span>
                <span className="memory-detail-type-badge">
                  {selectedNode.type === "permanent" ? t("memory.permanentLabel") : t("memory.temporaryLabel")}
                </span>
                <span className="memory-detail-type-badge">
                  {getMemoryKindLabel(selectedKind, t)}
                </span>
                {isSummaryMemoryNode(selectedNode) ? (
                  <span className="memory-detail-type-badge is-summary">{t("memory.summaryBadge")}</span>
                ) : null}
                {isPinnedMemoryNode(selectedNode) ? (
                  <span className="memory-detail-type-badge is-pinned">{t("memory.pinnedBadge")}</span>
                ) : null}
              </div>
              <div className="memory-detail-time">
                {t("memory.created")}: {formatRelativeTime(selectedNode.created_at, t)}
                {" · "}
                {t("memory.updated")}: {formatRelativeTime(selectedNode.updated_at, t)}
              </div>
            </div>

            <div className="memory-detail-body">
              {getMemoryCategorySegments(selectedNode).length > 0 ? (
                <div className="memory-detail-header-row" style={{ marginBottom: 12 }}>
                  {getMemoryCategorySegments(selectedNode).map((segment) => (
                    <span key={segment} className="memory-detail-type-badge">
                      {segment}
                    </span>
                  ))}
                </div>
              ) : null}
              {editingContent !== null ? (
                <textarea
                  className="memory-detail-edit-textarea"
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  rows={8}
                />
              ) : (
                <div className="memory-detail-text">{selectedNode.content}</div>
              )}
            </div>

            <div className="memory-detail-metrics">
              <div className="memory-detail-metric-card">
                <div className="memory-detail-metric-label">{t("memory.salience")}</div>
                <div className="memory-detail-metric-value">
                  {selectedSalience !== null ? `${Math.round(selectedSalience * 100)}%` : "—"}
                </div>
              </div>
              <div className="memory-detail-metric-card">
                <div className="memory-detail-metric-label">{t("memory.retrievalCount")}</div>
                <div className="memory-detail-metric-value">{selectedRetrievalCount}</div>
              </div>
              <div className="memory-detail-metric-card">
                <div className="memory-detail-metric-label">{t("memory.lastUsed")}</div>
                <div className="memory-detail-metric-value">
                  {selectedLastUsedAt ? formatRelativeTime(selectedLastUsedAt, t) : "—"}
                </div>
              </div>
              <div className="memory-detail-metric-card">
                <div className="memory-detail-metric-label">{t("memory.visibility")}</div>
                <div className="memory-detail-metric-value">
                  {selectedNode.metadata_json?.visibility === "private"
                    ? t("memory.visibilityPrivate")
                    : t("memory.visibilityPublic")}
                </div>
              </div>
            </div>

            {selectedLastUsedSource ? (
              <div className="memory-detail-note">
                {t("memory.lastUsedSourceLabel")}: {selectedLastUsedSource}
              </div>
            ) : null}

            {isSummaryMemoryNode(selectedNode) ? (
              <div className="memory-detail-note is-summary">
                {t("memory.summarySourceCount", { count: selectedSummaryCount })}
              </div>
            ) : null}

            {selectedNode.source_conversation_id && (
              <div className="memory-detail-source">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t("memory.fromConversation")}
              </div>
            )}

            <div className="memory-detail-actions">
              {editingContent !== null ? (
                <>
                  <button
                    type="button"
                    className="memory-action-btn"
                    onClick={() => setEditingContent(null)}
                  >
                    {t("memory.cancel")}
                  </button>
                  <button
                    type="button"
                    className="memory-action-btn primary"
                    onClick={() => void handleSave()}
                  >
                    {t("memory.save")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="memory-action-btn"
                    onClick={() => setEditingContent(selectedNode.content)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {t("memory.edit")}
                  </button>
                  <button
                    type="button"
                    className="memory-action-btn"
                    style={{ color: "#dc2626" }}
                    onClick={() => void handleDelete()}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    {t("memory.delete")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
