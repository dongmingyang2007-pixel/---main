import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function BillingPage() {
  const t = useTranslations("console-billing");

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

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
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

      <aside className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">Future Quotas</div>
          <ul className="site-feature-list mt-4">
            <li>训练并发与保留天数</li>
            <li>对象存储额度与带宽</li>
            <li>团队成员数与 workspace 级权限</li>
          </ul>
        </div>
      </aside>
    </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
