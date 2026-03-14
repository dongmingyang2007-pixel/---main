"use client";

import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [project, setProject] = useState<{ id: string; name: string; description?: string } | null>(null);
  const t = useTranslations("console-projects");

  useEffect(() => {
    if (!projectId) return;
    void apiGet<{ id: string; name: string; description?: string }>(`/api/v1/projects/${projectId}`).then(setProject);
  }, [projectId]);

  if (!project) {
    return <PanelLayout><div className="console-panel"><div className="console-panel-body">{t("loading")}</div></div></PanelLayout>;
  }

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("detail.kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("detail.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("detail.description")}</p>
          </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">{project.name}</h2>
            <p className="console-panel-description">{project.description || "当前项目还没有补充描述。"}</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-key-grid">
            {[
              ["/app/datasets", "数据集", "上传样本、提交数据版本。"],
              ["/app/train", "训练任务", "为当前项目创建训练作业。"],
              ["/app/models", "模型仓", "登记版本并发布 alias。"],
              ["/app/eval", "评测", "对比不同模型版本的结果。"],
            ].map(([href, label, value]) => (
              <Link key={href} className="console-key-item" href={href}>
                <div className="console-key-label">{label}</div>
                <div className="console-key-value">{value}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <aside className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">Project ID</div>
          <div className="console-code mt-4">{project.id}</div>
        </div>
      </aside>
    </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
