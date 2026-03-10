"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { JobLogViewer } from "@/components/JobLogViewer";
import { MetricChart } from "@/components/MetricChart";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/api";

type MetricPoint = { key: string; value: number; step: number };
type ArtifactItem = { id: string; name: string; download_url: string };

type JobResponse = {
  job: {
    id: string;
    recipe: string;
    status: "pending" | "running" | "succeeded" | "failed" | "canceled";
    params_json: Record<string, unknown>;
    summary_json: {
      logs?: string[];
      metrics?: MetricPoint[];
      run_id?: string;
      run_status?: string;
      artifacts?: ArtifactItem[];
    };
  };
};

export default function TrainDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [job, setJob] = useState<JobResponse["job"] | null>(null);
  const [useSse, setUseSse] = useState(false);
  const eventRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(() => {
      if (!useSse) {
        void apiGet<JobResponse>(`/api/v1/train/jobs/${jobId}`).then((data) => setJob(data.job));
      }
    }, 2000);
    void apiGet<JobResponse>(`/api/v1/train/jobs/${jobId}`).then((data) => setJob(data.job));
    return () => clearInterval(timer);
  }, [jobId, useSse]);

  useEffect(() => {
    if (!jobId) return;
    if (!useSse) {
      eventRef.current?.close();
      return;
    }
    const source = new EventSource(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/train/jobs/${jobId}/events`, {
      withCredentials: true,
    });
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { status: JobResponse["job"]["status"] };
      setJob((prev) => (prev ? { ...prev, status: data.status } : prev));
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { line: string };
      setJob((prev) =>
        prev
          ? {
              ...prev,
              summary_json: {
                ...prev.summary_json,
                logs: [...(prev.summary_json.logs || []), data.line],
              },
            }
          : prev,
      );
    });
    source.addEventListener("metric", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as MetricPoint;
      setJob((prev) =>
        prev
          ? {
              ...prev,
              summary_json: {
                ...prev.summary_json,
                metrics: [...(prev.summary_json.metrics || []), data],
              },
            }
          : prev,
      );
    });
    source.addEventListener("artifact", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ArtifactItem;
      setJob((prev) => {
        if (!prev) return prev;
        const artifacts = prev.summary_json.artifacts || [];
        if (artifacts.some((artifact) => artifact.id === data.id)) {
          return prev;
        }
        return {
          ...prev,
          summary_json: {
            ...prev.summary_json,
            artifacts: [...artifacts, data],
          },
        };
      });
    });
    eventRef.current = source;
    return () => source.close();
  }, [jobId, useSse]);

  const chartData = useMemo(() => {
    const grouped = new Map<number, { step: number; loss?: number; acc?: number }>();
    for (const metric of job?.summary_json.metrics || []) {
      const current = grouped.get(metric.step) || { step: metric.step };
      if (metric.key === "loss") current.loss = metric.value;
      if (metric.key === "acc") current.acc = metric.value;
      grouped.set(metric.step, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.step - b.step);
  }, [job]);

  if (!job) {
    return <div className="console-panel"><div className="console-panel-body">加载中...</div></div>;
  }

  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">Training Job</div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="console-panel-title">{job.recipe}</h2>
                <p className="console-panel-description">
                  Job ID: {job.id}
                  <br />
                  Run: {job.summary_json.run_id ? `${job.summary_json.run_id.slice(0, 8)}...` : "尚未创建"}
                  {" · "}
                  Run 状态: {job.summary_json.run_status || "pending"}
                </p>
              </div>
              <StatusBadge status={job.status} />
            </div>
          </div>
        </div>

        <aside className="console-panel">
          <div className="console-panel-body">
            <label className="console-key-item flex items-center gap-3">
              <input type="checkbox" checked={useSse} onChange={(e) => setUseSse(e.target.checked)} />
              <span>使用 SSE 实时流，关闭后退回 2 秒轮询。</span>
            </label>
          </div>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <JobLogViewer logs={job.summary_json.logs || []} />
        <MetricChart data={chartData} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="console-panel">
          <div className="console-panel-header">
            <div>
              <h2 className="console-panel-title">参数</h2>
              <p className="console-panel-description">保留原始训练参数，方便复盘失败或回放成功配置。</p>
            </div>
          </div>
          <div className="console-panel-body">
            <pre className="console-code">{JSON.stringify(job.params_json, null, 2)}</pre>
          </div>
        </div>

        <aside className="console-panel">
          <div className="console-panel-header">
            <div>
              <h2 className="console-panel-title">产物列表</h2>
              <p className="console-panel-description">下载链接来自后端签名，前端不暴露原始对象 key。</p>
            </div>
          </div>
          <div className="console-panel-body">
            {!job.summary_json.artifacts?.length ? (
              <div className="console-empty">暂无产物</div>
            ) : (
              <div className="space-y-3">
                {job.summary_json.artifacts.map((artifact) => (
                  <div key={artifact.id} className="console-key-item">
                    <div className="console-key-label">{artifact.name}</div>
                    <a className="console-link mt-2 inline-flex" href={artifact.download_url} target="_blank" rel="noreferrer">
                      打开产物
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </>
  );
}
