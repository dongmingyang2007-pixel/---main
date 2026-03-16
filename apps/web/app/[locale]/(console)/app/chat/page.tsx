"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Project {
  id: string;
  name: string;
}

interface Conversation {
  id: string;
  title: string;
  project_id: string;
  updated_at: string;
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}小时前`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 30) return `${diffDays}天前`;
    return d.toLocaleDateString("zh-CN");
  } catch {
    return dateStr;
  }
}

export default function ChatPage() {
  const t = useTranslations("console-chat");

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // Load projects
  useEffect(() => {
    apiGet<Project[]>("/api/v1/projects")
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data[0].id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load conversations when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setConversations([]);
      setActiveConversationId(null);
      return;
    }

    let cancelled = false;
    setLoadingConversations(true);

    apiGet<Conversation[]>(
      `/api/v1/chat/conversations?project_id=${selectedProjectId}`,
    )
      .then((data) => {
        if (!cancelled) {
          setConversations(data);
          // Auto-select first conversation if available
          if (data.length > 0) {
            setActiveConversationId(data[0].id);
          } else {
            setActiveConversationId(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([]);
          setActiveConversationId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConversations(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  // Create new conversation
  const handleNewConversation = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const conv = await apiPost<Conversation>("/api/v1/chat/conversations", {
        project_id: selectedProjectId,
      });
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
    } catch {
      // silently fail
    }
  }, [selectedProjectId]);

  // Delete conversation
  const handleDeleteConversation = useCallback(
    async (convId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(t("confirmDelete"))) return;
      try {
        await apiDelete(`/api/v1/chat/conversations/${convId}`);
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (activeConversationId === convId) {
          setActiveConversationId(null);
        }
      } catch {
        // silently fail
      }
    },
    [activeConversationId, t],
  );

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <div className="chat-page-layout">
            {/* Sidebar */}
            <div className="chat-sidebar">
              <div className="chat-sidebar-header">
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  {projects.length === 0 && (
                    <option value="">{t("selectAssistant")}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="chat-sidebar-list">
                {loadingConversations && (
                  <div className="chat-sidebar-empty">...</div>
                )}

                {!loadingConversations && conversations.length === 0 && (
                  <div className="chat-sidebar-empty">
                    {t("noConversations")}
                  </div>
                )}

                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`chat-sidebar-item${activeConversationId === conv.id ? " is-active" : ""}`}
                    onClick={() => setActiveConversationId(conv.id)}
                  >
                    <div className="chat-sidebar-item-info">
                      <div className="chat-sidebar-item-title">
                        {conv.title || t("newConversation")}
                      </div>
                      <div className="chat-sidebar-item-time">
                        {formatTime(conv.updated_at)}
                      </div>
                    </div>
                    <button
                      className="chat-sidebar-item-delete"
                      onClick={(e) =>
                        void handleDeleteConversation(conv.id, e)
                      }
                      title={t("deleteConversation")}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>

              <div className="chat-sidebar-footer">
                <button
                  className="chat-sidebar-new"
                  onClick={() => void handleNewConversation()}
                  disabled={!selectedProjectId}
                >
                  + {t("newConversation")}
                </button>
              </div>
            </div>

            {/* Main chat area */}
            <div className="chat-main">
              <ChatInterface conversationId={activeConversationId} />
            </div>
          </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
