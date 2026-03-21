"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { usePathname } from "@/i18n/navigation";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";
import { useMobileMenu } from "@/components/MobileMenuProvider";
import { Breadcrumb } from "./Breadcrumb";

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

  const showProjectSelect = /^\/app\/(assistants|chat)(?:\/|$)/.test(pathname);

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

        <Breadcrumb
          projectNames={projectNames}
          className="inline-topbar-breadcrumb"
        />
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
