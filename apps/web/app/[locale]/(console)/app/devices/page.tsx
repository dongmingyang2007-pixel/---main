import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function DevicesPage() {
  const t = useTranslations("console-devices");

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

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">{t("panel.title")}</h2>
            <p className="console-panel-description">{t("panel.description")}</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-empty">{t("empty")}</div>
        </div>
      </section>

      <section className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">{t("plannedKicker")}</div>
          <div className="console-key-grid mt-4">
            {([
              ["pairing", "pairingDesc"],
              ["firmware", "firmwareDesc"],
              ["diagnostics", "diagnosticsDesc"],
              ["logs", "logsDesc"],
            ] as const).map(([labelKey, valueKey]) => (
              <div key={labelKey} className="console-key-item">
                <div className="console-key-label">{t(`module.${labelKey}`)}</div>
                <div className="console-key-value">{t(`module.${valueKey}`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
