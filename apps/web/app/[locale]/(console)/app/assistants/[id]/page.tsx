"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");

  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void apiGet<{ id: string; name: string }>(`/api/v1/projects/${projectId}`).then((data) => {
      setName(data.name);
    });
  }, [projectId]);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{name ?? t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-body">
              <p className="text-sm text-[var(--text-secondary)]">
                Coming soon — assistant configuration will be implemented here.
              </p>
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
