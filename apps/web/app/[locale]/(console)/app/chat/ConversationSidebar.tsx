"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-time";
import { useProjectSelection } from "@/lib/useProjectSelection";
import { useModal } from "@/components/ui/modal-dialog";

/* ── Types ──────────────────────────────────────── */

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

export interface ConversationSidebarHandle {
  handleConversationActivity: (payload: { conversationId: string; previewText: string }) => void;
}

export interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onProjectChange: (projectId: string) => void;
  requestedProjectId?: string;
  requestedConvId?: string;
  handleRef?: React.MutableRefObject<ConversationSidebarHandle | null>;
}

/* ── Helpers ─────────────────────────────────────── */

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

function normalizeConversationText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function summarizeConversationText(content: string, maxLength = 26): string {
  const normalized = normalizeConversationText(content);
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}\u2026`
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

/* ── Component ───────────────────────────────────── */

export function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onProjectChange,
  requestedProjectId,
  requestedConvId,
  handleRef,
}: ConversationSidebarProps) {
  const t = useTranslations("console-chat");
  const modal = useModal();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [loadedConversationProjectId, setLoadedConversationProjectId] = useState("");
  const [conversationSummaries, setConversationSummaries] = useState<
    Record<string, ConversationSummary>
  >({});
  const [search, setSearch] = useState("");
  const conversationsRequestSeq = useRef(0);

  // Stable ref to onSelectConversation to avoid re-creating loadConversations
  const onSelectRef = useRef(onSelectConversation);
  onSelectRef.current = onSelectConversation;
  const activeIdRef = useRef(activeConversationId);
  activeIdRef.current = activeConversationId;

  /* ── Load conversations ──────────────────────── */

  const loadConversations = useCallback(async (projectId: string) => {
    const requestSeq = conversationsRequestSeq.current + 1;
    conversationsRequestSeq.current = requestSeq;

    if (!projectId) {
      setConversations([]);
      onSelectRef.current(null);
      setLoadedConversationProjectId("");
      setLoadingConversations(false);
      return;
    }

    setLoadedConversationProjectId("");
    setLoadingConversations(true);
    try {
      const data = await apiGet<Conversation[]>(
        `/api/v1/chat/conversations?project_id=${projectId}`,
      );
      if (requestSeq !== conversationsRequestSeq.current) {
        return;
      }
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
      const current = activeIdRef.current;
      onSelectRef.current(
        current && list.some((c) => c.id === current)
          ? current
          : (list[0]?.id ?? null),
      );
    } catch {
      if (requestSeq !== conversationsRequestSeq.current) {
        return;
      }
      setConversations([]);
      onSelectRef.current(null);
    } finally {
      if (requestSeq !== conversationsRequestSeq.current) {
        return;
      }
      setLoadingConversations(false);
      setLoadedConversationProjectId(projectId);
    }
  }, []);

  const {
    projectId: selectedProjectId,
    projects,
    selectProject,
  } = useProjectSelection(loadConversations);

  // Notify parent of project changes
  const prevProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== prevProjectIdRef.current) {
      onProjectChange(selectedProjectId);
    }
    prevProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId, onProjectChange]);

  // URL param sync: project_id
  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === selectedProjectId) {
      return;
    }
    if (projects.length === 0) {
      void selectProject(requestedProjectId);
      return;
    }
    if (!projects.some((project) => project.id === requestedProjectId)) {
      return;
    }
    void selectProject(requestedProjectId);
  }, [projects, requestedProjectId, selectProject, selectedProjectId]);

  // URL param sync: conv
  useEffect(() => {
    if (!requestedConvId) return;
    if (conversations.some((c) => c.id === requestedConvId)) {
      onSelectConversation(requestedConvId);
    }
  }, [requestedConvId, conversations, onSelectConversation]);

  /* ── Fetch summaries for untitled conversations ── */

  useEffect(() => {
    if (conversations.length === 0) {
      setConversationSummaries({});
      return;
    }

    let cancelled = false;
    const fallbackTitle = t("newConversation");
    const targets = conversations.filter((conversation) => {
      const timeLabel = formatRelativeTime(conversation.updated_at, t);
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
      setConversationSummaries((prev) => {
        const next = { ...prev };
        for (const [conversationId, summary] of entries) {
          const current = prev[conversationId];
          if (current?.preview && !summary.preview) {
            next[conversationId] = current;
            continue;
          }
          next[conversationId] = summary;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [conversations, t]);

  /* ── New conversation ────────────────────────── */

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
      onSelectConversation(conv.id);
    } catch {
      // silently fail
    } finally {
      setCreatingConversation(false);
    }
  }, [creatingConversation, onSelectConversation, selectedProjectId, t]);

  /* ── Auto-create first conversation ──────────── */

  useEffect(() => {
    if (!selectedProjectId || loadingConversations || creatingConversation) {
      return;
    }
    if (loadedConversationProjectId !== selectedProjectId) {
      return;
    }
    if (
      requestedProjectId &&
      requestedProjectId !== selectedProjectId &&
      projects.some((project) => project.id === requestedProjectId)
    ) {
      return;
    }
    if (activeConversationId || conversations.length > 0) {
      return;
    }
    void handleNewConversation();
  }, [
    activeConversationId,
    conversations.length,
    creatingConversation,
    handleNewConversation,
    loadedConversationProjectId,
    loadingConversations,
    projects,
    requestedProjectId,
    selectedProjectId,
  ]);

  /* ── Delete conversation ─────────────────────── */

  const handleDeleteConversation = useCallback(
    async (convId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!(await modal.confirm(t("confirmDelete")))) return;
      try {
        await apiDelete(`/api/v1/chat/conversations/${convId}`);
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== convId);
          if (activeConversationId === convId) {
            onSelectConversation(next[0]?.id ?? null);
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
    [activeConversationId, modal, onSelectConversation, t],
  );

  /* ── Conversation activity (exposed via handleRef) ── */

  const handleConversationActivity = useCallback(
    ({ conversationId, previewText }: { conversationId: string; previewText: string }) => {
      const preview = summarizeConversationText(previewText);
      const now = new Date().toISOString();
      const fallbackTitle = t("newConversation");

      setConversationSummaries((prev) => {
        const current = prev[conversationId];
        const nextTitle = current?.title && isMeaningfulConversationTitle(
          current.title,
          fallbackTitle,
          "",
        )
          ? current.title
          : preview || fallbackTitle;
        return {
          ...prev,
          [conversationId]: {
            title: nextTitle,
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

  // Expose imperative handle so parent can forward conversation activity
  useEffect(() => {
    if (handleRef) {
      handleRef.current = { handleConversationActivity };
    }
  }, [handleConversationActivity, handleRef]);

  /* ── Display helpers ─────────────────────────── */

  const getConversationTitle = useCallback(
    (conversation: Conversation) => {
      const timeLabel = formatRelativeTime(conversation.updated_at, t);
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
      const timeLabel = formatRelativeTime(conversation.updated_at, t);
      const summary = conversationSummaries[conversation.id];
      const title = getConversationTitle(conversation);
      if (summary?.preview && summary.preview !== title) {
        return `${summary.preview} \u00B7 ${timeLabel}`;
      }
      return timeLabel;
    },
    [conversationSummaries, getConversationTitle, t],
  );

  /* ── Render ──────────────────────────────────── */

  return (
    <div className="chat-sidebar">
      <div className="chat-search">
        <input
          type="text"
          className="chat-search-input"
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
          const filtered = conversations.filter(
            (c) => !search || getConversationTitle(c).toLowerCase().includes(search.toLowerCase()),
          );
          const dateGroupKeys = ["today", "yesterday", "thisWeek", "earlier"] as const;
          const dateGroupLabels: Record<string, string> = {
            today: t("dateGroup.today"),
            yesterday: t("dateGroup.yesterday"),
            thisWeek: t("dateGroup.thisWeek"),
            earlier: t("dateGroup.earlier"),
          };
          const grouped = new Map<string, Conversation[]>();
          for (const key of dateGroupKeys) grouped.set(key, []);
          for (const conv of filtered) {
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
                    onClick={() => onSelectConversation(conv.id)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectConversation(conv.id);
                      }
                    }}
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
  );
}
