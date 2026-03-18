"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Project = { id: string; name: string; description?: string; created_at: string };

/** Strip [model:...] [personality:...] [tags:...] [color:...] metadata from description */
function cleanDescription(desc?: string): string {
  if (!desc) return "";
  return desc
    .replace(/\[model:[^\]]*\]/g, "")
    .replace(/\[personality:[^\]]*\]/g, "")
    .replace(/\[tags:[^\]]*\]/g, "")
    .replace(/\[color:[^\]]*\]/g, "")
    .trim();
}

/** Extract model name from description metadata */
function extractModelName(desc?: string): string | null {
  if (!desc) return null;
  const match = desc.match(/\[model:([^|]*)\|/);
  return match ? match[1] : null;
}

export default function AssistantsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("console-assistants");
  const { projectId: selectedProjectId } = useProjectSelection();

  useEffect(() => {
    let active = true;

    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => {
        if (!active) return;
        setItems(data.items || []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredItems = selectedProjectId
    ? items.filter((project) => project.id === selectedProjectId)
    : items;

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          {loading ? (
            <div className="assistant-card-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="assistant-card animate-pulse" style={{ minHeight: 120 }}>
                  <div className="h-4 w-2/3 rounded bg-[var(--border)] mb-3" />
                  <div className="h-3 w-full rounded bg-[var(--border)]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="assistant-card-grid">
              <Link href="/app/assistants/new" className="assistant-card is-create">
                <span className="assistant-card-plus">+</span>
                <span>{t("createNew")}</span>
              </Link>

              {filteredItems.map((project) => {
                const modelName = extractModelName(project.description);
                const desc = cleanDescription(project.description);
                return (
                  <Link
                    key={project.id}
                    href={`/app/assistants/${project.id}`}
                    className="assistant-card"
                  >
                    <div className="assistant-card-name">{project.name}</div>
                    {modelName && (
                      <div className="assistant-card-model">{modelName}</div>
                    )}
                    <div className="assistant-card-desc">
                      {desc || t("noDescription")}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
