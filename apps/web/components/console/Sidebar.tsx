"use client";

import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  key: string;
  Icon: () => JSX.Element;
}

/* ── Icons ── */

function HomeIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2v4m0 12v4m-7.07-15.07l2.83 2.83m8.48 8.48l2.83 2.83m-17.07 0l2.83-2.83m8.48-8.48l2.83-2.83" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function DiscoverIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={10} />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ── Nav items ── */

const NAV_ITEMS: NavItem[] = [
  { href: "/app", key: "nav.home", Icon: HomeIcon },
  { href: "/app/chat", key: "nav.chat", Icon: ChatIcon },
  { href: "/app/memory", key: "nav.memory", Icon: MemoryIcon },
  { href: "/app/devices", key: "nav.devices", Icon: DevicesIcon },
  { href: "/app/discover", key: "nav.discover", Icon: DiscoverIcon },
];

/* ── Component ── */

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("console");

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="sidebar-v2" role="navigation" aria-label="Main">
        {/* Logo */}
        <div className="sidebar-v2-logo">
          <div className="sidebar-v2-logo-icon">铭</div>
          <div className="sidebar-v2-logo-text">铭润科技</div>
        </div>

        {/* Nav items */}
        <div className="sidebar-v2-nav">
          {NAV_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  prefetch={false}
                  className={clsx("sidebar-v2-item", isActive(item.href) && "is-active")}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <span className="sidebar-v2-icon">
                    <item.Icon />
                  </span>
                  <span className="sidebar-v2-label">{t(item.key)}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="sidebar-v2-tooltip">
                {t(item.key)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* User area */}
        <div className="sidebar-v2-footer">
          <Link href="/app/settings" prefetch={false} className="sidebar-v2-user">
            <span className="sidebar-v2-icon">
              <SettingsIcon />
            </span>
            <span className="sidebar-v2-label">{t("nav.settings")}</span>
          </Link>
        </div>
      </nav>
    </TooltipProvider>
  );
}
