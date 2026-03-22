"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { GlassCard, GlassButton } from "@/components/console/glass";
import type {
  PipelineConfigItem,
  PipelineResponse,
} from "@/components/console/chat-types";
import { apiGet, apiDelete } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-time";
import { buildProjectDisplayMap } from "@/lib/project-display";

type Project = {
  id: string;
  name: string;
  default_chat_mode?: "standard" | "omni_realtime" | "synthetic_realtime";
};

type CatalogModelSummary = {
  model_id: string;
  display_name?: string;
};

interface RecentConversation {
  id: string;
  title: string;
  updated_at: string;
}

interface DashboardConversation extends RecentConversation {
  projectId: string;
  projectName: string;
}

const DASHBOARD_PIPELINE_ORDER: PipelineConfigItem["model_type"][] = [
  "llm",
  "realtime",
  "realtime_asr",
  "realtime_tts",
  "vision",
  "asr",
  "tts",
];

const DASHBOARD_PIPELINE_LABEL_KEYS: Record<PipelineConfigItem["model_type"], string> = {
  llm: "dashboard.slot.llm",
  realtime: "dashboard.slot.realtime",
  realtime_asr: "dashboard.slot.realtimeAsr",
  realtime_tts: "dashboard.slot.realtimeTts",
  vision: "dashboard.slot.vision",
  asr: "dashboard.slot.asr",
  tts: "dashboard.slot.tts",
};

const DASHBOARD_CHAT_MODE_LABEL_KEYS: Record<
  NonNullable<Project["default_chat_mode"]>,
  string
> = {
  standard: "dashboard.mode.standard",
  omni_realtime: "dashboard.mode.omni",
  synthetic_realtime: "dashboard.mode.synthetic",
};

const SLOT_COLOR_MAP: Record<PipelineConfigItem["model_type"], string> = {
  llm: "var(--console-slot-brain)",
  realtime: "var(--console-slot-realtime)",
  realtime_asr: "var(--console-slot-realtime-asr)",
  realtime_tts: "var(--console-slot-realtime-tts)",
  vision: "var(--console-slot-vision)",
  asr: "var(--console-slot-asr)",
  tts: "var(--console-slot-tts)",
};

