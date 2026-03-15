"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { logout } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function Breadcrumb() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);

  const crumbs = segments.map((seg, i) => {
    let label: string;
    if (t.has(`breadcrumb.${seg}`)) {
      label = t(`breadcrumb.${seg}`);
    } else if (isUUID(seg)) {
      label = `${seg.slice(0, 8)}\u2026`;
    } else {
      label = seg;
    }
    return {
      label,
      href: "/" + segments.slice(0, i + 1).join("/"),
      isLast: i === segments.length - 1,
    };
  });

  return (
    <div className="console-topbar-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center">
          {i > 0 && <span className="console-topbar-sep">/</span>}
          {crumb.isLast ? (
            <span className="console-topbar-crumb is-current">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href} className="console-topbar-crumb">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </div>
  );
}

export function ConsoleTopBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const targetLocale = locale === "zh" ? "en" : "zh";
  const targetLabel = locale === "zh" ? "EN" : "中文";

  return (
    <header className="console-topbar">
      <div className="console-topbar-left">
        <Link href="/app/assistants" className="console-topbar-brand">
          <div className="console-topbar-logo" />
          <span className="console-topbar-brand-text">铭润</span>
        </Link>
        <Breadcrumb />
      </div>
      <div className="console-topbar-right">
        <button className="console-topbar-kbd" type="button">
          <kbd>⌘K</kbd>
        </button>
        <Link
          href={pathname}
          locale={targetLocale}
          className="console-topbar-lang"
        >
          {targetLabel}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="console-topbar-avatar" type="button">
              <span className="console-topbar-avatar-text">U</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void logout()}>
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
