"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function KnowledgeDetailPage() {
  const params = useParams<{ id: string }>();
  const knowledgeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-knowledge");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">ID: {knowledgeId?.slice(0, 8)}...</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-body">
              <p className="text-sm text-[var(--text-secondary)]">
                Coming soon — knowledge pack details will be implemented here.
              </p>
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
