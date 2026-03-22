"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useProjectContext } from "@/lib/ProjectContext";
import { isOrdinaryMemoryNode, useGraphData } from "@/hooks/useGraphData";
import MemoryGraph from "@/components/console/graph/MemoryGraph";
import MemoryListView from "@/components/console/MemoryListView";

type ViewMode = "graph" | "list";

export default function MemoryPage() {
  const t = useTranslations("console");
  const { projectId, projects } = useProjectContext();
  const [view, setView] = useState<ViewMode>("graph");

  const {
    data,
    loading,
    createMemory,
    updateMemory,
    deleteMemory,
    promoteMemory,
    createEdge,
    deleteEdge,
    attachFileToMemory,
    detachFileFromMemory,
  } = useGraphData(projectId);

  const memoryCount = data.nodes.filter((node) => isOrdinaryMemoryNode(node)).length;
  const assistantName =
    projects.find((project) => project.id === projectId)?.name || t("memory.title");

  if (!projectId) {
    return (
      <div className="memory-page">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-secondary)",
            fontSize: "14px",
          }}
        >
          {t("memory.noProject")}
        </div>
      </div>
    );
  }

  const handleExport = () => {
    const exportData = {
      memories: data.nodes.filter((node) => isOrdinaryMemoryNode(node)),
      edges: data.edges,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.content) {
              await createMemory(item.content, item.category || "");
            }
          }
        }
      } catch {
        // silently handle parse errors
      }
    };
    input.click();
  };

  const handleNewMemory = async () => {
    const content = window.prompt("输入记忆内容：");
    if (!content?.trim()) return;
    await createMemory(content.trim(), "");
  };

  const handleCreateMemoryFromGraph = async (content: string, category?: string) => {
    await createMemory(content, category);
  };

  const glassBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 9999,
    border: "1px solid var(--console-border, var(--border))",
    background: "var(--console-surface, rgba(255,255,255,0.06))",
    color: "var(--console-text-secondary, var(--text-secondary))",
    cursor: "pointer",
    transition: "all 0.15s ease",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  };

  const glassBtnPrimary: React.CSSProperties = {
    ...glassBtn,
    background: "linear-gradient(135deg, var(--console-accent, var(--accent)), color-mix(in srgb, var(--console-accent, var(--accent)) 80%, white))",
    color: "#fff",
    border: "1px solid transparent",
  };

  const viewBtnBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s ease",
    background: "transparent",
    color: "var(--console-text-secondary, var(--text-secondary))",
  };

  const viewBtnActive: React.CSSProperties = {
    ...viewBtnBase,
    background: "linear-gradient(135deg, var(--console-accent, var(--accent)), color-mix(in srgb, var(--console-accent, var(--accent)) 80%, white))",
    color: "#fff",
  };

  return (
    <motion.div
      className="memory-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── Top bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: "1px solid var(--console-border, var(--border))",
        background: "var(--console-surface, rgba(255,255,255,0.03))",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        flexWrap: "wrap",
        gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--console-text-primary, var(--text-primary))",
          }}>{t("memory.title")}</span>
          {!loading && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: "var(--console-surface, rgba(255,255,255,0.06))",
              border: "1px solid var(--console-border, var(--border))",
              color: "var(--console-text-secondary, var(--text-secondary))",
            }}>
              {memoryCount}
              {t("memory.countUnit")}
            </span>
          )}
          <div style={{
            display: "flex",
            borderRadius: 9999,
            overflow: "hidden",
            border: "1px solid var(--console-border, var(--border))",
          }}>
            <button
              type="button"
              onClick={() => setView("graph")}
              style={view === "graph" ? viewBtnActive : viewBtnBase}
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
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="19" r="3" />
                <circle cx="19" cy="19" r="3" />
                <line x1="12" y1="8" x2="5" y2="16" />
                <line x1="12" y1="8" x2="19" y2="16" />
              </svg>
              {t("memory.viewGraph")}
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              style={view === "list" ? viewBtnActive : viewBtnBase}
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
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              {t("memory.viewList")}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            style={glassBtn}
            onClick={handleExport}
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("memory.export")}
          </button>
          <button
            type="button"
            style={glassBtn}
            onClick={handleImport}
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t("memory.import")}
          </button>
          <button
            type="button"
            style={glassBtnPrimary}
            onClick={() => void handleNewMemory()}
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("memory.new")}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="memory-content">
        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            Loading...
          </div>
        ) : view === "graph" ? (
          <MemoryGraph
            nodes={data.nodes}
            edges={data.edges}
            assistantName={assistantName}
            onNodeSelect={() => {}}
            onCreateMemory={handleCreateMemoryFromGraph}
            onUpdateMemory={updateMemory}
            onDeleteMemory={deleteMemory}
            onPromoteMemory={promoteMemory}
            onCreateEdge={createEdge}
            onDeleteEdge={deleteEdge}
            onAttachFile={async (memoryId, dataItemId) => { await attachFileToMemory(memoryId, dataItemId); }}
            onDetachFile={detachFileFromMemory}
          />
        ) : (
          <MemoryListView
            nodes={data.nodes}
            onUpdateMemory={updateMemory}
            onDeleteMemory={deleteMemory}
          />
        )}
      </div>
    </motion.div>
  );
}