export default function DashboardPage() {
  const t = useTranslations("console");
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelineMap, setPipelineMap] = useState<Record<string, PipelineConfigItem[]>>({});
  const [catalogItems, setCatalogItems] = useState<CatalogModelSummary[]>([]);
  const [recentChats, setRecentChats] = useState<DashboardConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);

      try {
        const [projectsResponse, catalogResponse] = await Promise.all([
          apiGet<{ items: Project[] }>("/api/v1/projects"),
          apiGet<CatalogModelSummary[]>("/api/v1/models/catalog"),
        ]);

        if (cancelled) {
          return;
        }

        const projectItems = Array.isArray(projectsResponse.items)
          ? projectsResponse.items
          : [];
        setProjects(projectItems);
        setCatalogItems(Array.isArray(catalogResponse) ? catalogResponse : []);

        const [pipelineResults, conversationResults] = await Promise.all([
          Promise.allSettled(
            projectItems.map((project) =>
              apiGet<PipelineResponse>(`/api/v1/pipeline?project_id=${project.id}`),
            ),
          ),
          Promise.allSettled(
            projectItems.map((project) =>
              apiGet<RecentConversation[]>(
                `/api/v1/chat/conversations?project_id=${project.id}`,
              ),
            ),
          ),
        ]);

        if (cancelled) {
          return;
        }

        const nextPipelineMap: Record<string, PipelineConfigItem[]> = {};
        projectItems.forEach((project, index) => {
          const result = pipelineResults[index];
          nextPipelineMap[project.id] =
            result?.status === "fulfilled" && Array.isArray(result.value.items)
              ? result.value.items
              : [];
        });
        setPipelineMap(nextPipelineMap);

        const nextRecentChats: DashboardConversation[] = [];
        projectItems.forEach((project, index) => {
          const result = conversationResults[index];
          if (result?.status !== "fulfilled") {
            return;
          }
          const items = Array.isArray(result.value) ? result.value : [];
          items.slice(0, 3).forEach((conversation) => {
            nextRecentChats.push({
              ...conversation,
              projectId: project.id,
              projectName: project.name,
            });
          });
        });
        nextRecentChats.sort(
          (left, right) =>
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime(),
        );
        setRecentChats(nextRecentChats.slice(0, 6));
      } catch {
        if (cancelled) {
          return;
        }
        setProjects([]);
        setPipelineMap({});
        setCatalogItems([]);
        setRecentChats([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const projectLabels = useMemo(
    () => buildProjectDisplayMap(projects),
    [projects],
  );
  const catalogModelNames = useMemo(
    () =>
      new Map(
        catalogItems.map((item) => [item.model_id, item.display_name || item.model_id]),
      ),
    [catalogItems],
  );
  const projectCards = useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        pipelineItems: [...(pipelineMap[project.id] || [])].sort(
          (left, right) =>
            DASHBOARD_PIPELINE_ORDER.indexOf(left.model_type) -
            DASHBOARD_PIPELINE_ORDER.indexOf(right.model_type),
        ),
      })),
    [projects, pipelineMap],
  );
  const configuredModelCount = useMemo(
    () =>
      projectCards.reduce(
        (count, project) => count + project.pipelineItems.length,
        0,
      ),
    [projectCards],
  );
  const realtimeProjectCount = useMemo(
    () =>
      projectCards.filter(
        (project) =>
          project.default_chat_mode && project.default_chat_mode !== "standard",
      ).length,
    [projectCards],
  );
  const activeProject = useMemo(
    () =>
      projectCards.find((project) => project.id === activeProjectId) ||
      projectCards[0] ||
      null,
    [activeProjectId, projectCards],
  );
  const activeProjectRecentChats = useMemo(
    () =>
      activeProject
        ? recentChats.filter((chat) => chat.projectId === activeProject.id)
        : recentChats,
    [activeProject, recentChats],
  );

  const getModelName = (modelId: string) =>
    catalogModelNames.get(modelId) || modelId || t("dashboard.modelFallback");
  const getModeLabel = (mode?: Project["default_chat_mode"]) =>
    mode ? t(DASHBOARD_CHAT_MODE_LABEL_KEYS[mode]) : t("dashboard.mode.standard");

  useEffect(() => {
    if (projectCards.length === 0) {
      setActiveProjectId("");
      return;
    }

    setActiveProjectId((current) =>
      current && projectCards.some((project) => project.id === current)
        ? current
        : projectCards[0].id,
    );
  }, [projectCards]);

  return (
    <PageTransition>
      <div className="console-page-shell dashboard-page">
        <h2 className="console-a11y-heading">{t("nav.assistants")}</h2>

        {/* Tab pills */}
        <div className="dashboard-glass-tabs">
          <Link href="/app" className="dashboard-glass-tab is-active">
            {t("nav.assistants")}
          </Link>
          <Link href="/app/discover" className="dashboard-glass-tab">
            {t("nav.discover")}
          </Link>
        </div>

        {/* 3-column grid */}
        <div className="dashboard-glass-grid">
          {/* Left column: project list */}
          <GlassCard className="dashboard-glass-col dashboard-glass-left">
            <div className="dashboard-glass-col-header">
              <h3 className="dashboard-glass-col-title">{t("dashboard.projectsAndModels")}</h3>
              <p className="dashboard-glass-col-sub">{t("dashboard.quickFlowBody")}</p>
            </div>
            {loading ? (
              <div className="dashboard-glass-empty">...</div>
            ) : projectCards.length === 0 ? (
              <div className="dashboard-glass-empty">
                <span>{t("dashboard.emptyProjects")}</span>
                <span className="dashboard-glass-empty-sub">{t("dashboard.overviewBody")}</span>
              </div>
            ) : (
              <div className="dashboard-project-list" data-testid="dashboard-project-list">
                {projectCards.map((project) => {
                  const isActive = activeProject?.id === project.id;
                  const firstModels = project.pipelineItems
                    .slice(0, 2)
                    .map((item) => getModelName(item.model_id))
                    .join(" / ");

                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`dashboard-project-card${isActive ? " is-active" : ""}`}
                      onClick={() => setActiveProjectId(project.id)}
                      data-testid={`dashboard-project-card-${project.id}`}
                    >
                      <div className="dashboard-project-card-head">
                        <div className="dashboard-project-card-copy">
                          <div className="dashboard-project-card-name">
                            {projectLabels.get(project.id) || project.name}
                          </div>
                          <div className="dashboard-project-card-meta">
                            <span className="dashboard-mode-badge">
                              {getModeLabel(project.default_chat_mode)}
                            </span>
                            <span>
                              {t("dashboard.modelSlotCount", {
                                count: project.pipelineItems.length,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="dashboard-project-card-signal">
                        {firstModels || t("dashboard.noModelsConfigured")}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {/* Center column: live summary */}
          <GlassCard className="dashboard-glass-col dashboard-glass-center">
            <div className="dashboard-glass-col-header">
              <div className="dashboard-glass-center-head">
                <div>
                  <span className="dashboard-glass-eyebrow">{t("dashboard.liveSummary")}</span>
                  <h3 className="dashboard-glass-col-title">
                    {activeProject ? projectLabels.get(activeProject.id) || activeProject.name : t("dashboard.welcome")}
                  </h3>
                  <p className="dashboard-glass-col-sub">
                    {activeProject ? getModeLabel(activeProject.default_chat_mode) : t("dashboard.welcomeSub")}
                  </p>
                </div>
                {activeProject && (
                  <div className="dashboard-glass-actions">
                    <GlassButton
                      variant="secondary"
                      onClick={() => router.push(`/app/assistants/${activeProject.id}`)}
                    >
                      {t("dashboard.openAssistant")}
                    </GlassButton>
                    <GlassButton
                      variant="primary"
                      onClick={() => router.push(`/app/chat?project_id=${activeProject.id}`)}
                    >
                      {t("dashboard.startChat")}
                    </GlassButton>
                  </div>
                )}
              </div>
            </div>

            {!activeProject ? (
              <div className="dashboard-glass-empty">
                <span>{t("dashboard.emptyProjects")}</span>
                <span className="dashboard-glass-empty-sub">{t("dashboard.overviewBody")}</span>
              </div>
            ) : (
              <div className="dashboard-command-summary">
                {/* Stats mini cards */}
                <div className="dashboard-command-summary-band">
                  <GlassCard className="dashboard-glass-stat">
                    <span className="dashboard-command-summary-label">
                      {t("dashboard.stat.models")}
                    </span>
                    <strong>{activeProject.pipelineItems.length}</strong>
                  </GlassCard>
                  <GlassCard className="dashboard-glass-stat">
                    <span className="dashboard-command-summary-label">
                      {t("dashboard.stat.realtime")}
                    </span>
                    <strong>
                      {activeProject.default_chat_mode === "standard" ? "0" : "1"}
                    </strong>
                  </GlassCard>
                  <GlassCard className="dashboard-glass-stat">
                    <span className="dashboard-command-summary-label">
                      {t("dashboard.recentChats")}
                    </span>
                    <strong>{activeProjectRecentChats.length}</strong>
                  </GlassCard>
                </div>

                {/* Model slots */}
                <div className="dashboard-project-model-list">
                  {activeProject.pipelineItems.length === 0 ? (
                    <div className="dashboard-project-model-empty">
                      {t("dashboard.noModelsConfigured")}
                    </div>
                  ) : (
                    activeProject.pipelineItems.map((item) => (
                      <div
                        key={`${activeProject.id}-${item.model_type}`}
                        className="dashboard-project-model-row"
                      >
                        <span className="dashboard-glass-slot-dot" style={{ background: SLOT_COLOR_MAP[item.model_type] }} />
                        <span className="dashboard-project-model-slot">
                          {t(DASHBOARD_PIPELINE_LABEL_KEYS[item.model_type])}
                        </span>
                        <span className="dashboard-project-model-name">
                          {getModelName(item.model_id)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </GlassCard>

          {/* Right column: recent conversations */}
          <GlassCard className="dashboard-glass-col dashboard-glass-right">
            <div className="dashboard-glass-col-header">
              <h3 className="dashboard-glass-col-title">{t("dashboard.recentChats")}</h3>
              <p className="dashboard-glass-col-sub">{t("dashboard.recentChatsSub")}</p>
            </div>
            {activeProjectRecentChats.length === 0 ? (
              <div className="dashboard-glass-empty">{t("dashboard.noChats")}</div>
            ) : (
              <div className="dashboard-recent-list">
                {activeProjectRecentChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="dashboard-recent-item"
                    style={{ display: "flex", alignItems: "center" }}
                  >
                    <Link
                      href={`/app/chat?project_id=${chat.projectId}&conv=${chat.id}`}
                      className="dashboard-recent-item-link"
                      style={{ display: "flex", flex: 1, minWidth: 0, alignItems: "center", textDecoration: "none", color: "inherit" }}
                    >
                      <div className="dashboard-recent-copy">
                        <span className="dashboard-recent-text">
                          {chat.title || t("dashboard.noChats")}
                        </span>
                        <span className="dashboard-recent-project">
                          {projectLabels.get(chat.projectId) || chat.projectName}
                        </span>
                      </div>
                      <span className="dashboard-recent-time">
                        {formatRelativeTime(chat.updated_at, t)}
                      </span>
                    </Link>
                    <button
                      type="button"
                      title={t("dashboard.deleteConv")}
                      onClick={async () => {
                        if (!window.confirm(t("dashboard.deleteConvConfirm"))) return;
                        try {
                          await apiDelete(`/api/v1/chat/conversations/${chat.id}`);
                          setRecentChats((prev) => prev.filter((c) => c.id !== chat.id));
                        } catch {
                          // ignore
                        }
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 4,
                        marginLeft: 4,
                        borderRadius: 4,
                        color: "var(--console-text-secondary, var(--text-secondary))",
                        opacity: 0.4,
                        transition: "opacity 0.15s, color 0.15s",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.color = "var(--console-text-secondary, var(--text-secondary))"; }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </PageTransition>
  );
}
