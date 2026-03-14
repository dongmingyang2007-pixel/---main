"use client";

import { Link } from "@/i18n/navigation";
import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";

import { ConsoleTableSkeleton } from "@/components/ConsoleSkeleton";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Dataset = { id: string; name: string };
type DatasetVersion = { id: string; version: number; dataset_id: string };
type DatasetVersionOption = DatasetVersion & { dataset_name: string };
type Job = {
  id: string;
  dataset_version_id: string;
  recipe: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  created_at: string;
};

export default function TrainPage() {
  const [versionOptions, setVersionOptions] = useState<DatasetVersionOption[]>([]);
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [recipe, setRecipe] = useState("mock");
  const [forceFail, setForceFail] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const t = useTranslations("console-train");

  const loadJobs = async (pid: string) => {
    if (!pid) {
      setJobs([]);
      return;
    }
    const data = await apiGet<{ items: Job[] }>(`/api/v1/train/jobs?project_id=${pid}`);
    setJobs(data.items || []);
  };

  const loadVersions = async (pid: string) => {
    if (!pid) {
      setVersionOptions([]);
      setDatasetVersionId("");
      return;
    }
    const datasetList = await apiGet<Dataset[]>(`/api/v1/datasets?project_id=${pid}`);
    if (!datasetList.length) {
      setVersionOptions([]);
      setDatasetVersionId("");
      return;
    }

    const versionResults = await Promise.all(
      datasetList.map(async (dataset) => {
        const versions = await apiGet<DatasetVersion[]>(`/api/v1/datasets/${dataset.id}/versions`).catch(() => []);
        return versions.map((version) => ({
          ...version,
          dataset_name: dataset.name,
        }));
      }),
    );

    const merged = versionResults.flat().sort((a, b) => {
      if (a.dataset_name === b.dataset_name) return b.version - a.version;
      return a.dataset_name.localeCompare(b.dataset_name);
    });
    setVersionOptions(merged);
    if (!merged.some((version) => version.id === datasetVersionId)) {
      setDatasetVersionId(merged[0]?.id || "");
    }
  };

  const loadProjectData = async (pid: string) => {
    setLoading(true);
    setErrorMessage("");
    try {
      await Promise.all([loadJobs(pid), loadVersions(pid)]);
    } finally {
      setLoading(false);
    }
  };

  const { projectId, projects, selectProject } = useProjectSelection(loadProjectData);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    if (!datasetVersionId) {
      setErrorMessage(t("form.noVersionError"));
      return;
    }
    try {
      await apiPost("/api/v1/train/jobs", {
        project_id: projectId,
        dataset_version_id: datasetVersionId,
        recipe,
        params_json: { base_model: "qihang-mini", epochs: 1, force_fail: forceFail },
      });
      await loadJobs(projectId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t("form.createError"));
    }
  };

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("description")}</p>
          </div>

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">{t("form.title")}</h2>
            <p className="console-panel-description">{t("form.description")}</p>
          </div>
        </div>
        <div className="console-panel-body">
          <form onSubmit={onCreate} className="console-form-grid columns-5">
            <div>
              <label className="console-label" htmlFor="train-project">{t("form.project")}</label>
              <select
                id="train-project"
                className="console-select"
                value={projectId}
                onChange={(e) => {
                  void selectProject(e.target.value);
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="console-label" htmlFor="train-version">{t("form.datasetVersion")}</label>
              <select
                id="train-version"
                className="console-select"
                value={datasetVersionId}
                onChange={(e) => setDatasetVersionId(e.target.value)}
                required
              >
                {!versionOptions.length ? (
                  <option value="">{t("form.noVersions")}</option>
                ) : (
                  versionOptions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.dataset_name} · v{version.version} · {version.id.slice(0, 8)}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="console-label" htmlFor="train-recipe">{t("form.recipe")}</label>
              <input
                id="train-recipe"
                className="console-input"
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
                placeholder={t("form.recipe")}
              />
            </div>
            <div className="flex items-end">
              <label className="console-key-item flex min-h-[48px] w-full items-center gap-3">
                <input type="checkbox" checked={forceFail} onChange={(e) => setForceFail(e.target.checked)} />
                <span>{t("form.forceFail")}</span>
              </label>
            </div>
            <div className="flex items-end">
              <button className="console-button w-full">{t("form.submit")}</button>
            </div>
          </form>
          {errorMessage ? <div className="console-inline-notice is-error mt-4">{errorMessage}</div> : null}
        </div>
      </section>

      {loading ? <ConsoleTableSkeleton cols={5} rows={4} /> : <DataTable
        caption={t("table.caption")}
        headers={[t("table.id"), t("table.recipe"), t("table.datasetVersion"), t("table.status"), t("table.createdAt"), t("table.detail")]}
        emptyTitle={t("table.emptyTitle")}
        emptyBody={t("table.emptyBody")}
        rows={jobs.map((job) => [
          <span key={job.id} className="text-xs font-medium">{job.id.slice(0, 8)}...</span>,
          job.recipe,
          <span key={`${job.id}-dataset`} className="text-xs">{job.dataset_version_id.slice(0, 8)}...</span>,
          <StatusBadge key={`${job.id}-status`} status={job.status} />,
          new Date(job.created_at).toLocaleString(),
          <Link key={`${job.id}-link`} href={`/app/train/${job.id}`} className="console-link">
            {t("table.viewDetail")}
          </Link>,
        ])}
      />}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
