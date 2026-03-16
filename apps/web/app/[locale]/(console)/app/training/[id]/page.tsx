"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function TrainingDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-training");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">Job {jobId?.slice(0, 8)}...</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-body">
              <p className="text-sm text-[var(--text-secondary)]">
                Coming soon — training job details will be implemented here.
              </p>
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
