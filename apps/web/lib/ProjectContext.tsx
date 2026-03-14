"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";

export type ProjectOption = {
  id: string;
  name: string;
};

type ProjectContextValue = {
  projectId: string;
  projects: ProjectOption[];
  loadProjects: (options?: { revalidateOnly?: boolean }) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return ctx;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectIdState] = useState("");
  const projectIdRef = useRef("");

  const syncProjectSelection = useCallback(async (nextProjectId: string) => {
    projectIdRef.current = nextProjectId;
    setProjectIdState(nextProjectId);
  }, []);

  const loadProjects = useCallback(async (options: { revalidateOnly?: boolean } = {}) => {
    const data = await apiGet<{ items: ProjectOption[] }>("/api/v1/projects");
    const list = data.items || [];
    setProjects(list);

    const preferredProjectId = projectIdRef.current;
    const currentProjectStillExists = list.some((project) => project.id === preferredProjectId);
    const nextProjectId = currentProjectStillExists ? preferredProjectId : (list[0]?.id ?? "");

    if (nextProjectId !== projectIdRef.current || !options.revalidateOnly) {
      projectIdRef.current = nextProjectId;
      setProjectIdState(nextProjectId);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <ProjectContext.Provider
      value={{
        projectId,
        projects,
        loadProjects,
        selectProject: syncProjectSelection,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
