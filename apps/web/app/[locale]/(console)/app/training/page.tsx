"use client";

import { Link } from "@/i18n/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { ConsoleTableSkeleton } from "@/components/ConsoleSkeleton";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";
import { buildProjectDisplayMap } from "@/lib/project-display";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Job = {
  id: string;
  dataset_version_id: string;
  recipe: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  created_at: string;
};

export default function TrainingPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("console-training");

  const loadJobs = async (pid: string) => {
    setLoading(true);
    if (!pid) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiGet<{ items: Job[] }>(`/api/v1/train/jobs?project_id=${pid}`);
      setJobs(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  const { projectId, projects, selectProject } = useProjectSelection(loadJobs);
  const projectLabels = buildProjectDisplayMap(projects);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <label className="console-label" htmlFor="training-project">项目</label>
              </div>
            </div>
            <div className="console-panel-body">
              <select
                id="training-project"
                className="console-select max-w-xs"
                value={projectId}
                onChange={(e) => {
                  void selectProject(e.target.value);
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {projectLabels.get(project.id) || project.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {loading ? (
            <ConsoleTableSkeleton cols={5} rows={4} />
          ) : (
            <DataTable
              caption={t("table.caption")}
              headers={[
                t("table.id"),
                t("table.recipe"),
                t("table.datasetVersion"),
                t("table.status"),
                t("table.createdAt"),
                t("table.detail"),
              ]}
              emptyTitle={t("table.emptyTitle")}
              emptyBody={t("table.emptyBody")}
              rows={jobs.map((job) => [
                <span key={job.id} className="text-xs font-medium">{job.id.slice(0, 8)}...</span>,
                job.recipe,
                <span key={`${job.id}-dataset`} className="text-xs">{job.dataset_version_id.slice(0, 8)}...</span>,
                <StatusBadge key={`${job.id}-status`} status={job.status} />,
                new Date(job.created_at).toLocaleString(),
                <Link key={`${job.id}-link`} href={`/app/training/${job.id}`} className="console-link">
                  {t("table.viewDetail")}
                </Link>,
              ])}
            />
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
