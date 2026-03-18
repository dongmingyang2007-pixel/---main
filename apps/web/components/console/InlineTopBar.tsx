"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";
import { useMobileMenu } from "@/components/MobileMenuProvider";

type TranslateFn = ReturnType<typeof useTranslations>;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatSegment(
  segment: string,
  t: TranslateFn,
  projectNames: Map<string, string>,
): string {
  const decoded = decodeURIComponent(segment);
  if (projectNames.has(decoded)) {
    return projectNames.get(decoded) || decoded;
  }
  if (t.has(`breadcrumb.${decoded}`)) {
    return t(`breadcrumb.${decoded}`);
  }
  if (isUuid(decoded)) {
    return `${decoded.slice(0, 8)}…`;
  }
  return decoded;
}

export function InlineTopBar() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const { openMenu } = useMobileMenu();
  const { projectId, projects, selectProject } = useProjectContext();
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectLabels = useMemo(() => buildProjectDisplayMap(projects), [projects]);

  const crumbs = useMemo(() => {
    const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
    return segments.map((segment, index) => ({
      href: `/${segments.slice(0, index + 1).join("/")}`,
      label: formatSegment(segment, t, projectNames),
      isLast: index === segments.length - 1,
    }));
  }, [pathname, projectNames, t]);

  const showProjectSelect = /^\/app\/(assistants|knowledge|training|chat)(?:\/|$)/.test(pathname);

  return (
    <div className="inline-topbar">
      <div className="inline-topbar-left">
        <button
          type="button"
          className="inline-topbar-menu"
          onClick={openMenu}
          aria-label={t("topbar.openMenu")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="inline-topbar-breadcrumb" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={crumb.href} className="flex items-center">
              {index > 0 && <span className="console-topbar-sep">/</span>}
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
      </div>

      {showProjectSelect && projects.length > 0 ? (
        <label className="inline-topbar-project">
          <span className="inline-topbar-project-label">
            {t("topbar.selectProject")}
          </span>
          <select
            className="inline-topbar-project-select"
            value={projectId}
            onChange={(event) => {
              void selectProject(event.target.value);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {projectLabels.get(project.id) || project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
