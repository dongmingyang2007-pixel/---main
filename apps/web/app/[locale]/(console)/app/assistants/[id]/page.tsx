"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { CanvasWorkbench } from "@/components/console/canvas/CanvasWorkbench";
import MemoryGraph from "@/components/console/graph/MemoryGraph";
import { useGraphData, type MemoryNode } from "@/hooks/useGraphData";
import { Link } from "@/i18n/navigation";

type TabKey = "graph" | "config";

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");

  const [activeTab, setActiveTab] = useState<TabKey>("graph");
  const [, setSelectedNode] = useState<MemoryNode | null>(null);

  const {
    data,
    loading,
    createMemory,
    updateMemory,
    deleteMemory,
    promoteMemory,
    createEdge,
    deleteEdge,
  } = useGraphData(projectId);

  const handleNodeSelect = useCallback((node: MemoryNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleCreateMemory = useCallback(
    async (content: string, category?: string) => {
      await createMemory(content, category);
    },
    [createMemory],
  );

  const handleUpdateMemory = useCallback(
    async (id: string, updates: Partial<MemoryNode>) => {
      await updateMemory(id, updates);
    },
    [updateMemory],
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      await deleteMemory(id);
    },
    [deleteMemory],
  );

  const handlePromoteMemory = useCallback(
    async (id: string) => {
      await promoteMemory(id);
    },
    [promoteMemory],
  );

  const handleCreateEdge = useCallback(
    async (sourceId: string, targetId: string) => {
      await createEdge(sourceId, targetId);
    },
    [createEdge],
  );

  const handleDeleteEdge = useCallback(
    async (id: string) => {
      await deleteEdge(id);
    },
    [deleteEdge],
  );

  return (
    <PanelLayout>
      <PageTransition>
        <div className="assistant-detail">
          {/* Top bar with tabs */}
          <div className="assistant-detail-topbar">
            <div className="assistant-detail-tabs">
              <button
                type="button"
                className={`assistant-detail-tab${activeTab === "graph" ? " is-active" : ""}`}
                onClick={() => setActiveTab("graph")}
              >
                {t("graph.tab")}
              </button>
              <button
                type="button"
                className={`assistant-detail-tab${activeTab === "config" ? " is-active" : ""}`}
                onClick={() => setActiveTab("config")}
              >
                {t("config.tab")}
              </button>
            </div>

            <Link href="/app/chat" className="assistant-detail-try-chat">
              {t("canvas.tryChat")}
            </Link>
          </div>

          {/* Tab content */}
          <div className="assistant-detail-content">
            {activeTab === "graph" && (
              <div className="assistant-detail-graph">
                {loading ? (
                  <div className="assistant-detail-loading">...</div>
                ) : (
                  <MemoryGraph
                    nodes={data.nodes}
                    edges={data.edges}
                    onNodeSelect={handleNodeSelect}
                    onCreateMemory={handleCreateMemory}
                    onUpdateMemory={handleUpdateMemory}
                    onDeleteMemory={handleDeleteMemory}
                    onPromoteMemory={handlePromoteMemory}
                    onCreateEdge={handleCreateEdge}
                    onDeleteEdge={handleDeleteEdge}
                  />
                )}
              </div>
            )}

            {activeTab === "config" && (
              <div className="p-6">
                <CanvasWorkbench assistantId={projectId} />
              </div>
            )}
          </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
