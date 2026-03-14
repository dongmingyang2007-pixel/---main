"use client";

import clsx from "clsx";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TOP_ITEMS = [
  { href: "/app", key: "nav.dashboard", icon: "dashboard" },
  { href: "/app/projects", key: "nav.projects", icon: "projects" },
  { href: "/app/datasets", key: "nav.datasets", icon: "datasets" },
  { href: "/app/train", key: "nav.train", icon: "train" },
  { href: "/app/models", key: "nav.models", icon: "models" },
  { href: "/app/eval", key: "nav.eval", icon: "eval" },
];

const BOTTOM_ITEMS = [
  { href: "/app/devices", key: "nav.devices", icon: "devices", comingSoon: true },
  { href: "/app/billing", key: "nav.billing", icon: "billing", comingSoon: true },
  { href: "/app/settings", key: "nav.settings", icon: "settings" },
];

const ICON_PATHS: Record<string, string> = {
  dashboard:
    "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  projects:
    "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z",
  datasets:
    "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v12z",
  train:
    "M15.5 2.5L12 6l3.5 3.5L17 8l2 2-5 5-2-2-1.5 1.5L14 18l6-6-4.5-4.5zM2 18l6-6 4.5 4.5-6 6L2 18z",
  models:
    "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  eval: "M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2 2H5V5h14v14zm0-16H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  devices:
    "M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z",
  billing:
    "M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
};

function ActivityIcon({ name }: { name: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d={ICON_PATHS[name] || ICON_PATHS.dashboard} />
    </svg>
  );
}

export function ActivityBar() {
  const pathname = usePathname();
  const t = useTranslations("console");

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="activity-bar" role="navigation" aria-label="Main">
        <div className="activity-bar-top">
          {TOP_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={clsx(
                    "activity-bar-item",
                    isActive(item.href) && "is-active",
                  )}
                  aria-label={t(item.key)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <ActivityIcon name={item.icon} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(item.key)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="activity-bar-bottom">
          {BOTTOM_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={clsx(
                    "activity-bar-item",
                    isActive(item.href) && "is-active",
                  )}
                  aria-label={t(item.key)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <ActivityIcon name={item.icon} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(item.key)}
                {"comingSoon" in item && item.comingSoon && (
                  <span className="ml-1 text-xs opacity-60">{t("nav.comingSoon")}</span>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
