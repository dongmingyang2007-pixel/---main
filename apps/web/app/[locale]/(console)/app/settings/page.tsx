"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { logout } from "@/lib/api";

export default function SettingsPage() {
  const [msg, setMsg] = useState("");
  const t = useTranslations("console-settings");

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
          <div className="console-actions">
            <button
              className="console-button"
              onClick={() => logout()}
            >
              {t("logout")}
            </button>
            <button
              className="console-button-danger"
              onClick={() => setMsg(t("deleteConfirmation"))}
            >
              {t("deleteData")}
            </button>
          </div>
          {msg ? <div className="console-inline-notice is-success mt-4">{msg}</div> : null}
        </div>
      </section>

      <aside className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">{t("securityKicker")}</div>
          <ul className="site-feature-list mt-4">
            <li>{t("securityNote1")}</li>
            <li>{t("securityNote2")}</li>
            <li>{t("securityNote3")}</li>
          </ul>
        </div>
      </aside>
    </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
