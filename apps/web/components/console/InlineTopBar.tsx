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

  const showProjectSelect = /^\/app(?:\/(assistants|chat))?(?:\/|$)/.test(pathname);
  const currentProjectLabel =
    projectLabels.get(projectId) ||
    projects.find((project) => project.id === projectId)?.name ||
    t("statusbar.noProject");

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
        <div className="inline-topbar-project" role="group" aria-label={t("topbar.selectProject")}>
          <div className="inline-topbar-project-meta">
            <span className="inline-topbar-project-label">
              {t("topbar.currentProject")}
            </span>
            <span className="inline-topbar-project-count">{projects.length}</span>
          </div>

          <div className="inline-topbar-project-control">
            <span className="inline-topbar-project-current">{currentProjectLabel}</span>
            <select
              className="inline-topbar-project-select"
              aria-label={t("topbar.selectProject")}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
