"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, logout } from "@/lib/api";
import { useDeveloperMode } from "@/lib/developer-mode";

type UserMe = { id: string; email: string; display_name?: string };

export default function SettingsPage() {
  const t = useTranslations("console-settings");
  const locale = useLocale();
  const pathname = usePathname();
  const { isDeveloperMode, toggleDeveloperMode } = useDeveloperMode();

  const [user, setUser] = useState<UserMe | null>(null);
  const [deleteMsg, setDeleteMsg] = useState("");

  const targetLocale = locale === "zh" ? "en" : "zh";
  const targetLabel = locale === "zh" ? "English" : "中文";

  useEffect(() => {
    void apiGet<UserMe>("/api/v1/auth/me")
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

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

          {/* Account */}
          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">{t("settings.account")}</h2>
              </div>
            </div>
            <div className="console-panel-body">
              <div className="console-key-item">
                <div className="console-key-label">{t("settings.email")}</div>
                <div className="console-key-value font-mono">
                  {user ? user.email : t("settings.loadingUser")}
                </div>
              </div>
              {user?.display_name && (
                <div className="console-key-item mt-3">
                  <div className="console-key-label">{t("settings.name")}</div>
                  <div className="console-key-value">{user.display_name}</div>
                </div>
              )}
            </div>
          </section>

          {/* Language */}
          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">{t("settings.language")}</h2>
                <p className="console-panel-description">{t("settings.languageDesc")}</p>
              </div>
            </div>
            <div className="console-panel-body">
              <Link
                href={pathname}
                locale={targetLocale}
                className="console-button-secondary inline-flex items-center gap-2"
              >
                {t("settings.switchTo")} {targetLabel}
              </Link>
            </div>
          </section>

          {/* Developer Mode */}
          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">{t("settings.developerMode")}</h2>
                <p className="console-panel-description">{t("settings.developerModeDesc")}</p>
              </div>
            </div>
            <div className="console-panel-body">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <button
                  role="switch"
                  aria-checked={isDeveloperMode}
                  onClick={toggleDeveloperMode}
                  className={[
                    "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--warning)]",
                    isDeveloperMode
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--border)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out",
                      isDeveloperMode ? "translate-x-5" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>
                <span className="text-sm">
                  {isDeveloperMode ? t("settings.developerModeOn") : t("settings.developerModeOff")}
                </span>
              </label>
            </div>
          </section>

          {/* Subscription */}
          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">{t("settings.subscription")}</h2>
                <p className="console-panel-description">{t("settings.subscriptionDesc")}</p>
              </div>
              <div className="flex-none">
                <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-[var(--warning)] text-white">
                  {t("settings.freePlan")}
                </span>
              </div>
            </div>
            <div className="console-panel-body">
              <div className="console-kicker mb-3">{t("settings.quotasKicker")}</div>
              <ul className="site-feature-list">
                <li>{t("settings.quota1")}</li>
                <li>{t("settings.quota2")}</li>
                <li>{t("settings.quota3")}</li>
              </ul>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">{t("settings.dangerZone")}</h2>
                <p className="console-panel-description">{t("settings.dangerZoneDesc")}</p>
              </div>
            </div>
            <div className="console-panel-body">
              <div className="console-actions">
                <button
                  className="console-button"
                  onClick={() => void logout()}
                >
                  {t("settings.logout")}
                </button>
                <button
                  className="console-button-danger"
                  onClick={() => setDeleteMsg(t("settings.deleteConfirm"))}
                >
                  {t("settings.deleteData")}
                </button>
              </div>
              {deleteMsg ? (
                <div className="console-inline-notice is-success mt-4">{deleteMsg}</div>
              ) : null}
            </div>
          </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
