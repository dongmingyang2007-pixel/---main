"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useProjectContext } from "@/lib/ProjectContext";
import { isOrdinaryMemoryNode, useGraphData } from "@/hooks/useGraphData";
import MemoryGraph from "@/components/console/graph/MemoryGraph";
import MemoryListView from "@/components/console/MemoryListView";

type ViewMode = "workbench" | "orbit" | "list";

const VIEW_ORDER: ViewMode[] = ["workbench", "orbit", "list"];

export default function MemoryPage() {
  const t = useTranslations("console");
  const { projectId, projects } = useProjectContext();
  const [view, setView] = useState<ViewMode>("workbench");

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
  } = useGraphData(projectId, { includeTemporary: true });

  const memoryNodes = useMemo(
    () => data.nodes.filter((node) => isOrdinaryMemoryNode(node)),
    [data.nodes],
  );
  const memoryCount = memoryNodes.length;
  const assistantName =
    projects.find((project) => project.id === projectId)?.name ||
    t("memory.title");

  const updateView = useCallback(
    (nextView: ViewMode) =>
      setView((current) => (current === nextView ? current : nextView)),
    [],
  );

  const handleViewSwitchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentView: ViewMode) => {
      const currentIndex = VIEW_ORDER.indexOf(currentView);
      if (currentIndex < 0) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        updateView(VIEW_ORDER[(currentIndex + 1) % VIEW_ORDER.length]);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateView(
          VIEW_ORDER[
            (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
          ],
        );
      } else if (event.key === "Home") {
        event.preventDefault();
        updateView(VIEW_ORDER[0]);
      } else if (event.key === "End") {
        event.preventDefault();
        updateView(VIEW_ORDER[VIEW_ORDER.length - 1]);
      }
    },
    [updateView],
  );

  const viewOptions: Array<{
    key: ViewMode;
    label: string;
    icon: ReactNode;
  }> = [
    {
      key: "workbench",
      label: t("memory.viewWorkbench"),
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      ),
    },
    {
      key: "orbit",
      label: t("memory.viewOrbit"),
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="2.5" />
          <path d="M4 12a8 4 0 1 0 16 0a8 4 0 1 0-16 0" />
          <path d="M12 4a4 8 0 1 1 0 16a4 8 0 1 1 0-16" />
        </svg>
      ),
    },
    {
      key: "list",
      label: t("memory.viewList"),
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      ),
    },
  ];

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
    const content = window.prompt(t("memory.newPrompt"));
    if (!content?.trim()) return;
    await createMemory(content.trim(), "");
  };

  const handleCreateMemoryFromGraph = async (
    content: string,
    category?: string,
  ) => {
    await createMemory(content, category);
  };

  return (
    <motion.div
      className="memory-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="memory-workspace-bar">
        <div className="memory-workspace-bar-left">
          <h1 className="memory-workspace-title">{t("memory.title")}</h1>
          {!loading ? (
            <span className="memory-workspace-count">
              {memoryCount}
              {t("memory.countUnit")}
            </span>
          ) : null}
          <span className="memory-workspace-assistant">{assistantName}</span>
        </div>

        <div className="memory-workspace-bar-right">
          <div
            className="memory-mode-switch"
            role="toolbar"
            aria-label={t("memory.title")}
          >
            {viewOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`memory-mode-btn${view === option.key ? " is-active" : ""}`}
                aria-pressed={view === option.key}
                onClick={() => updateView(option.key)}
                onKeyDown={(event) =>
                  handleViewSwitchKeyDown(event, option.key)
                }
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <div className="memory-topbar-actions">
            <button
              type="button"
              className="memory-action-btn"
              onClick={handleExport}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("memory.export")}
            </button>
            <button
              type="button"
              className="memory-action-btn"
              onClick={handleImport}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t("memory.import")}
            </button>
            <button
              type="button"
              className="memory-action-btn primary"
              onClick={() => void handleNewMemory()}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("memory.new")}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`memory-content${view === "list" ? " memory-content--list" : ""}`}
      >
        {loading ? (
          <div className="memory-loading-state">Loading...</div>
        ) : view === "list" ? (
          <MemoryListView
            nodes={data.nodes}
            onUpdateMemory={updateMemory}
            onDeleteMemory={deleteMemory}
          />
        ) : (
          <div className={`memory-graph-stage memory-graph-stage--${view}`}>
            <MemoryGraph
              nodes={data.nodes}
              edges={data.edges}
              assistantName={assistantName}
              renderMode={view === "orbit" ? "orbit" : "workbench"}
              onNodeSelect={() => {}}
              onCreateMemory={handleCreateMemoryFromGraph}
              onUpdateMemory={updateMemory}
              onDeleteMemory={deleteMemory}
              onPromoteMemory={promoteMemory}
              onCreateEdge={createEdge}
              onDeleteEdge={deleteEdge}
              onAttachFile={async (memoryId, dataItemId) => {
                await attachFileToMemory(memoryId, dataItemId);
              }}
              onDetachFile={detachFileFromMemory}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
