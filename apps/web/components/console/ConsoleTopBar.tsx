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
import { Breadcrumb } from "./Breadcrumb";

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
