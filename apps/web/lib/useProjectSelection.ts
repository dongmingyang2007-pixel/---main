"use client";

import { useEffect, useRef, useState } from "react";

import { apiGet } from "@/lib/api";

export type ProjectOption = {
  id: string;
  name: string;
};

export function useProjectSelection(
  onProjectChange?: (projectId: string) => Promise<void> | void,
) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectIdState] = useState("");
  const projectIdRef = useRef(projectId);
  const onProjectChangeRef = useRef(onProjectChange);

  onProjectChangeRef.current = onProjectChange;

  const syncProjectSelection = async (nextProjectId: string) => {
    projectIdRef.current = nextProjectId;
    setProjectIdState(nextProjectId);
    if (nextProjectId) {
      await onProjectChangeRef.current?.(nextProjectId);
    }
  };

  const loadProjects = async () => {
    const data = await apiGet<{ items: ProjectOption[] }>("/api/v1/projects");
    const list = data.items || [];
    setProjects(list);

    const currentProjectStillExists = list.some((project) => project.id === projectIdRef.current);
    const nextProjectId = currentProjectStillExists ? projectIdRef.current : (list[0]?.id ?? "");

    if (nextProjectId !== projectIdRef.current) {
      await syncProjectSelection(nextProjectId);
      return;
    }

    if (nextProjectId) {
      await onProjectChangeRef.current?.(nextProjectId);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  return {
    projectId,
    projects,
    loadProjects,
    selectProject: syncProjectSelection,
  };
}
