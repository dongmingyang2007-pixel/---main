"use client";

import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { ReactNode } from "react";
import { useTranslations } from "next-intl";

const NAV_KEYS = [
  { href: "/app", key: "dashboard" },
  { href: "/app/assistants", key: "assistants" },
  { href: "/app/chat", key: "chat" },
  { href: "/app/memory", key: "memory" },
  { href: "/app/devices", key: "devices" },
  { href: "/app/discover", key: "discover" },
  { href: "/app/settings", key: "settings" },
];

const ROUTE_KEYS = [
  { match: (p: string) => p === "/app", key: "app" },
  { match: (p: string) => p.startsWith("/app/assistants"), key: "assistants" },
  { match: (p: string) => p.startsWith("/app/chat"), key: "chat" },
  { match: (p: string) => p.startsWith("/app/memory"), key: "memory" },
  { match: (p: string) => p.startsWith("/app/devices"), key: "devices" },
  { match: (p: string) => p.startsWith("/app/discover"), key: "discover" },
  { match: (p: string) => p.startsWith("/app/settings"), key: "settings" },
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
