"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet, apiPost } from "@/lib/api";

type Project = { id: string; name: string };
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [versionOptions, setVersionOptions] = useState<DatasetVersionOption[]>([]);
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [recipe, setRecipe] = useState("mock");
  const [forceFail, setForceFail] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const loadJobs = async (pid: string) => {
    if (!pid) return;
    const data = await apiGet<{ items: Job[] }>(`/api/v1/train/jobs?project_id=${pid}`);
    setJobs(data.items || []);
  };

  const loadVersions = async (pid: string) => {
    if (!pid) return;
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

  const loadProjects = async () => {
    const data = await apiGet<{ items: Project[] }>("/api/v1/projects");
    const list = data.items || [];
    setProjects(list);
    if (!projectId && list.length) {
      const nextProjectId = list[0].id;
      setProjectId(nextProjectId);
      await Promise.all([loadJobs(nextProjectId), loadVersions(nextProjectId)]);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    if (!datasetVersionId) {
      setErrorMessage("当前项目还没有可用的数据版本，请先到数据集页面执行 Commit。");
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
      setErrorMessage(err instanceof Error ? err.message : "创建训练任务失败");
    }
  };

  return (
    <>
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">创建训练任务</h2>
            <p className="console-panel-description">选择已经冻结的数据版本，随后进入日志、指标和产物的统一详情页。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <form onSubmit={onCreate} className="console-form-grid columns-5">
            <div>
              <label className="console-label" htmlFor="train-project">项目</label>
              <select
                id="train-project"
                className="console-select"
                value={projectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setProjectId(pid);
                  void Promise.all([loadJobs(pid), loadVersions(pid)]);
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
              <label className="console-label" htmlFor="train-version">数据版本</label>
              <select
                id="train-version"
                className="console-select"
                value={datasetVersionId}
                onChange={(e) => setDatasetVersionId(e.target.value)}
                required
              >
                {!versionOptions.length ? (
                  <option value="">当前项目无可用数据版本</option>
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
              <label className="console-label" htmlFor="train-recipe">训练配方</label>
              <input
                id="train-recipe"
                className="console-input"
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
                placeholder="训练配方"
              />
            </div>
            <div className="flex items-end">
              <label className="console-key-item flex min-h-[48px] w-full items-center gap-3">
                <input type="checkbox" checked={forceFail} onChange={(e) => setForceFail(e.target.checked)} />
                <span>触发失败分支</span>
              </label>
            </div>
            <div className="flex items-end">
              <button className="console-button w-full">创建训练任务</button>
            </div>
          </form>
          {errorMessage ? <div className="console-inline-notice is-error mt-4">{errorMessage}</div> : null}
        </div>
      </section>

      <DataTable
        caption="训练任务列表"
        headers={["ID", "Recipe", "Dataset Version", "状态", "创建时间", "详情"]}
        emptyTitle="还没有训练任务"
        emptyBody="先准备一个数据版本，再创建训练作业。"
        rows={jobs.map((job) => [
          <span key={job.id} className="text-xs font-medium">{job.id.slice(0, 8)}...</span>,
          job.recipe,
          <span key={`${job.id}-dataset`} className="text-xs">{job.dataset_version_id.slice(0, 8)}...</span>,
          <StatusBadge key={`${job.id}-status`} status={job.status} />,
          new Date(job.created_at).toLocaleString(),
          <Link key={`${job.id}-link`} href={`/app/train/${job.id}`} className="console-link">
            查看详情
          </Link>,
        ])}
      />
    </>
  );
}
