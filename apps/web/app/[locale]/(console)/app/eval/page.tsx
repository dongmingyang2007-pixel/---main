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
            <h2 className="console-panel-title">{t("createTitle")}</h2>
            <p className="console-panel-description">{t("createDescription")}</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-form-grid columns-4">
            <div>
              <label className="console-label" htmlFor="eval-a">{t("labelModelA")}</label>
              <input id="eval-a" className="console-input" value={a} onChange={(e) => setA(e.target.value)} placeholder={t("placeholderModelA")} required />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-b">{t("labelModelB")}</label>
              <input id="eval-b" className="console-input" value={b} onChange={(e) => setB(e.target.value)} placeholder={t("placeholderModelB")} required />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-dataset">{t("labelDatasetVersion")}</label>
              <input
                id="eval-dataset"
                className="console-input"
                value={datasetVersionId}
                onChange={(e) => setDatasetVersionId(e.target.value)}
                placeholder={t("placeholderDatasetVersion")}
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
                    setError(err instanceof Error ? err.message : t("createError"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? t("submitting") : t("submitButton")}
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
                  <h2 className="console-panel-title">{t("summaryTitle")}</h2>
                  <p className="console-panel-description">
                    {result.status === "completed"
                      ? winner
                        ? t("summaryWinner", { winner })
                        : t("summaryTied")
                      : t("summaryStatus", { status: result.status || t("summaryProcessing") })}
                  </p>
                </div>
              </div>
              <div className="console-panel-body">
                <div className="console-form-grid columns-3">
                  <div className="console-key-item">
                    <div className="console-key-label">{t("versionA")}</div>
                    <div className="console-key-value">{result.model_version_a || a}</div>
                  </div>
                  <div className="console-key-item">
                    <div className="console-key-label">{t("versionB")}</div>
                    <div className="console-key-value">{result.model_version_b || b}</div>
                  </div>
                  <div className="console-key-item">
                    <div className="console-key-label">{t("datasetVersion")}</div>
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
                    <h2 className="console-panel-title">{t("metricsTitle")}</h2>
                    <p className="console-panel-description">{t("metricsDescription")}</p>
                  </div>
                </div>
                <div className="console-panel-body">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="text-left">{t("metricHeader")}</th>
                          <th className="text-right">{t("scoreA")}</th>
                          <th className="text-right">{t("scoreB")}</th>
                          <th className="text-right">{t("diff")}</th>
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
                    <h2 className="console-panel-title">{t("samplesTitle")}</h2>
                    <p className="console-panel-description">{t("samplesDescription")}</p>
                  </div>
                </div>
                <div className="console-panel-body">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="text-left">{t("sampleHeader")}</th>
                          <th className="text-left">{t("inputHeader")}</th>
                          <th className="text-left">{t("outputAHeader")}</th>
                          <th className="text-left">{t("outputBHeader")}</th>
                          <th className="text-left">{t("verdictHeader")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {samples.map((s, idx) => (
                          <tr key={s.sample_id ?? idx}>
                            <td className="font-mono text-xs">{s.sample_id?.slice(0, 8) ?? "-"}</td>
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
                <h2 className="console-panel-title">{t("rawTitle")}</h2>
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
            <div className="console-empty">{t("emptyHint")}</div>
          </div>
        </section>
      )}

      {busy && (
        <section className="console-panel">
          <div className="console-panel-body">
            <div className="console-empty">{t("busyHint")}</div>
          </div>
        </section>
      )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
