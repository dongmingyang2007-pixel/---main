"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";

type EvalMetric = {
  metric: string;
  score_a: number;
  score_b: number;
};

type EvalSample = {
  sample_id: string;
  input_preview?: string;
  output_a?: string;
  output_b?: string;
  verdict?: string;
};

type EvalResult = {
  eval_id: string;
  status?: string;
  model_version_a?: string;
  model_version_b?: string;
  dataset_version_id?: string;
  summary?: { winner?: string; metrics?: EvalMetric[] };
  samples?: EvalSample[];
  [key: string]: unknown;
};

export default function EvalPage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [result, setResult] = useState<EvalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useTranslations("console-eval");

  const metrics = result?.summary?.metrics;
  const samples = result?.samples;
  const winner = result?.summary?.winner;

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("description")}</p>
          </div>

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">创建评测回放</h2>
            <p className="console-panel-description">输入两个模型版本和一个数据版本，快速生成一份可复盘的对比结果。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-form-grid columns-4">
            <div>
              <label className="console-label" htmlFor="eval-a">model_version_a</label>
              <input id="eval-a" className="console-input" value={a} onChange={(e) => setA(e.target.value)} placeholder="模型版本 A" required />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-b">model_version_b</label>
              <input id="eval-b" className="console-input" value={b} onChange={(e) => setB(e.target.value)} placeholder="模型版本 B" required />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-dataset">dataset_version_id</label>
              <input
                id="eval-dataset"
                className="console-input"
                value={datasetVersionId}
                onChange={(e) => setDatasetVersionId(e.target.value)}
                placeholder="数据版本 ID"
                required
              />
            </div>
            <div className="flex items-end">
              <button
                className="console-button w-full"
                disabled={busy || !a || !b || !datasetVersionId}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setResult(null);
                  try {
                    const created = await apiPost<{ eval_id: string }>("/api/v1/eval/runs", {
                      model_version_a: a,
                      model_version_b: b,
                      dataset_version_id: datasetVersionId,
                    });
                    const run = await apiGet<EvalResult>(`/api/v1/eval/runs/${created.eval_id}`);
                    setResult(run);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "创建评测失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "创建中..." : "创建评测回放"}
              </button>
            </div>
          </div>
          {error ? <div className="console-inline-notice is-error mt-4">{error}</div> : null}
        </div>
      </section>

      {result && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4">
            {/* Summary card */}
            <section className="console-panel">
              <div className="console-panel-header">
                <div>
                  <h2 className="console-panel-title">评测摘要</h2>
                  <p className="console-panel-description">
                    {result.status === "completed"
                      ? winner
                        ? `推荐版本：${winner}`
                        : "评测完成，两版本表现接近。"
                      : `状态：${result.status || "处理中"}`}
                  </p>
                </div>
              </div>
              <div className="console-panel-body">
                <div className="console-form-grid columns-3">
                  <div className="console-key-item">
                    <div className="console-key-label">版本 A</div>
                    <div className="console-key-value">{result.model_version_a || a}</div>
                  </div>
                  <div className="console-key-item">
                    <div className="console-key-label">版本 B</div>
                    <div className="console-key-value">{result.model_version_b || b}</div>
                  </div>
                  <div className="console-key-item">
                    <div className="console-key-label">数据版本</div>
                    <div className="console-key-value">{result.dataset_version_id || datasetVersionId}</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Metrics comparison */}
            {metrics && metrics.length > 0 && (
              <section className="console-panel">
                <div className="console-panel-header">
                  <div>
                    <h2 className="console-panel-title">指标对比</h2>
                    <p className="console-panel-description">逐项对比两个版本在各指标上的得分。</p>
                  </div>
                </div>
                <div className="console-panel-body">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="text-left">指标</th>
                          <th className="text-right">版本 A</th>
                          <th className="text-right">版本 B</th>
                          <th className="text-right">差值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((m) => {
                          const diff = m.score_b - m.score_a;
                          return (
                            <tr key={m.metric}>
                              <td>{m.metric}</td>
                              <td className="text-right font-mono">{m.score_a.toFixed(4)}</td>
                              <td className="text-right font-mono">{m.score_b.toFixed(4)}</td>
                              <td className={`text-right font-mono ${diff > 0 ? "text-[var(--success-v2)]" : diff < 0 ? "text-[var(--error)]" : ""}`}>
                                {diff > 0 ? "+" : ""}{diff.toFixed(4)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Sample playback */}
            {samples && samples.length > 0 && (
              <section className="console-panel">
                <div className="console-panel-header">
                  <div>
                    <h2 className="console-panel-title">样本回放</h2>
                    <p className="console-panel-description">对比各样本在两个版本下的输出。</p>
                  </div>
                </div>
                <div className="console-panel-body">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="text-left">样本</th>
                          <th className="text-left">输入</th>
                          <th className="text-left">输出 A</th>
                          <th className="text-left">输出 B</th>
                          <th className="text-left">判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {samples.map((s) => (
                          <tr key={s.sample_id}>
                            <td className="font-mono text-xs">{s.sample_id.slice(0, 8)}</td>
                            <td className="max-w-[200px] truncate">{s.input_preview || "-"}</td>
                            <td className="max-w-[200px] truncate">{s.output_a || "-"}</td>
                            <td className="max-w-[200px] truncate">{s.output_b || "-"}</td>
                            <td>{s.verdict || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Raw JSON sidebar */}
          <aside className="console-panel self-start">
            <div className="console-panel-header">
              <div>
                <h2 className="console-panel-title">原始数据</h2>
              </div>
            </div>
            <div className="console-panel-body">
              <pre className="console-code max-h-[520px] text-xs">{JSON.stringify(result, null, 2)}</pre>
            </div>
          </aside>
        </div>
      )}

      {!result && !busy && (
        <section className="console-panel">
          <div className="console-panel-body">
            <div className="console-empty">填写版本信息后点击「创建评测回放」查看对比结果。</div>
          </div>
        </section>
      )}

      {busy && (
        <section className="console-panel">
          <div className="console-panel-body">
            <div className="console-empty">评测创建中，请稍候...</div>
          </div>
        </section>
      )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
