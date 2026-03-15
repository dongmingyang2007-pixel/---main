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
}

const TOP_ITEMS: NavItem[] = [
  { href: "/app/assistants", key: "nav.assistants" },
  { href: "/app/knowledge", key: "nav.knowledge" },
  { href: "/app/training", key: "nav.training" },
  { href: "/app/chat", key: "nav.chat" },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/app/devices", key: "nav.devices" },
  { href: "/app/settings", key: "nav.settings" },
];

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

function DevicesIcon() {
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
      <rect width={14} height={20} x={5} y={2} rx={2} />
      <path d="M12 18h.01" />
    </svg>
  );
}

function SettingsIcon() {
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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

const ICON_MAP: Record<string, () => JSX.Element> = {
  "nav.assistants": AssistantsIcon,
  "nav.knowledge": KnowledgeIcon,
  "nav.training": TrainingIcon,
  "nav.chat": ChatIcon,
  "nav.devices": DevicesIcon,
  "nav.settings": SettingsIcon,
};

export function IconBar() {
  const pathname = usePathname();
  const t = useTranslations("console");

  const isActive = (href: string) => pathname.startsWith(href);

  const renderItem = (item: NavItem) => {
    const IconComponent = ICON_MAP[item.key];
    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            className={clsx(
              "icon-bar-item",
              isActive(item.href) && "is-active",
            )}
            aria-label={t(item.key)}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            {IconComponent && <IconComponent />}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {t(item.key)}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="icon-bar" role="navigation" aria-label="Main">
        <div className="icon-bar-top">
          {TOP_ITEMS.map(renderItem)}
        </div>
        <div className="icon-bar-bottom">
          {BOTTOM_ITEMS.map(renderItem)}
        </div>
      </nav>
    </TooltipProvider>
  );
}
