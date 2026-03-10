"use client";

import { useState } from "react";

import { apiGet, apiPost } from "@/lib/api";

export default function EvalPage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
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
              <input id="eval-a" className="console-input" value={a} onChange={(e) => setA(e.target.value)} placeholder="模型版本 A" />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-b">model_version_b</label>
              <input id="eval-b" className="console-input" value={b} onChange={(e) => setB(e.target.value)} placeholder="模型版本 B" />
            </div>
            <div>
              <label className="console-label" htmlFor="eval-dataset">dataset_version_id</label>
              <input
                id="eval-dataset"
                className="console-input"
                value={datasetVersionId}
                onChange={(e) => setDatasetVersionId(e.target.value)}
                placeholder="数据版本 ID"
              />
            </div>
            <div className="flex items-end">
              <button
                className="console-button w-full"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const created = await apiPost<{ eval_id: string }>("/api/v1/eval/runs", {
                      model_version_a: a,
                      model_version_b: b,
                      dataset_version_id: datasetVersionId,
                    });
                    const run = await apiGet(`/api/v1/eval/runs/${created.eval_id}`);
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

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">评测结果</h2>
            <p className="console-panel-description">当前保持原始 JSON 输出，后续可继续拆成摘要、差异和样本回放视图。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <pre className="console-code max-h-[520px]">{JSON.stringify(result, null, 2)}</pre>
        </div>
      </section>
    </>
  );
}
