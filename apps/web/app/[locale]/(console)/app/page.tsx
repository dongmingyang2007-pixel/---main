"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ConsoleSkeleton } from "@/components/ConsoleSkeleton";
import { ContentRail } from "@/components/ContentRail";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { StudioSection } from "@/components/StudioSection";
import { apiGet } from "@/lib/api";

type Project = { id: string };
type Dataset = { id: string };
type Job = { id: string };
type Model = { id: string };
type ModelAlias = { alias: "prod" | "staging" | "dev"; model_version_id: string };
type ModelVersion = { id: string; version: number };

export default function DashboardPage() {
  const [summary, setSummary] = useState({ projects: 0, datasets: 0, jobs: 0, modelVersion: "-" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const projectsResp = await apiGet<{ items: Project[] }>("/api/v1/projects").catch(() => ({ items: [] }));
      const projects = projectsResp.items || [];
      if (!projects.length) {
        setSummary({ projects: 0, datasets: 0, jobs: 0, modelVersion: "-" });
        return;
      }

      const [datasetLists, jobLists, modelLists] = await Promise.all([
        Promise.all(projects.map((project) => apiGet<Dataset[]>(`/api/v1/datasets?project_id=${project.id}`).catch(() => []))),
        Promise.all(
          projects.map((project) =>
            apiGet<{ items: Job[] }>(`/api/v1/train/jobs?project_id=${project.id}`).catch(() => ({ items: [] })),
          ),
        ),
        Promise.all(
          projects.map((project) =>
            apiGet<{ items: Model[] }>(`/api/v1/models?project_id=${project.id}`).catch(() => ({ items: [] })),
          ),
        ),
      ]);

      const models = modelLists.flatMap((item) => item.items || []);
      let prodVersion = "-";
      for (const model of models) {
        const [detail, versions] = await Promise.all([
          apiGet<{ aliases: ModelAlias[] }>(`/api/v1/models/${model.id}`).catch(() => ({ aliases: [] })),
          apiGet<{ items: ModelVersion[] }>(`/api/v1/models/${model.id}/versions`).catch(() => ({ items: [] })),
        ]);
        const prodAlias = (detail.aliases || []).find((item) => item.alias === "prod");
        if (!prodAlias) {
          continue;
        }
        const targetVersion = (versions.items || []).find((version) => version.id === prodAlias.model_version_id);
        prodVersion = targetVersion ? `v${targetVersion.version}` : `${prodAlias.model_version_id.slice(0, 8)}...`;
        break;
      }

      setSummary({
        projects: projects.length,
        datasets: datasetLists.reduce((acc, list) => acc + list.length, 0),
        jobs: jobLists.reduce((acc, item) => acc + (item.items?.length || 0), 0),
        modelVersion: prodVersion,
      });
    }

    void load().finally(() => setLoading(false));
  }, []);

  if (loading) return <PanelLayout><ConsoleSkeleton rows={4} /></PanelLayout>;

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              Studio Overview
            </p>
            <h1 className="mt-2 text-2xl font-bold">数据工作台总览</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">先看状态，再决定下一步进入项目、数据集、训练还是模型仓。</p>
          </div>

      <ContentRail
        eyebrow="Live Summary"
        title="工作台状态先看成一条信号带。"
        summary="总览页优先回答当前 workspace 里有什么、跑到了哪一步，而不是先把信息切成四张统计卡。"
        items={[
          { label: "Projects", title: String(summary.projects), body: "当前 workspace 下的项目容器。", meta: "项目数" },
          { label: "Datasets", title: String(summary.datasets), body: "可继续扩充和冻结版本的数据入口。", meta: "数据集数" },
          { label: "Jobs", title: String(summary.jobs), body: "已经创建的训练作业。", meta: "训练任务" },
          { label: "Prod", title: summary.modelVersion, body: "当前正式发布版本。", meta: "当前 Prod" },
        ]}
        variant="metrics"
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <StudioSection
          eyebrow="Quick Flow"
          title="快捷入口"
          description="从数据到发布，保持在同一条操作线上。"
        >
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["/app/projects", "项目", "先确定工作边界。"],
                ["/app/datasets", "数据集", "上传、整理、冻结版本。"],
                ["/app/train", "训练", "创建任务并查看过程。"],
                ["/app/models", "模型仓", "登记版本并发布。"],
              ].map(([href, title, body]) => (
                <Link key={href} href={href} className="console-key-item">
                  <div className="console-key-label">{title}</div>
                  <div className="console-key-value">{body}</div>
                </Link>
                ))}
              </div>
        </StudioSection>

        <StudioSection
          eyebrow="Operating Rules"
          title="当前控制台原则"
          description="这套工作台优先保证边界、回滚和复盘链路始终可见。"
        >
          <div className="console-note-stack">
            <div className="console-note-item">上传和模型产物都走受管签名路径。</div>
            <div className="console-note-item">敏感操作要求 Cookie、workspace 和 CSRF 同时成立。</div>
            <div className="console-note-item">训练、评测和发布默认保留复盘信息。</div>
          </div>
        </StudioSection>
      </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
