"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";

type DatasetItem = {
  id: string;
  name: string;
  type: string;
};

type TrainingJobItem = {
  id: string;
  status: string;
  recipe: string;
};

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleSectionList() {
  const pathname = usePathname();
  const tConsole = useTranslations("console");
  const tAssistants = useTranslations("console-assistants");
  const tKnowledge = useTranslations("console-knowledge");
  const tTraining = useTranslations("console-training");
  const { projectId, projects, selectProject } = useProjectContext();
  const projectLabels = useMemo(() => buildProjectDisplayMap(projects), [projects]);

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [jobs, setJobs] = useState<TrainingJobItem[]>([]);

  const section = useMemo(() => {
    if (pathname.startsWith("/app/assistants")) return "assistants";
    if (pathname.startsWith("/app/knowledge")) return "knowledge";
    if (pathname.startsWith("/app/training")) return "training";
    if (pathname.startsWith("/app/chat")) return "chat";
    return null;
  }, [pathname]);

  useEffect(() => {
    if (section !== "knowledge" || !projectId) {
      return;
    }
    let active = true;
    void apiGet<DatasetItem[]>(`/api/v1/datasets?project_id=${projectId}`)
      .then((data) => {
        if (active) setDatasets(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setDatasets([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, section]);

  useEffect(() => {
    if (section !== "training" || !projectId) {
      return;
    }
    let active = true;
    void apiGet<{ items: TrainingJobItem[] }>(
      `/api/v1/train/jobs?project_id=${projectId}`,
    )
      .then((data) => {
        if (active) setJobs(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (active) setJobs([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, section]);

  if (!section) {
    return null;
  }

  const visibleDatasets = section === "knowledge" && projectId ? datasets : [];
  const visibleJobs = section === "training" && projectId ? jobs : [];

  if (section === "assistants") {
    return (
      <div className="console-section-list">
        <div className="console-section-list-header">
          <div className="console-section-list-title">{tConsole("nav.assistants")}</div>
        </div>
        <div className="console-section-list-items">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/app/assistants/${project.id}`}
              className={`console-section-list-link${project.id === projectId ? " is-active" : ""}`}
              onClick={() => {
                void selectProject(project.id);
              }}
            >
              <span className="console-section-list-name">
                {projectLabels.get(project.id) || project.name}
              </span>
            </Link>
          ))}
        </div>
        <Link href="/app/assistants/new" className="console-section-list-create">
          + {tAssistants("createNew")}
        </Link>
      </div>
    );
  }

  if (section === "chat") {
    return (
      <div className="console-section-list">
        <div className="console-section-list-header">
          <div className="console-section-list-title">{tConsole("nav.chat")}</div>
        </div>
        <div className="console-section-list-items">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`console-section-list-link${project.id === projectId ? " is-active" : ""}`}
              onClick={() => {
                void selectProject(project.id);
              }}
            >
              <span className="console-section-list-name">
                {projectLabels.get(project.id) || project.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (section === "knowledge") {
    return (
      <div className="console-section-list">
        <div className="console-section-list-header">
          <div className="console-section-list-title">{tConsole("nav.knowledge")}</div>
        </div>
        <div className="console-section-list-items">
          {visibleDatasets.map((dataset) => (
            <Link
              key={dataset.id}
              href={`/app/knowledge/${dataset.id}`}
              className={`console-section-list-link${isActivePath(pathname, `/app/knowledge/${dataset.id}`) ? " is-active" : ""}`}
            >
              <span className="console-section-list-name">{dataset.name}</span>
              <span className="console-section-list-meta">{dataset.type}</span>
            </Link>
          ))}
          {visibleDatasets.length === 0 ? (
            <div className="console-section-list-empty">{tKnowledge("noItems")}</div>
          ) : null}
        </div>
        <Link href="/app/knowledge" className="console-section-list-create">
          + {tKnowledge("createNew")}
        </Link>
      </div>
    );
  }

  return (
    <div className="console-section-list">
      <div className="console-section-list-header">
        <div className="console-section-list-title">{tConsole("nav.training")}</div>
      </div>
      <div className="console-section-list-items">
        {visibleJobs.map((job) => (
          <Link
            key={job.id}
            href={`/app/training/${job.id}`}
            className={`console-section-list-link${isActivePath(pathname, `/app/training/${job.id}`) ? " is-active" : ""}`}
          >
            <span className="console-section-list-name">{job.recipe}</span>
            <span className="console-section-list-meta">
              {job.id.slice(0, 8)}… · {job.status}
            </span>
          </Link>
        ))}
        {visibleJobs.length === 0 ? (
          <div className="console-section-list-empty">{tTraining("noJobs")}</div>
        ) : null}
      </div>
    </div>
  );
}
