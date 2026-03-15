"use client";

import { Link } from "@/i18n/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ConsoleTableSkeleton } from "@/components/ConsoleSkeleton";
import { DataTable } from "@/components/DataTable";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";
import { useProjectContext } from "@/lib/ProjectContext";
import { useToast } from "@/hooks/use-toast";

type Project = { id: string; name: string; description?: string; created_at: string };

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const t = useTranslations("console-projects");
  const { loadProjects } = useProjectContext();
  const { toast } = useToast();

  const load = useCallback(async () => {
    const data = await apiGet<{ items: Project[] }>("/api/v1/projects");
    setItems(data.items || []);
  }, []);

  useEffect(() => {
    let active = true;

    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => {
        if (!active) return;
        setItems(data.items || []);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("项目名不能为空");
      return;
    }

    const duplicate = items.some(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (duplicate) {
      setFormError(`项目名「${trimmedName}」已存在，请使用其他名称`);
      return;
    }

    await apiPost("/api/v1/projects", { name: trimmedName, description });
    setName("");
    setDescription("");
    toast({ title: "创建成功", description: `项目「${trimmedName}」已创建` });
    await load();
    await loadProjects();
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
                    className={`console-input${formError ? " border-red-500" : ""}`}
                    value={name}
                    onChange={(e) => { setName(e.target.value); setFormError(""); }}
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
              {formError && (
                <p className="mt-3 text-sm text-red-500">{formError}</p>
              )}
            </div>
          </section>

          {loading ? (
            <ConsoleTableSkeleton cols={3} rows={4} />
          ) : (
            <DataTable
              caption="项目列表"
              headers={["名称", "描述", "创建时间", "操作"]}
              emptyTitle="还没有项目"
              emptyBody="先创建一个项目，后续的数据集、训练作业和模型都挂在它下面。"
              rows={items.map((project) => [
                <div key={project.id}>
                  <div className="font-semibold text-[var(--text-primary)]">{project.name}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{project.id.slice(0, 8)}...</div>
                </div>,
                project.description || "暂无描述",
                new Date(project.created_at).toLocaleString(),
                <Link key={`${project.id}-detail`} href={`/app/projects/${project.id}`} className="console-link">
                  查看详情
                </Link>,
              ])}
            />
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
