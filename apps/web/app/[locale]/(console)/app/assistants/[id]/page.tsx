"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { CanvasWorkbench } from "@/components/console/canvas/CanvasWorkbench";
import MemoryGraph from "@/components/console/graph/MemoryGraph";
import { useGraphData, type MemoryNode } from "@/hooks/useGraphData";
import { Link } from "@/i18n/navigation";
import { apiGet, apiPost } from "@/lib/api";

type TabKey = "graph" | "config";

interface ConversationItem {
  id: string;
  title: string;
  updated_at: string;
}

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");
  const tChat = useTranslations("console-chat");

  const [activeTab, setActiveTab] = useState<TabKey>("graph");
  const [, setSelectedNode] = useState<MemoryNode | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [loadingConversations, setLoadingConversations] = useState(false);

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
  } = useGraphData(projectId, activeConversationId || undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      setLoadingConversations(true);
      try {
        const result = await apiGet<ConversationItem[]>(
          `/api/v1/chat/conversations?project_id=${projectId}`,
        );
        if (cancelled) {
          return;
        }
        const list = Array.isArray(result) ? result : [];
        setConversations(list);
        setActiveConversationId((current) => {
          if (current && list.some((conversation) => conversation.id === current)) {
            return current;
          }
          return list[0]?.id || "";
        });
      } catch {
        if (!cancelled) {
          setConversations([]);
          setActiveConversationId("");
        }
      } finally {
        if (!cancelled) {
          setLoadingConversations(false);
        }
      }
    }

    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleCreateConversation = useCallback(async () => {
    try {
      const conversation = await apiPost<ConversationItem>("/api/v1/chat/conversations", {
        project_id: projectId,
      });
      setConversations((prev) => [conversation, ...prev]);
      setActiveConversationId(conversation.id);
    } catch {
      // Ignore creation errors in the graph view.
    }
  }, [projectId]);

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

  const handleAttachFile = useCallback(
    async (memoryId: string, dataItemId: string) => {
      await attachFileToMemory(memoryId, dataItemId);
    },
    [attachFileToMemory],
  );

  const handleDetachFile = useCallback(
    async (memoryFileId: string) => {
      await detachFileFromMemory(memoryFileId);
    },
    [detachFileFromMemory],
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

            <Link href={`/app/chat?project_id=${projectId}`} className="assistant-detail-try-chat">
              {t("canvas.tryChat")}
            </Link>
          </div>

          {/* Tab content */}
          <div className="assistant-detail-content">
            {activeTab === "graph" && (
              <div className="assistant-detail-graph">
                <div className="assistant-detail-topbar">
                  <div className="assistant-detail-tabs">
                    <select
                      value={activeConversationId}
                      onChange={(event) => setActiveConversationId(event.target.value)}
                      disabled={loadingConversations}
                    >
                      <option value="">{t("graph.permanentOnly")}</option>
                      {conversations.map((conversation) => (
                        <option key={conversation.id} value={conversation.id}>
                          {conversation.title || tChat("newConversation")}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="assistant-detail-tab"
                      onClick={() => void handleCreateConversation()}
                    >
                      + {tChat("newConversation")}
                    </button>
                  </div>
                </div>
                {loading ? (
                  <div className="assistant-detail-loading">...</div>
                ) : (
                  <MemoryGraph
                    nodes={data.nodes}
                    edges={data.edges}
                    onNodeSelect={handleNodeSelect}
                    onCenterNodeClick={() => setActiveTab("config")}
                    onCreateMemory={handleCreateMemory}
                    onUpdateMemory={handleUpdateMemory}
                    onDeleteMemory={handleDeleteMemory}
                    onPromoteMemory={handlePromoteMemory}
                    onCreateEdge={handleCreateEdge}
                    onDeleteEdge={handleDeleteEdge}
                    onAttachFile={handleAttachFile}
                    onDetachFile={handleDetachFile}
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
