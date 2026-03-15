"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useProjectContext } from "@/lib/ProjectContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Check if a string looks like a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function BreadcrumbNav() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => {
    let label: string;
    if (t.has(`breadcrumb.${seg}`)) {
      label = t(`breadcrumb.${seg}`);
    } else if (isUUID(seg)) {
      label = `${seg.slice(0, 8)}...`;
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

export function InlineTopBar() {
  return (
    <div className="inline-topbar">
      <BreadcrumbNav />
      <ProjectSwitcher />
    </div>
  );
}
