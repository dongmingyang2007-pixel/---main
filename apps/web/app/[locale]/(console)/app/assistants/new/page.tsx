"use client";

import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function NewAssistantPage() {
  const t = useTranslations("console-assistants");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("createNew")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-body">
              <p className="text-sm text-[var(--text-secondary)]">
                Coming soon — assistant creation form will be implemented here.
              </p>
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
