"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { apiGet, apiPost } from "@/lib/api";

type Project = { id: string; name: string };
type Dataset = { id: string; name: string; type: string; project_id: string; created_at: string };

export default function DatasetsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("images");

  const loadProjects = async () => {
    const data = await apiGet<{ items: Project[] }>("/api/v1/projects");
    setProjects(data.items || []);
    if (!projectId && data.items?.length) {
      const nextProjectId = data.items[0].id;
      setProjectId(nextProjectId);
      const list = await apiGet<Dataset[]>(`/api/v1/datasets?project_id=${nextProjectId}`);
      setDatasets(list);
    }
  };

  const loadDatasets = async (pid: string) => {
    if (!pid) return;
    const data = await apiGet<Dataset[]>(`/api/v1/datasets?project_id=${pid}`);
    setDatasets(data);
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    await apiPost("/api/v1/datasets", { project_id: projectId, name, type });
    setName("");
    await loadDatasets(projectId);
  };

  return (
    <>
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">创建数据集</h2>
            <p className="console-panel-description">按媒体类型拆分更利于版本冻结、训练选择和后续评测。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <form className="console-form-grid columns-4" onSubmit={onCreate}>
            <div>
              <label className="console-label" htmlFor="dataset-project">所属项目</label>
              <select
                id="dataset-project"
                className="console-select"
                value={projectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setProjectId(pid);
                  void loadDatasets(pid);
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
              <label className="console-label" htmlFor="dataset-name">数据集名</label>
              <input
                id="dataset-name"
                className="console-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：Field Capture"
                required
              />
            </div>
            <div>
              <label className="console-label" htmlFor="dataset-type">媒体类型</label>
              <select id="dataset-type" className="console-select" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="images">images</option>
                <option value="audio">audio</option>
                <option value="text">text</option>
                <option value="video">video</option>
              </select>
            </div>
            <div className="flex items-end">
              <button className="console-button w-full">新建数据集</button>
            </div>
          </form>
        </div>
      </section>

      <DataTable
        caption="数据集列表"
        headers={["名称", "类型", "创建时间", "操作"]}
        emptyTitle="还没有数据集"
        emptyBody="先选择一个项目并创建数据集，之后就可以上传样本、做标注和提交版本。"
        rows={datasets.map((dataset) => [
          <div key={dataset.id}>
            <div className="font-semibold text-[var(--fg)]">{dataset.name}</div>
            <div className="mt-1 text-xs text-[var(--muted-soft)]">{dataset.id.slice(0, 8)}...</div>
          </div>,
          dataset.type,
          new Date(dataset.created_at).toLocaleString(),
          <Link key={`${dataset.id}-detail`} href={`/app/datasets/${dataset.id}`} className="console-link">
            样本浏览
          </Link>,
        ])}
      />
    </>
  );
}
