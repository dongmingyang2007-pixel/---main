"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import type {
  PipelineConfigItem,
  PipelineResponse,
} from "@/components/console/chat-types";
import { apiGet } from "@/lib/api";
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

export default function DashboardPage() {
  const t = useTranslations("console");
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelineMap, setPipelineMap] = useState<Record<string, PipelineConfigItem[]>>({});
  const [catalogItems, setCatalogItems] = useState<CatalogModelSummary[]>([]);
  const [recentChats, setRecentChats] = useState<DashboardConversation[]>([]);
  const [loading, setLoading] = useState(true);

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

  const getModelName = (modelId: string) =>
    catalogModelNames.get(modelId) || modelId || t("dashboard.modelFallback");
  const getModeLabel = (mode?: Project["default_chat_mode"]) =>
    mode ? t(DASHBOARD_CHAT_MODE_LABEL_KEYS[mode]) : t("dashboard.mode.standard");

  return (
    <PageTransition>
      <div className="dashboard-consumer">
        <div className="dashboard-welcome">
          <h1 className="dashboard-welcome-title">{t("dashboard.welcome")}</h1>
          <p className="dashboard-welcome-sub">{t("dashboard.welcomeSub")}</p>
        </div>

        <div className="dashboard-stats">
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">{projects.length}</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.assistants")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">{configuredModelCount}</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.models")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">{realtimeProjectCount}</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.realtime")}</div>
          </div>
        </div>

        <div className="dashboard-section-head">
          <div>
            <div className="dashboard-section-title">
              {t("dashboard.projectsAndModels")}
            </div>
            <div className="dashboard-section-subtitle">
              {t("dashboard.projectsAndModelsSub")}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="dashboard-empty-card">...</div>
        ) : projectCards.length === 0 ? (
          <div className="dashboard-empty-card">{t("dashboard.emptyProjects")}</div>
        ) : (
          <div className="dashboard-project-grid">
            {projectCards.map((project) => (
              <article key={project.id} className="dashboard-project-card">
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

                  <div className="dashboard-project-actions">
                    <button
                      type="button"
                      className="dashboard-ghost-btn"
                      onClick={() => router.push(`/app/assistants/${project.id}`)}
                    >
                      {t("dashboard.openAssistant")}
                    </button>
                    <button
                      type="button"
                      className="dashboard-chat-btn"
                      onClick={() => router.push(`/app/chat?project_id=${project.id}`)}
                    >
                      {t("dashboard.startChat")}
                    </button>
                  </div>
                </div>

                <div className="dashboard-project-model-list">
                  {project.pipelineItems.length === 0 ? (
                    <div className="dashboard-project-model-empty">
                      {t("dashboard.noModelsConfigured")}
                    </div>
                  ) : (
                    project.pipelineItems.map((item) => (
                      <div
                        key={`${project.id}-${item.model_type}`}
                        className="dashboard-project-model-row"
                      >
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
              </article>
            ))}
          </div>
        )}

        <div className="dashboard-section-head">
          <div>
            <div className="dashboard-section-title">{t("dashboard.recentChats")}</div>
            <div className="dashboard-section-subtitle">
              {t("dashboard.recentChatsSub")}
            </div>
          </div>
        </div>

        <div className="dashboard-recent-list">
          {recentChats.length === 0 ? (
            <div className="dashboard-empty-card">{t("dashboard.noChats")}</div>
          ) : (
            recentChats.map((chat) => (
              <Link
                key={chat.id}
                href={`/app/chat?project_id=${chat.projectId}&conv=${chat.id}`}
                className="dashboard-recent-item"
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
            ))
          )}
        </div>
      </div>
    </PageTransition>
  );
}
