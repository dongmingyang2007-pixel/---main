"use client";

import { Link } from "@/i18n/navigation";
import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Dataset = { id: string; name: string; type: string; project_id: string; created_at: string };

export default function KnowledgePage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState("images");
  const t = useTranslations("console-knowledge");

  const loadDatasets = async (pid: string) => {
    setLoading(true);
    if (!pid) {
      setDatasets([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiGet<Dataset[]>(`/api/v1/datasets?project_id=${pid}`);
      setDatasets(data);
    } finally {
      setLoading(false);
    }
  };

  const { projectId, projects, selectProject } = useProjectSelection(loadDatasets);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    await apiPost("/api/v1/datasets", { project_id: projectId, name, type });
    setName("");
    await loadDatasets(projectId);
  };

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
                <h2 className="console-panel-title">{t("form.title")}</h2>
                <p className="console-panel-description">{t("form.description")}</p>
              </div>
            </div>
            <div className="console-panel-body">
              <form className="console-form-grid columns-4" onSubmit={onCreate}>
                <div>
                  <label className="console-label" htmlFor="knowledge-project">{t("form.project")}</label>
                  <select
                    id="knowledge-project"
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
                  <label className="console-label" htmlFor="knowledge-name">{t("form.name")}</label>
                  <input
                    id="knowledge-name"
                    className="console-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("form.namePlaceholder")}
                    required
                  />
                </div>
                <div>
                  <label className="console-label" htmlFor="knowledge-type">{t("form.type")}</label>
                  <select id="knowledge-type" className="console-select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="images">images</option>
                    <option value="audio">audio</option>
                    <option value="text">text</option>
                    <option value="video">video</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button className="console-button w-full">{t("form.submit")}</button>
                </div>
              </form>
            </div>
          </section>

          {loading ? (
            <div className="assistant-card-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="assistant-card animate-pulse" style={{ minHeight: 100 }}>
                  <div className="h-4 w-2/3 rounded bg-[var(--border)] mb-3" />
                  <div className="h-3 w-1/3 rounded bg-[var(--border)]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="assistant-card-grid">
              {datasets.length === 0 ? (
                <div className="console-panel sm:col-span-2 lg:col-span-3 xl:col-span-4">
                  <div className="console-panel-body">
                    <div className="console-empty">{t("table.emptyTitle")}</div>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("table.emptyBody")}</p>
                  </div>
                </div>
              ) : (
                datasets.map((dataset) => (
                  <Link
                    key={dataset.id}
                    href={`/app/knowledge/${dataset.id}`}
                    className="assistant-card"
                  >
                    <div className="assistant-card-name">{dataset.name}</div>
                    <div className="assistant-card-desc">
                      {t("form.type")}: {dataset.type}
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-secondary)]">
                      {new Date(dataset.created_at).toLocaleDateString()}
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
