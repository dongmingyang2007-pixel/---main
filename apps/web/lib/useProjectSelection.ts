"use client";

import { useEffect, useRef, useState } from "react";

import { apiGet } from "@/lib/api";

export type ProjectOption = {
  id: string;
  name: string;
};

let cachedProjects: ProjectOption[] = [];
let cachedProjectId = "";

export function useProjectSelection(
  onProjectChange?: (projectId: string) => Promise<void> | void,
) {
  const [projects, setProjects] = useState<ProjectOption[]>(() => cachedProjects);
  const [projectId, setProjectIdState] = useState(() => cachedProjectId);
  const projectIdRef = useRef(projectId);
  const onProjectChangeRef = useRef(onProjectChange);

  useEffect(() => {
    onProjectChangeRef.current = onProjectChange;
  }, [onProjectChange]);

  const syncProjectSelection = async (nextProjectId: string) => {
    cachedProjectId = nextProjectId;
    projectIdRef.current = nextProjectId;
    setProjectIdState(nextProjectId);
    if (nextProjectId) {
      await onProjectChangeRef.current?.(nextProjectId);
    }
  };

  const loadProjects = async (options: { revalidateOnly?: boolean } = {}) => {
    const data = await apiGet<{ items: ProjectOption[] }>("/api/v1/projects");
    const list = data.items || [];
    cachedProjects = list;
    setProjects(list);

    const preferredProjectId = projectIdRef.current || cachedProjectId;
    const currentProjectStillExists = list.some((project) => project.id === preferredProjectId);
    const nextProjectId = currentProjectStillExists ? preferredProjectId : (list[0]?.id ?? "");

    if (nextProjectId !== projectIdRef.current) {
      await syncProjectSelection(nextProjectId);
      return;
    }

    if (nextProjectId && !options.revalidateOnly) {
      await onProjectChangeRef.current?.(nextProjectId);
    }
  };

  useEffect(() => {
    if (cachedProjects.length) {
      setProjects(cachedProjects);
    }
    if (cachedProjectId) {
      projectIdRef.current = cachedProjectId;
      setProjectIdState(cachedProjectId);
      void onProjectChangeRef.current?.(cachedProjectId);
      void loadProjects({ revalidateOnly: true });
      return;
    }
    void loadProjects();
  }, []);

  return {
    projectId,
    projects,
    loadProjects,
    selectProject: syncProjectSelection,
  };
}
