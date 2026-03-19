"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { MemoryNode } from "@/hooks/useGraphData";
import { formatRelativeTime } from "@/lib/format-time";

interface MemoryListViewProps {
  nodes: MemoryNode[];
  onUpdateMemory: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
}

type FilterKey = "all" | "personal" | "knowledge" | "preference" | "pack";

const FILTER_CATEGORIES: Record<FilterKey, string[]> = {
  all: [],
  personal: ["个人", "personal", "用户", "user"],
  knowledge: ["知识", "knowledge", "事实", "fact"],
  preference: ["偏好", "preference", "喜好", "习惯"],
  pack: ["记忆包", "pack", "bundle"],
};

function getTypeClass(node: MemoryNode): string {
  if (node.type === "permanent") return "permanent";
  if (
    node.category === "记忆包" ||
    node.category === "pack" ||
    node.category === "bundle"
  )
    return "pack";
  return "temporary";
}

function isFileNode(node: MemoryNode): boolean {
  return node.category === "file" || node.category === "文件";
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
    () => nodes.filter((n) => !isFileNode(n)),
    [nodes],
  );

  const filteredNodes = useMemo(() => {
    let result = memoryNodes;

    // Apply category filter
    if (activeFilter !== "all") {
      const categories = FILTER_CATEGORIES[activeFilter];
      result = result.filter((n) =>
        categories.some(
          (cat) => n.category.toLowerCase() === cat.toLowerCase(),
        ),
      );
    }

    // Apply search
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

  const filters: { key: FilterKey; labelKey: string }[] = [
    { key: "all", labelKey: "memory.filterAll" },
    { key: "personal", labelKey: "memory.filterPersonal" },
    { key: "knowledge", labelKey: "memory.filterKnowledge" },
    { key: "preference", labelKey: "memory.filterPreference" },
    { key: "pack", labelKey: "memory.filterPack" },
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
                <span className="memory-list-category">{node.category || node.type}</span>
                <span className="memory-list-time">
                  {formatRelativeTime(node.updated_at, t)}
                </span>
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
                  {selectedNode.category || selectedNode.type}
                </span>
                <span className="memory-detail-type-badge">
                  {selectedNode.type === "permanent" ? "permanent" : "temporary"}
                </span>
              </div>
              <div className="memory-detail-time">
                {t("memory.created")}: {formatRelativeTime(selectedNode.created_at, t)}
                {" · "}
                {t("memory.updated")}: {formatRelativeTime(selectedNode.updated_at, t)}
              </div>
            </div>

            <div className="memory-detail-body">
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
