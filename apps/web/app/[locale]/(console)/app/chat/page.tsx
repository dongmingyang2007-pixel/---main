"use client";

import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-time";
import { buildProjectDisplayMap } from "@/lib/project-display";

type ProjectOption = {
  id: string;
  name: string;
};

type ConversationItem = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
};

type LoadedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

const GENERIC_CONVERSATION_TITLES = new Set([
  "",
  "new conversation",
  "新对话",
  "新建对话",
]);
const CONVERSATION_PREVIEW_MAX = 42;

function normalizeConversationPreview(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= CONVERSATION_PREVIEW_MAX) {
    return normalized;
  }
  return `${normalized.slice(0, CONVERSATION_PREVIEW_MAX - 1)}…`;
}

function isGenericConversationTitle(title: string): boolean {
  return GENERIC_CONVERSATION_TITLES.has(title.trim().toLowerCase());
}

function sortConversationsByUpdatedAt(items: ConversationItem[]): ConversationItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

function ChatPageContent() {
  const t = useTranslations("console-chat");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requestedProjectId = searchParams.get("project_id") || "";
  const requestedConversationId = searchParams.get("conv") || "";

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationSummaries, setConversationSummaries] = useState<Record<string, string>>({});
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [conversationLoadState, setConversationLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conversationId: string } | null>(null);

  const selectedProjectIdRef = useRef("");
  const conversationRequestSeqRef = useRef(0);
  const autoCreateProjectRef = useRef<string | null>(null);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const projectLabels = useMemo(
    () => buildProjectDisplayMap(projects),
    [projects],
  );

  const deferredSearch = useDeferredValue(searchQuery);

  const replaceChatUrl = useCallback(
    (projectId: string, conversationId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (projectId) {
        params.set("project_id", projectId);
      } else {
        params.delete("project_id");
      }
      if (conversationId) {
        params.set("conv", conversationId);
      } else {
        params.delete("conv");
      }

      const nextQuery = params.toString();
      const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      const currentQuery = searchParams.toString();
      const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;
      if (nextHref !== currentHref) {
        router.replace(nextHref);
      }
    },
    [pathname, router, searchParams],
  );

  const loadConversations = useCallback(async (projectId: string) => {
    if (!projectId) {
      setConversations([]);
      setConversationLoadState("idle");
      return [];
    }

    const requestId = conversationRequestSeqRef.current + 1;
    conversationRequestSeqRef.current = requestId;
    setConversationLoadState("loading");

    try {
      const data = await apiGet<ConversationItem[]>(
        `/api/v1/chat/conversations?project_id=${projectId}`,
      );
      if (conversationRequestSeqRef.current !== requestId) {
        return [];
      }
      const list = sortConversationsByUpdatedAt(Array.isArray(data) ? data : []);
      setConversations(list);
      setConversationLoadState("ready");
      return list;
    } catch {
      if (conversationRequestSeqRef.current === requestId) {
        setConversations([]);
        setConversationLoadState("error");
      }
      return [];
    }
  }, []);

  const createConversation = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        return null;
      }

      setIsCreatingConversation(true);
      try {
        const created = await apiPost<ConversationItem>("/api/v1/chat/conversations", {
          project_id: projectId,
          title: "",
        });
        if (!created || selectedProjectIdRef.current !== projectId) {
          return created;
        }

        setConversations((prev) =>
          sortConversationsByUpdatedAt([
            created,
            ...prev.filter((item) => item.id !== created.id),
          ]),
        );
        setActiveConversationId(created.id);
        replaceChatUrl(projectId, created.id);
        autoCreateProjectRef.current = projectId;
        return created;
      } catch {
        autoCreateProjectRef.current = null;
        return null;
      } finally {
        if (selectedProjectIdRef.current === projectId) {
          setIsCreatingConversation(false);
        }
      }
    },
    [replaceChatUrl],
  );

  useEffect(() => {
    let active = true;
    setLoadingProjects(true);

    void apiGet<{ items: ProjectOption[] }>("/api/v1/projects")
      .then((data) => {
        if (!active) {
          return;
        }
        const list = Array.isArray(data.items) ? data.items : [];
        setProjects(list);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setProjects([]);
      })
      .finally(() => {
        if (active) {
          setLoadingProjects(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingProjects) {
      return;
    }

    const availableProjectIds = new Set(projects.map((project) => project.id));
    const nextProjectId = availableProjectIds.has(requestedProjectId)
      ? requestedProjectId
      : projects[0]?.id ?? "";

    if (!nextProjectId) {
      setSelectedProjectId("");
      setActiveConversationId(null);
      setConversations([]);
      return;
    }

    if (nextProjectId !== selectedProjectId) {
      setSelectedProjectId(nextProjectId);
      setActiveConversationId(null);
      autoCreateProjectRef.current = null;
      return;
    }

    if (requestedProjectId !== nextProjectId) {
      replaceChatUrl(nextProjectId, activeConversationId);
    }
  }, [
    activeConversationId,
    loadingProjects,
    projects,
    replaceChatUrl,
    requestedProjectId,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (!selectedProjectId) {
      setConversations([]);
      setConversationLoadState("idle");
      setActiveConversationId(null);
      return;
    }

    void loadConversations(selectedProjectId);
  }, [loadConversations, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || conversationLoadState !== "ready") {
      return;
    }

    const availableConversationIds = new Set(
      conversations.map((conversation) => conversation.id),
    );

    if (
      requestedConversationId &&
      availableConversationIds.has(requestedConversationId)
    ) {
      if (activeConversationId !== requestedConversationId) {
        setActiveConversationId(requestedConversationId);
      }
      return;
    }

    if (
      activeConversationId &&
      availableConversationIds.has(activeConversationId)
    ) {
      if (requestedConversationId !== activeConversationId) {
        replaceChatUrl(selectedProjectId, activeConversationId);
      }
      return;
    }

    if (conversations.length > 0) {
      const nextConversationId = conversations[0]?.id ?? null;
      setActiveConversationId(nextConversationId);
      replaceChatUrl(selectedProjectId, nextConversationId);
      return;
    }

    if (!isCreatingConversation && autoCreateProjectRef.current !== selectedProjectId) {
      autoCreateProjectRef.current = selectedProjectId;
      void createConversation(selectedProjectId);
    }
  }, [
    activeConversationId,
    conversations,
    conversationLoadState,
    createConversation,
    isCreatingConversation,
    replaceChatUrl,
    requestedConversationId,
    selectedProjectId,
  ]);

  const handleProjectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextProjectId = event.target.value;
      if (!nextProjectId) {
        return;
      }

      if (nextProjectId === selectedProjectId) {
        void loadConversations(nextProjectId);
        return;
      }

      setSelectedProjectId(nextProjectId);
      setActiveConversationId(null);
      setConversations([]);
      setConversationLoadState("idle");
      setIsCreatingConversation(false);
      autoCreateProjectRef.current = null;
      replaceChatUrl(nextProjectId, null);
    },
    [loadConversations, replaceChatUrl, selectedProjectId],
  );

  const handleConversationSelect = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId);
      replaceChatUrl(selectedProjectId, conversationId);
    },
    [replaceChatUrl, selectedProjectId],
  );

  const handleConversationCreate = useCallback(() => {
    if (!selectedProjectId || isCreatingConversation) {
      return;
    }
    autoCreateProjectRef.current = selectedProjectId;
    void createConversation(selectedProjectId);
  }, [createConversation, isCreatingConversation, selectedProjectId]);

  const handleConversationActivity = useCallback(
    (payload: { conversationId: string; previewText: string }) => {
      const preview = normalizeConversationPreview(payload.previewText);
      if (preview) {
        setConversationSummaries((prev) => {
          if (prev[payload.conversationId] === preview) {
            return prev;
          }
          return {
            ...prev,
            [payload.conversationId]: preview,
          };
        });
      }

      const nowIso = new Date().toISOString();
      setConversations((prev) => {
        const current = prev.find(
          (conversation) => conversation.id === payload.conversationId,
        );
        if (!current) {
          return prev;
        }

        const updated: ConversationItem = {
          ...current,
          updated_at: nowIso,
        };
        return [updated, ...prev.filter((item) => item.id !== updated.id)];
      });
    },
    [],
  );

  const handleConversationLoaded = useCallback(
    (payload: { conversationId: string; messages: LoadedMessage[] }) => {
      const previewSource =
        payload.messages.find(
          (message) => message.role === "user" && message.content.trim(),
        )?.content ||
        payload.messages.find((message) => message.content.trim())?.content ||
        "";
      const preview = normalizeConversationPreview(previewSource);
      if (!preview) {
        return;
      }

      setConversationSummaries((prev) => {
        if (prev[payload.conversationId] === preview) {
          return prev;
        }
        return {
          ...prev,
          [payload.conversationId]: preview,
        };
      });
    },
    [],
  );

  const renderConversationTitle = useCallback(
    (conversation: ConversationItem) => {
      if (!isGenericConversationTitle(conversation.title)) {
        return conversation.title;
      }
      return (
        conversationSummaries[conversation.id] ||
        t("newConversation")
      );
    },
    [conversationSummaries, t],
  );

  const filteredConversations = useMemo(() => {
    if (!deferredSearch.trim()) return conversations;
    const q = deferredSearch.trim().toLowerCase();
    return conversations.filter((c) => {
      const title = renderConversationTitle(c).toLowerCase();
      return title.includes(q);
    });
  }, [conversations, deferredSearch, renderConversationTitle]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await apiDelete(`/api/v1/chat/conversations/${conversationId}`);
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeConversationId === conversationId) {
          const remaining = conversations.filter((c) => c.id !== conversationId);
          const next = remaining[0]?.id ?? null;
          setActiveConversationId(next);
          replaceChatUrl(selectedProjectId, next);
        }
      } catch { /* silent */ }
      setContextMenu(null);
    },
    [activeConversationId, conversations, replaceChatUrl, selectedProjectId],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, conversationId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, conversationId });
    },
    [],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  return (
    <PageTransition>
      <div
        className="chat-page"
        style={{
          height: "calc(100vh - 48px - 28px)",
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          gap: 16,
        }}
      >
        {/* Drawer backdrop — mobile only */}
        <div
          className={`chat-sidebar-drawer-backdrop${drawerOpen ? " is-open" : ""}`}
          onClick={() => setDrawerOpen(false)}
        />

        <aside
          className={`chat-sidebar${drawerOpen ? " is-open" : ""}`}
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            padding: 16,
            borderRadius: 20,
            background: "rgba(255, 255, 255, 0.72)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
            backdropFilter: "blur(18px)",
          }}
        >
          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            {/* Search bar */}
            <div className="chat-sidebar-search">
              <svg
                className="chat-sidebar-search-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                onClick={() => setSearchExpanded((p) => !p)}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {searchExpanded && (
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  autoFocus
                />
              )}
            </div>

            {/* Project selector + New button */}
            <div className="chat-sidebar-header-row">
              <select
                value={selectedProjectId}
                onChange={handleProjectChange}
                disabled={loadingProjects || projects.length === 0}
              >
                {projects.length === 0 ? (
                  <option value="">{t("selectAssistant")}</option>
                ) : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {projectLabels.get(project.id) || project.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="chat-sidebar-new-btn"
                onClick={handleConversationCreate}
                disabled={!selectedProjectId || isCreatingConversation || loadingProjects}
                title={t("newConversation")}
              >
                +
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div
            className="chat-sidebar-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minHeight: 0,
              overflowY: "auto",
              flex: 1,
            }}
          >
            {conversationLoadState === "loading" ? (
              <div className="chat-sidebar-empty">...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="chat-sidebar-empty">
                {searchQuery ? t("searchPlaceholder") : t("noConversations")}
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`chat-sidebar-item${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      handleConversationSelect(conversation.id);
                      setDrawerOpen(false);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, conversation.id)}
                  >
                    <div className="chat-sidebar-item-row1">
                      <div className="chat-sidebar-item-avatar">
                        {(renderConversationTitle(conversation))[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="chat-sidebar-item-title">
                        {renderConversationTitle(conversation)}
                      </div>
                    </div>
                    <div className="chat-sidebar-item-row2">
                      <span className="chat-sidebar-item-preview">
                        {conversationSummaries[conversation.id] || t("noPreview")}
                      </span>
                      <span className="chat-sidebar-item-time">
                        {formatRelativeTime(conversation.updated_at, t)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="chat-sidebar-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="chat-sidebar-context-item is-danger"
              onClick={() => handleDeleteConversation(contextMenu.conversationId)}
            >
              {t("deleteConversation")}
            </button>
          </div>
        )}

        <div
          className="chat-main"
          style={{
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <button
            type="button"
            className="chat-sidebar-hamburger"
            onClick={() => setDrawerOpen(true)}
            title={t("drawerOpen")}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <ChatInterface
            conversationId={activeConversationId}
            projectId={selectedProjectId}
            onConversationActivity={handleConversationActivity}
            onConversationLoaded={handleConversationLoaded}
          />
        </div>
      </div>
    </PageTransition>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <PageTransition>
          <div className="p-6">
            <div className="console-empty">...</div>
          </div>
        </PageTransition>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
