"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";

type ModelVersion = {
  id: string;
  version: number;
  metrics_json: Record<string, unknown>;
  notes?: string;
  created_at: string;
};

type Alias = { id: string; alias: "prod" | "staging" | "dev"; model_version_id: string };

type EvalMetric = {
  metric: string;
  score_a: number;
  score_b: number;
};

type EvalResult = {
  eval_id: string;
  status?: string;
  model_version_a?: string;
  model_version_b?: string;
  summary?: { winner?: string; metrics?: EvalMetric[] };
  [key: string]: unknown;
};

export default function AssistantVersionsPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");

  const [modelId, setModelId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollbackBusy, setRollbackBusy] = useState<string | null>(null);

  // Comparison state
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalError, setEvalError] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const modelsData = await apiGet<{ items: Array<{ id: string; name: string }> }>(
        `/api/v1/models?project_id=${projectId}`,
      );
      const items = modelsData.items || [];
      if (!items.length) {
        setLoading(false);
        return;
      }
      const firstModel = items[0];
      setModelId(firstModel.id);
      const detail = await apiGet<{ model: { id: string; name: string }; aliases: Alias[] }>(
        `/api/v1/models/${firstModel.id}`,
      );
      const versionData = await apiGet<{ items: ModelVersion[] }>(
        `/api/v1/models/${firstModel.id}/versions`,
      );
      setAliases(detail.aliases || []);
      setVersions(versionData.items || []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const prodAlias = aliases.find((a) => a.alias === "prod");

  const handleRollback = async (versionId: string) => {
    if (!modelId) return;
    setRollbackBusy(versionId);
    try {
      await apiPost(`/api/v1/models/${modelId}/rollback`, {
        alias: "prod",
        to_model_version_id: versionId,
      });
      await load();
    } finally {
      setRollbackBusy(null);
    }
  };

  const handleCompare = async () => {
    if (!compareA || !compareB) return;
    setEvalBusy(true);
    setEvalError("");
    setEvalResult(null);
    try {
      const created = await apiPost<{ eval_id: string }>("/api/v1/eval/runs", {
        model_version_a: compareA,
        model_version_b: compareB,
      });
      const run = await apiGet<EvalResult>(`/api/v1/eval/runs/${created.eval_id}`);
      setEvalResult(run);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : t("versions.compareError"));
    } finally {
      setEvalBusy(false);
    }
  };

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("title")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("versions.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("versions.description")}</p>
          </div>

          {loading && (
            <section className="console-panel">
              <div className="console-panel-body">
                <div className="console-empty">{t("versions.loading")}</div>
              </div>
            </section>
          )}

          {!loading && !modelId && (
            <section className="console-panel">
              <div className="console-panel-body">
                <div className="console-empty">{t("versions.noVersions")}</div>
              </div>
            </section>
          )}

          {!loading && modelId && versions.length === 0 && (
            <section className="console-panel">
              <div className="console-panel-body">
                <div className="console-empty">{t("versions.noVersions")}</div>
              </div>
            </section>
          )}

          {!loading && versions.length > 0 && (
            <section className="console-panel">
              <div className="console-panel-header">
                <div>
                  <h2 className="console-panel-title">{t("versions.title")}</h2>
                  <p className="console-panel-description">{t("versions.description")}</p>
                </div>
              </div>
              <div className="console-panel-body">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                        <th className="pb-2 pr-4 font-medium">{t("versions.colVersion")}</th>
                        <th className="pb-2 pr-4 font-medium">{t("versions.colCreated")}</th>
                        <th className="pb-2 pr-4 font-medium">{t("versions.colMetrics")}</th>
                        <th className="pb-2 font-medium">{t("versions.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => {
                        const isProd = prodAlias?.model_version_id === v.id;
                        const isRollingBack = rollbackBusy === v.id;
                        const metricsKeys = Object.keys(v.metrics_json || {}).slice(0, 3);
                        return (
                          <tr key={v.id} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-semibold">v{v.version}</span>
                                {isProd && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--accent-amber)] text-[var(--bg)] uppercase tracking-wider">
                                    {t("versions.current")}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                                {v.id.slice(0, 8)}&hellip;
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-[var(--text-secondary)]">
                              {new Date(v.created_at).toLocaleString()}
                            </td>
                            <td className="py-3 pr-4">
                              {metricsKeys.length > 0 ? (
                                <div className="space-y-0.5">
                                  {metricsKeys.map((k) => (
                                    <div key={k} className="text-xs">
                                      <span className="text-[var(--text-secondary)]">{k}: </span>
                                      <span className="font-mono">{String(v.metrics_json[k])}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[var(--text-secondary)]">—</span>
                              )}
                            </td>
                            <td className="py-3">
                              {!isProd && (
                                <button
                                  className="console-button-secondary text-xs px-3 py-1"
                                  disabled={isRollingBack}
                                  onClick={() => void handleRollback(v.id)}
                                >
                                  {isRollingBack ? t("versions.rollingBack") : t("versions.rollback")}
                                </button>
                              )}
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

          {!loading && versions.length >= 2 && (
            <section className="console-panel">
              <div className="console-panel-header">
                <div>
                  <h2 className="console-panel-title">{t("versions.compare")}</h2>
                  <p className="console-panel-description">{t("versions.selectTwo")}</p>
                </div>
              </div>
              <div className="console-panel-body">
                <div className="console-form-grid columns-3">
                  <div>
                    <label className="console-label" htmlFor="compare-a">
                      {t("versions.versionA")}
                    </label>
                    <select
                      id="compare-a"
                      className="console-select"
                      value={compareA}
                      onChange={(e) => setCompareA(e.target.value)}
                    >
                      <option value="">{t("versions.selectVersion")}</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version} ({v.id.slice(0, 8)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="console-label" htmlFor="compare-b">
                      {t("versions.versionB")}
                    </label>
                    <select
                      id="compare-b"
                      className="console-select"
                      value={compareB}
                      onChange={(e) => setCompareB(e.target.value)}
                    >
                      <option value="">{t("versions.selectVersion")}</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version} ({v.id.slice(0, 8)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      className="console-button w-full"
                      disabled={evalBusy || !compareA || !compareB || compareA === compareB}
                      onClick={() => void handleCompare()}
                    >
                      {evalBusy ? t("versions.comparing") : t("versions.compare")}
                    </button>
                  </div>
                </div>
                {evalError && (
                  <div className="console-inline-notice is-error mt-4">{evalError}</div>
                )}
              </div>

              {evalResult && (
                <div className="console-panel-body border-t border-[var(--border)]">
                  <div className="console-kicker mb-4">{t("versions.compareResult")}</div>
                  {evalResult.summary?.metrics && evalResult.summary.metrics.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[var(--text-secondary)]">
                            <th className="pb-2 pr-4 font-medium">{t("versions.metricName")}</th>
                            <th className="pb-2 pr-4 text-right font-medium">v A</th>
                            <th className="pb-2 pr-4 text-right font-medium">v B</th>
                            <th className="pb-2 text-right font-medium">{t("versions.diff")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evalResult.summary.metrics.map((m) => {
                            const diff = m.score_b - m.score_a;
                            return (
                              <tr key={m.metric} className="border-t border-[var(--border)]">
                                <td className="py-2 pr-4">{m.metric}</td>
                                <td className="py-2 pr-4 text-right font-mono">{m.score_a.toFixed(4)}</td>
                                <td className="py-2 pr-4 text-right font-mono">{m.score_b.toFixed(4)}</td>
                                <td
                                  className={`py-2 text-right font-mono ${diff > 0 ? "text-[var(--success-v2)]" : diff < 0 ? "text-[var(--error)]" : ""}`}
                                >
                                  {diff > 0 ? "+" : ""}
                                  {diff.toFixed(4)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-secondary)]">
                      {evalResult.summary?.winner
                        ? t("versions.winner", { winner: evalResult.summary.winner })
                        : t("versions.noMetrics")}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
