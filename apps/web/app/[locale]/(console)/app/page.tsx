"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ConsoleSkeleton } from "@/components/ConsoleSkeleton";
import { ContentRail } from "@/components/ContentRail";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { StudioSection } from "@/components/StudioSection";
import { apiGet } from "@/lib/api";

type Project = { id: string };
type Dataset = { id: string };
type Job = { id: string };
type Model = { id: string };
type ModelAlias = { alias: "prod" | "staging" | "dev"; model_version_id: string };
type ModelVersion = { id: string; version: number };

export default function DashboardPage() {
  const [summary, setSummary] = useState({ projects: 0, datasets: 0, jobs: 0, modelVersion: "-" });
  const [loading, setLoading] = useState(true);
  const t = useTranslations("console");

  useEffect(() => {
    async function load() {
      const projectsResp = await apiGet<{ items: Project[] }>("/api/v1/projects").catch(() => ({ items: [] }));
      const projects = projectsResp.items || [];
      if (!projects.length) {
        setSummary({ projects: 0, datasets: 0, jobs: 0, modelVersion: "-" });
        return;
      }

      const [datasetLists, jobLists, modelLists] = await Promise.all([
        Promise.all(projects.map((project) => apiGet<Dataset[]>(`/api/v1/datasets?project_id=${project.id}`).catch(() => []))),
        Promise.all(
          projects.map((project) =>
            apiGet<{ items: Job[] }>(`/api/v1/train/jobs?project_id=${project.id}`).catch(() => ({ items: [] })),
          ),
        ),
        Promise.all(
          projects.map((project) =>
            apiGet<{ items: Model[] }>(`/api/v1/models?project_id=${project.id}`).catch(() => ({ items: [] })),
          ),
        ),
      ]);

      const models = modelLists.flatMap((item) => item.items || []);
      let prodVersion = "-";
      for (const model of models) {
        const [detail, versions] = await Promise.all([
          apiGet<{ aliases: ModelAlias[] }>(`/api/v1/models/${model.id}`).catch(() => ({ aliases: [] })),
          apiGet<{ items: ModelVersion[] }>(`/api/v1/models/${model.id}/versions`).catch(() => ({ items: [] })),
        ]);
        const prodAlias = (detail.aliases || []).find((item) => item.alias === "prod");
        if (!prodAlias) {
          continue;
        }
        const targetVersion = (versions.items || []).find((version) => version.id === prodAlias.model_version_id);
        prodVersion = targetVersion ? `v${targetVersion.version}` : `${prodAlias.model_version_id.slice(0, 8)}...`;
        break;
      }

      setSummary({
        projects: projects.length,
        datasets: datasetLists.reduce((acc, list) => acc + list.length, 0),
        jobs: jobLists.reduce((acc, item) => acc + (item.items?.length || 0), 0),
        modelVersion: prodVersion,
      });
    }

    void load().finally(() => setLoading(false));
  }, []);

  if (loading) return <PanelLayout><ConsoleSkeleton rows={4} /></PanelLayout>;

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("dashboard.overview")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("route.app.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("dashboard.overviewBody")}</p>
          </div>

      <ContentRail
        eyebrow={t("dashboard.liveSummary")}
        title={t("dashboard.liveSummaryTitle")}
        summary={t("dashboard.liveSummaryBody")}
        items={[
          { label: t("dashboard.metric.projects"), title: String(summary.projects), body: t("dashboard.metric.projectsBody"), meta: t("dashboard.metric.projectsMeta"), href: "/app/assistants" },
          { label: t("dashboard.metric.datasets"), title: String(summary.datasets), body: t("dashboard.metric.datasetsBody"), meta: t("dashboard.metric.datasetsMeta"), href: "/app/knowledge" },
          { label: t("dashboard.metric.jobs"), title: String(summary.jobs), body: t("dashboard.metric.jobsBody"), meta: t("dashboard.metric.jobsMeta"), href: "/app/training" },
          { label: t("dashboard.metric.prod"), title: summary.modelVersion, body: t("dashboard.metric.prodBody"), meta: t("dashboard.metric.prodMeta"), href: "/app/assistants" },
        ]}
        variant="metrics"
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <StudioSection
          eyebrow={t("dashboard.quickFlow")}
          title={t("dashboard.quickFlowTitle")}
          description={t("dashboard.quickFlowBody")}
        >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["/app/assistants", t("dashboard.quick.projects"), t("dashboard.quick.projectsBody")],
                ["/app/knowledge", t("dashboard.quick.datasets"), t("dashboard.quick.datasetsBody")],
                ["/app/training", t("dashboard.quick.train"), t("dashboard.quick.trainBody")],
                ["/app/chat", t("dashboard.quick.models"), t("dashboard.quick.modelsBody")],
              ].map(([href, title, body]) => (
                <Link key={href} href={href} className="console-key-item">
                  <div className="console-key-label">{title}</div>
                  <div className="console-key-value">{body}</div>
                </Link>
                ))}
              </div>
        </StudioSection>

        <StudioSection
          eyebrow={t("dashboard.rules")}
          title={t("dashboard.rulesTitle")}
          description={t("dashboard.rulesBody")}
        >
          <div className="console-note-stack">
            <div className="console-note-item">{t("dashboard.rule0")}</div>
            <div className="console-note-item">{t("dashboard.rule1")}</div>
            <div className="console-note-item">{t("dashboard.rule2")}</div>
          </div>
        </StudioSection>
      </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
