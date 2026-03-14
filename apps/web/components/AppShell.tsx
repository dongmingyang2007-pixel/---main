"use client";

import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { ReactNode } from "react";
import { useTranslations } from "next-intl";

const NAV_KEYS = [
  { href: "/app", key: "dashboard" },
  { href: "/app/projects", key: "projects" },
  { href: "/app/datasets", key: "datasets" },
  { href: "/app/train", key: "train" },
  { href: "/app/models", key: "models" },
  { href: "/app/eval", key: "eval" },
  { href: "/app/settings", key: "settings" },
  { href: "/app/devices", key: "devices", comingSoon: true },
  { href: "/app/billing", key: "billing", comingSoon: true },
];

const ROUTE_KEYS = [
  { match: (p: string) => p === "/app", key: "app" },
  { match: (p: string) => p.startsWith("/app/projects"), key: "projects" },
  { match: (p: string) => p.startsWith("/app/datasets"), key: "datasets" },
  { match: (p: string) => p.startsWith("/app/train"), key: "train" },
  { match: (p: string) => p.startsWith("/app/models"), key: "models" },
  { match: (p: string) => p.startsWith("/app/eval"), key: "eval" },
  { match: (p: string) => p.startsWith("/app/settings"), key: "settings" },
  { match: (p: string) => p.startsWith("/app/devices"), key: "devices" },
  { match: (p: string) => p.startsWith("/app/billing"), key: "billing" },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("console");
  const currentRoute = ROUTE_KEYS.find((item) => item.match(pathname));

  return (
    <div className="shell-grid console-frame">
      <aside className="console-aside">
        <div className="console-brand">
          <div className="console-kicker text-white/70">{t("shell.brand")}</div>
          <div className="display-face mt-2">{t("shell.subtitle")}</div>
          <p className="mt-3 text-sm leading-6 text-white/72">{t("shell.brandBody")}</p>
          <div className="console-brand-pills">
            <span>{t("shell.pill0")}</span>
            <span>{t("shell.pill1")}</span>
            <span>{t("shell.pill2")}</span>
          </div>
        </div>

        <nav className="console-nav">
          {NAV_KEYS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={clsx("console-nav-link", isActive && "is-active")}
              >
                <span className="flex items-center gap-2">
                  {t(`nav.${item.key}`)}
                  {item.comingSoon && <span className="console-coming-soon">{t("shell.comingSoon")}</span>}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">{t(`breadcrumb.${item.key}`)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">{t("shell.workspace")}</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{t("shell.workspaceTitle")}</div>
            <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{t("shell.workspaceBody")}</div>
            <div className="console-side-metadata">
              <span>{t("shell.signedAccess")}</span>
              <span>{t("shell.workspaceBound")}</span>
              <span>{t("shell.auditReady")}</span>
            </div>
          </div>
        </div>
      </aside>
      <main className="console-main">
        <header className="console-header">
          <div className="console-header-copy">
            <div className="console-kicker">{currentRoute ? t(`route.${currentRoute.key}.kicker`) : t("shell.defaultKicker")}</div>
            <h1 className="console-title">{currentRoute ? t(`route.${currentRoute.key}.title`) : title}</h1>
            <p className="console-description">{currentRoute ? t(`route.${currentRoute.key}.description`) : t("shell.defaultDescription")}</p>
          </div>
          <div className="console-header-actions">
            <div className="console-header-rail">
              <span>{t("shell.headerPill0")}</span>
              <span>{t("shell.headerPill1")}</span>
              <span>{t("shell.headerPill2")}</span>
            </div>
            <Link className="console-button-secondary" href="/">
              {t("shell.backToSite")}
            </Link>
          </div>
        </header>
        <div className="console-surface">{children}</div>
      </main>
    </div>
  );
}
