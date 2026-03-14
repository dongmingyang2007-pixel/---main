"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { ConsoleTableSkeleton } from "@/components/ConsoleSkeleton";
import { DataTable } from "@/components/DataTable";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Model = { id: string; project_id: string; name: string; task_type: string; created_at: string };

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Personal Assistant");
  const [taskType, setTaskType] = useState("general");

  const loadModels = async (pid: string) => {
    setLoading(true);
    if (!pid) {
      setModels([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiGet<{ items: Model[] }>(`/api/v1/models?project_id=${pid}`);
      setModels(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  const { projectId, projects, selectProject } = useProjectSelection(loadModels);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    await apiPost("/api/v1/models", {
      project_id: projectId,
      name,
      task_type: taskType,
    });
    await loadModels(projectId);
  };

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              Models
            </p>
            <h1 className="mt-2 text-2xl font-bold">模型仓库</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">登记版本，发布 alias，并保留回滚路径。</p>
          </div>

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">创建模型仓条目</h2>
            <p className="console-panel-description">模型仓是发布中心，不论版本来自训练 run 还是手工受管上传，都从这里管理。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <form onSubmit={onCreate} className="console-form-grid columns-4">
            <div>
              <label className="console-label" htmlFor="model-project">项目</label>
              <select
                id="model-project"
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
              <label className="console-label" htmlFor="model-name">模型名</label>
              <input id="model-name" className="console-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="console-label" htmlFor="task-type">任务类型</label>
              <input id="task-type" className="console-input" value={taskType} onChange={(e) => setTaskType(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button className="console-button w-full">新建模型</button>
            </div>
          </form>
        </div>
      </section>

      {loading ? <ConsoleTableSkeleton cols={3} rows={4} /> : <DataTable
        caption="模型仓列表"
        headers={["名称", "任务类型", "创建时间", "操作"]}
        emptyTitle="还没有模型仓条目"
        emptyBody="先创建模型，再登记训练产物或手工产物版本。"
        rows={models.map((model) => [
          <div key={model.id}>
            <div className="font-semibold text-[var(--text-primary)]">{model.name}</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">{model.id.slice(0, 8)}...</div>
          </div>,
          model.task_type,
          new Date(model.created_at).toLocaleString(),
          <Link key={model.id} href={`/app/models/${model.id}`} className="console-link">
            打开模型仓
          </Link>,
        ])}
      />}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
