"use client";

import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function ChatPage() {
  const t = useTranslations("console-chat");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <section className="console-panel">
            <div className="console-panel-body">
              <p className="text-sm text-[var(--text-secondary)]">
                {t("emptyHint")}
              </p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {t("mockNotice")}
              </p>
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
