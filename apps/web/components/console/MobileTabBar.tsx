"use client";

import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

function AssistantsIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width={16} height={12} x={4} y={8} rx={2} />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function TrainingIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={1} />
      <circle cx={19} cy={12} r={1} />
      <circle cx={5} cy={12} r={1} />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width={14} height={20} x={5} y={2} rx={2} />
      <path d="M12 18h.01" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

const MAIN_TABS = [
  { href: "/app/assistants", labelKey: "nav.assistants" as const, short: "AI", Icon: AssistantsIcon },
  { href: "/app/knowledge", labelKey: "nav.knowledge" as const, short: "知识", Icon: KnowledgeIcon },
  { href: "/app/training", labelKey: "nav.training" as const, short: "训练", Icon: TrainingIcon },
  { href: "/app/chat", labelKey: "nav.chat" as const, short: "对话", Icon: ChatIcon },
];

const MORE_ITEMS = [
  { href: "/app/models", labelKey: "nav.models" as const, Icon: ChatIcon },
  { href: "/app/devices", labelKey: "nav.devices" as const, Icon: DevicesIcon },
  { href: "/app/settings", labelKey: "nav.settings" as const, Icon: SettingsIcon },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => pathname.startsWith(href);

  // Close the dropdown when clicking outside
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const moreIsActive = MORE_ITEMS.some((item) => isActive(item.href));

  return (
    <nav className="mobile-tab-bar" role="navigation" aria-label="Mobile navigation">
      {MAIN_TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx("mobile-tab-item", active && "is-active")}
            aria-current={active ? "page" : undefined}
            aria-label={t(tab.labelKey)}
            onClick={() => setMoreOpen(false)}
          >
            <span className="mobile-tab-icon">
              <tab.Icon />
            </span>
            <span>{tab.short}</span>
          </Link>
        );
      })}

      {/* More button with dropdown */}
      <div ref={moreRef} className="mobile-tab-more-wrapper">
        {moreOpen && (
          <div className="mobile-tab-more-menu" role="menu">
            {MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx("mobile-tab-more-item", isActive(item.href) && "is-active")}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
              >
                <item.Icon />
                <span>{t(item.labelKey)}</span>
              </Link>
            ))}
          </div>
        )}
        <button
          type="button"
          className={clsx("mobile-tab-item", (moreOpen || moreIsActive) && "is-active")}
          aria-label="更多"
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className="mobile-tab-icon">
            <MoreIcon />
          </span>
          <span>更多</span>
        </button>
      </div>
    </nav>
  );
}
