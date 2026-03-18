"use client";

import { useTranslations } from "next-intl";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";

export function StatusBar() {
  const { projectId, projects } = useProjectContext();
  const currentProject = projects.find((p) => p.id === projectId);
  const projectLabels = buildProjectDisplayMap(projects);
  const t = useTranslations("console");

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <div className="statusbar-left">
        <span className="statusbar-indicator" title={t("statusbar.apiConnected")} />
        <span className="text-xs text-[var(--text-secondary)]">
          {currentProject
            ? (projectLabels.get(currentProject.id) || currentProject.name)
            : t("statusbar.noProject")}
        </span>
      </div>
      <div className="statusbar-right">
        <span className="text-xs text-[var(--text-secondary)]">v0.1</span>
      </div>
    </div>
  );
}
