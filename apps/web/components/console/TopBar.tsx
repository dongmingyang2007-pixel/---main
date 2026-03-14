"use client";

import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useProjectContext } from "@/lib/ProjectContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function BreadcrumbNav() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: t.has(`breadcrumb.${seg}`) ? t(`breadcrumb.${seg}`) : seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <div className="topbar-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-[var(--text-secondary)] opacity-40">/</span>
          )}
          {crumb.isLast ? (
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </div>
  );
}

function ProjectSwitcher() {
  const { projectId, projects, selectProject } = useProjectContext();
  const t = useTranslations("console");
  const current = projects.find((p) => p.id === projectId);

  if (!projects.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-project-switcher">
        <span className="truncate text-sm">
          {current?.name || t("topbar.selectProject")}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          className="opacity-50"
        >
          <path d="M3 5l3 3 3-3H3z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => void selectProject(p.id)}
            className={p.id === projectId ? "font-semibold" : ""}
          >
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const t = useTranslations("console");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-avatar" aria-label={t("topbar.userMenu")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/app/settings">{t("topbar.settings")}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/">{t("topbar.backToSite")}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const t = useTranslations("console");
  const tc = useTranslations("common");

  return (
    <header className="topbar">
      <div className="topbar-left">
        {onMenuClick && (
          <button
            className="topbar-hamburger"
            onClick={onMenuClick}
            aria-label={t("topbar.openMenu")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <Link href="/" className="topbar-brand">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
          <strong className="text-sm font-semibold tracking-tight">
            {tc("brand.company")}
          </strong>
        </Link>
        <span className="topbar-separator" />
        <ProjectSwitcher />
        <span className="topbar-separator" />
        <BreadcrumbNav />
      </div>
      <div className="topbar-right">
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
