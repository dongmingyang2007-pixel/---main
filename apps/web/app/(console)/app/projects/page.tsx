"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { apiGet, apiPost } from "@/lib/api";

type Project = { id: string; name: string; description?: string; created_at: string };

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = async () => {
    const data = await apiGet<{ items: Project[] }>("/api/v1/projects");
    setItems(data.items || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    await apiPost("/api/v1/projects", { name, description });
    setName("");
    setDescription("");
    await load();
  };

  return (
    <>
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">新建项目</h2>
            <p className="console-panel-description">用项目隔离数据、训练和模型仓库，后续也便于按业务线拆分。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <form onSubmit={onCreate} className="console-form-grid columns-3">
            <div>
              <label className="console-label" htmlFor="project-name">项目名</label>
              <input
                id="project-name"
                className="console-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：Home Vision"
                required
              />
            </div>
            <div>
              <label className="console-label" htmlFor="project-description">描述</label>
              <input
                id="project-description"
                className="console-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个项目解决什么问题"
              />
            </div>
            <div className="flex items-end">
              <button className="console-button w-full">新建项目</button>
            </div>
          </form>
        </div>
      </section>

      <DataTable
        caption="项目列表"
        headers={["名称", "描述", "创建时间", "操作"]}
        emptyTitle="还没有项目"
        emptyBody="先创建一个项目，后续的数据集、训练作业和模型都挂在它下面。"
        rows={items.map((project) => [
          <div key={project.id}>
            <div className="font-semibold text-[var(--fg)]">{project.name}</div>
            <div className="mt-1 text-xs text-[var(--muted-soft)]">{project.id.slice(0, 8)}...</div>
          </div>,
          project.description || "暂无描述",
          new Date(project.created_at).toLocaleString(),
          <Link key={`${project.id}-detail`} href={`/app/projects/${project.id}`} className="console-link">
            查看详情
          </Link>,
        ])}
      />
    </>
  );
}
