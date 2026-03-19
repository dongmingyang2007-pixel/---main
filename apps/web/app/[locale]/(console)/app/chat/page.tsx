"use client";

import { Suspense, useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { buildProjectDisplayMap } from "@/lib/project-display";
import { useProjectSelection } from "@/lib/useProjectSelection";
import { useModal } from "@/components/ui/modal-dialog";

interface Conversation {
  id: string;
  title: string;
  project_id: string;
  updated_at: string;
}

interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

type ConversationSummary = {
  title: string;
  preview: string;
};

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "thisWeek";
  return "earlier";
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

function normalizeConversationText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function summarizeConversationText(content: string, maxLength = 26): string {
  const normalized = normalizeConversationText(content);
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized;
}

function isMeaningfulConversationTitle(
  title: string,
  fallbackTitle: string,
  timeLabel: string,
): boolean {
  const normalized = title.trim();
  if (!normalized) {
    return false;
  }
  if (
    normalized === fallbackTitle ||
    normalized === timeLabel ||
    normalized === "New Conversation"
  ) {
    return false;
  }
  return true;
}

function ChatPageContent() {
  const t = useTranslations("console-chat");
  const modal = useModal();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project_id") || "";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [conversationSummaries, setConversationSummaries] = useState<
    Record<string, ConversationSummary>
  >({});

  const loadConversations = useCallback(async (projectId: string) => {
    if (!projectId) {
      setConversations([]);
      setActiveConversationId(null);
      return;
    }

    setLoadingConversations(true);
    try {
      const data = await apiGet<Conversation[]>(
        `/api/v1/chat/conversations?project_id=${projectId}`,
      );
      const list = Array.isArray(data) ? data : [];
      setConversations(list);
      setConversationSummaries((prev) => {
        const next: Record<string, ConversationSummary> = {};
        list.forEach((conversation) => {
          if (prev[conversation.id]) {
            next[conversation.id] = prev[conversation.id];
          }
        });
        return next;
      });
      setActiveConversationId((current) =>
        current && list.some((conversation) => conversation.id === current)
          ? current
          : (list[0]?.id ?? null),
      );
    } catch {
      setConversations([]);
      setActiveConversationId(null);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const {
    projectId: selectedProjectId,
    projects,
    selectProject,
  } = useProjectSelection(loadConversations);
  const projectLabels = useMemo(() => buildProjectDisplayMap(projects), [projects]);

  useEffect(() => {
    if (conversations.length === 0) {
      setConversationSummaries({});
      return;
    }

    let cancelled = false;
    const fallbackTitle = t("newConversation");
    const targets = conversations.filter((conversation) => {
      const timeLabel = formatTime(conversation.updated_at);
      return !isMeaningfulConversationTitle(
        conversation.title,
        fallbackTitle,
        timeLabel,
      );
    });

    if (targets.length === 0) {
      return;
    }

    void Promise.all(
      targets.map(async (conversation) => {
        const messages = await apiGet<ApiMessage[]>(
          `/api/v1/chat/conversations/${conversation.id}/messages`,
        ).catch(() => []);
        const list = Array.isArray(messages) ? messages : [];
        const firstMessage =
          list.find(
            (message) =>
              message.role === "user" &&
              normalizeConversationText(message.content).length > 0,
          ) ||
          list.find(
            (message) => normalizeConversationText(message.content).length > 0,
          );
        const preview = summarizeConversationText(firstMessage?.content || "");
        return [
          conversation.id,
          {
            title: preview || fallbackTitle,
            preview,
          },
        ] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setConversationSummaries((prev) => ({
        ...prev,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [conversations, t]);

  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === selectedProjectId) {
      return;
    }
    if (!projects.some((project) => project.id === requestedProjectId)) {
      return;
    }
    void selectProject(requestedProjectId);
  }, [projects, requestedProjectId, selectProject, selectedProjectId]);

  // Create new conversation
  const handleNewConversation = useCallback(async () => {
    if (!selectedProjectId || creatingConversation) return;
    setCreatingConversation(true);
    try {
      const conv = await apiPost<Conversation>("/api/v1/chat/conversations", {
        project_id: selectedProjectId,
      });
      setConversations((prev) => [conv, ...prev]);
      setConversationSummaries((prev) => ({
        ...prev,
        [conv.id]: {
          title: t("newConversation"),
          preview: "",
        },
      }));
      setActiveConversationId(conv.id);
    } catch {
      // silently fail
    } finally {
      setCreatingConversation(false);
    }
  }, [creatingConversation, selectedProjectId, t]);

  // Delete conversation
  const handleDeleteConversation = useCallback(
    async (convId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!(await modal.confirm(t("confirmDelete")))) return;
      try {
        await apiDelete(`/api/v1/chat/conversations/${convId}`);
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== convId);
          if (activeConversationId === convId) {
            setActiveConversationId(next[0]?.id ?? null);
          }
          return next;
        });
        setConversationSummaries((prev) => {
          const next = { ...prev };
          delete next[convId];
          return next;
        });
      } catch {
        // silently fail
      }
    },
    [activeConversationId, modal, t],
  );

  const handleConversationActivity = useCallback(
    ({ conversationId, previewText }: { conversationId: string; previewText: string }) => {
      const preview = summarizeConversationText(previewText);
      const now = new Date().toISOString();

      setConversationSummaries((prev) => {
        const current = prev[conversationId];
        return {
          ...prev,
          [conversationId]: {
            title: current?.title || preview || t("newConversation"),
            preview,
          },
        };
      });

      setConversations((prev) => {
        const current = prev.find((conversation) => conversation.id === conversationId);
        if (!current) {
          return prev;
        }
        return [
          {
            ...current,
            updated_at: now,
          },
          ...prev.filter((conversation) => conversation.id !== conversationId),
        ];
      });
    },
    [t],
  );

  const getConversationTitle = useCallback(
    (conversation: Conversation) => {
      const timeLabel = formatTime(conversation.updated_at);
      if (
        isMeaningfulConversationTitle(
          conversation.title,
          t("newConversation"),
          timeLabel,
        )
      ) {
        return conversation.title.trim();
      }
      return conversationSummaries[conversation.id]?.title || t("newConversation");
    },
    [conversationSummaries, t],
  );

  const getConversationMeta = useCallback(
    (conversation: Conversation) => {
      const timeLabel = formatTime(conversation.updated_at);
      const summary = conversationSummaries[conversation.id];
      const title = getConversationTitle(conversation);
      if (summary?.preview && summary.preview !== title) {
        return `${summary.preview} · ${timeLabel}`;
      }
      return timeLabel;
    },
    [conversationSummaries, getConversationTitle],
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
                  onChange={(e) => {
                    void selectProject(e.target.value);
                  }}
                >
                  {projects.length === 0 && (
                    <option value="">{t("selectAssistant")}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {projectLabels.get(p.id) || p.name}
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

                {(() => {
                  const dateGroupKeys = ["today", "yesterday", "thisWeek", "earlier"] as const;
                  const dateGroupLabels: Record<string, string> = {
                    today: t("dateGroup.today"),
                    yesterday: t("dateGroup.yesterday"),
                    thisWeek: t("dateGroup.thisWeek"),
                    earlier: t("dateGroup.earlier"),
                  };
                  const grouped = new Map<string, Conversation[]>();
                  for (const key of dateGroupKeys) grouped.set(key, []);
                  for (const conv of conversations) {
                    const group = getDateGroup(conv.updated_at);
                    grouped.get(group)!.push(conv);
                  }
                  return dateGroupKeys.map((groupKey) => {
                    const items = grouped.get(groupKey)!;
                    if (items.length === 0) return null;
                    return (
                      <div key={groupKey}>
                        <div className="chat-date-group">{dateGroupLabels[groupKey]}</div>
                        {items.map((conv) => (
                          <div
                            key={conv.id}
                            className={`chat-sidebar-item${activeConversationId === conv.id ? " is-active" : ""}`}
                            onClick={() => setActiveConversationId(conv.id)}
                          >
                            <div className="chat-sidebar-item-info">
                              <div className="chat-sidebar-item-title">
                                {getConversationTitle(conv)}
                              </div>
                              <div className="chat-sidebar-item-time">
                                {getConversationMeta(conv)}
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
                    );
                  });
                })()}
              </div>

              <div className="chat-sidebar-footer">
                <button
                  className="chat-sidebar-new"
                  onClick={() => void handleNewConversation()}
                  disabled={!selectedProjectId || creatingConversation}
                >
                  + {creatingConversation ? t("creatingConversation") : t("newConversation")}
                </button>
              </div>
            </div>

            {/* Main chat area */}
            <div className="chat-main">
              <ChatInterface
                key={activeConversationId ?? "no-conversation"}
                conversationId={activeConversationId}
                projectId={selectedProjectId}
                onConversationActivity={handleConversationActivity}
              />
            </div>
          </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <PanelLayout>
          <PageTransition>
            <div className="p-6">
              <div className="console-empty">...</div>
            </div>
          </PageTransition>
        </PanelLayout>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
