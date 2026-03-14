"use client";

import { useEffect, useRef } from "react";

import { useProjectContext, type ProjectOption } from "@/lib/ProjectContext";

export type { ProjectOption };

export function useProjectSelection(
  onProjectChange?: (projectId: string) => Promise<void> | void,
) {
  const ctx = useProjectContext();
  const onProjectChangeRef = useRef(onProjectChange);
  const lastNotifiedIdRef = useRef("");

  useEffect(() => {
    onProjectChangeRef.current = onProjectChange;
  }, [onProjectChange]);

  useEffect(() => {
    if (ctx.projectId && ctx.projectId !== lastNotifiedIdRef.current) {
      lastNotifiedIdRef.current = ctx.projectId;
      void onProjectChangeRef.current?.(ctx.projectId);
    }
  }, [ctx.projectId]);

  const selectProject = async (nextProjectId: string) => {
    await ctx.selectProject(nextProjectId);
    lastNotifiedIdRef.current = nextProjectId;
    if (nextProjectId) {
      await onProjectChangeRef.current?.(nextProjectId);
    }
  };

  return {
    projectId: ctx.projectId,
    projects: ctx.projects,
    loadProjects: ctx.loadProjects,
    selectProject,
  };
}
