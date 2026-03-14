"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { Uploader } from "@/components/Uploader";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost } from "@/lib/api";

type DataItem = {
  id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  width?: number;
  height?: number;
  meta_json: Record<string, unknown>;
  preview_url?: string;
  download_url?: string;
  annotations: Array<{ id: string; type: string; payload_json: { tags?: string[] } }>;
};

type DatasetVersion = {
  id: string;
  version: number;
  item_count: number;
  created_at: string;
};

export default function DatasetDetailPage() {
  const params = useParams<{ id: string }>();
  const datasetId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [items, setItems] = useState<DataItem[]>([]);
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "gallery">("table");
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [commitMessage, setCommitMessage] = useState("v1 baseline");
  const [commitResult, setCommitResult] = useState("");

  const load = async () => {
    const [data, versionData] = await Promise.all([
      apiGet<DataItem[]>(`/api/v1/datasets/${datasetId}/items?limit=50&offset=0`),
      apiGet<DatasetVersion[]>(`/api/v1/datasets/${datasetId}/versions`).catch(() => []),
    ]);
    setItems(data);
    setVersions(versionData);
  };

  useEffect(() => {
    if (!datasetId) return;
    void load();
  }, [datasetId]);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              Datasets
            </p>
            <h1 className="mt-2 text-2xl font-bold">数据集详情</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">浏览样本、上传文件和管理版本。</p>
          </div>

      <Uploader datasetId={datasetId} onDone={() => void load()} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="console-panel">
          <div className="console-panel-header">
            <div>
              <h2 className="console-panel-title">样本浏览</h2>
              <p className="console-panel-description">支持表格和图片墙两种视图，所有预览和下载都走签名 URL。</p>
            </div>
            <div className="console-actions">
              <button
                className={viewMode === "table" ? "console-button" : "console-button-secondary"}
                onClick={() => setViewMode("table")}
              >
                表格
              </button>
              <button
                className={viewMode === "gallery" ? "console-button" : "console-button-secondary"}
                onClick={() => setViewMode("gallery")}
              >
                图片墙
              </button>
            </div>
          </div>
          <div className="console-panel-body">
            <div className="console-form-grid columns-3">
              <div className="md:col-span-2">
                <label className="console-label" htmlFor="commit-message">版本提交说明</label>
                <input
                  id="commit-message"
                  className="console-input"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  className="console-button w-full"
                  onClick={async () => {
                    const res = await apiPost<{ dataset_version: { id: string; version: number } }>(
                      `/api/v1/datasets/${datasetId}/commit`,
                      { commit_message: commitMessage, freeze_filter: { tag: null } },
                    );
                    setCommitResult(`已提交版本 v${res.dataset_version.version}`);
                    await load();
                  }}
                >
                  Commit 数据版本
                </button>
              </div>
            </div>
            {commitResult ? <div className="console-inline-notice is-success mt-4">{commitResult}</div> : null}
          </div>
        </div>

        <aside className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">Version History</div>
            {!versions.length ? (
              <div className="console-empty mt-4">暂无版本，请先 Commit。</div>
            ) : (
              <div className="mt-4 space-y-3">
                {versions.map((version) => (
                  <div key={version.id} className="console-key-item">
                    <div className="console-key-label">v{version.version}</div>
                    <div className="console-key-value">
                      样本数 {version.item_count}
                      <br />
                      {version.id.slice(0, 8)}... · {new Date(version.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>

      {viewMode === "table" ? (
        <DataTable
          caption="样本表格"
          headers={["文件", "类型", "尺寸", "标注", "操作"]}
          emptyTitle="暂无样本"
          emptyBody="先上传文件，随后可以在这里快速打标签或通过签名链接打开原文件。"
          rows={items.map((item) => [
            <div key={item.id}>
              <div className="font-semibold text-[var(--text-primary)]">{item.filename}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{item.id.slice(0, 8)}...</div>
            </div>,
            item.media_type,
            `${item.width || "-"} x ${item.height || "-"}`,
            item.annotations.filter((annotation) => annotation.type === "tag").map((annotation) => (annotation.payload_json.tags || []).join(",")).join(" | ") || "-",
            <div key={`${item.id}-actions`} className="flex flex-wrap gap-2">
              <input
                className="console-input !min-h-[40px] !w-[170px] !rounded-[14px] px-3 text-xs"
                placeholder="tag1,tag2"
                value={tagInput[item.id] || ""}
                onChange={(e) =>
                  setTagInput((prev) => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }))
                }
              />
              <button
                className="console-button-secondary !min-h-[40px]"
                onClick={async () => {
                  const tags = (tagInput[item.id] || "").split(",").map((value) => value.trim()).filter(Boolean);
                  await apiPost(`/api/v1/data-items/${item.id}/annotations`, {
                    type: "tag",
                    payload_json: { tags },
                  });
                  await load();
                }}
              >
                保存标签
              </button>
              {item.download_url ? (
                <a className="console-button-secondary !min-h-[40px]" href={item.download_url} target="_blank" rel="noreferrer">
                  下载
                </a>
              ) : null}
            </div>,
          ])}
        />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.length ? (
            items.map((item) => (
              <article key={item.id} className="console-panel overflow-hidden">
                <div className="console-panel-body">
                  {item.preview_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.preview_url} alt={item.filename} className="h-48 w-full rounded-2xl bg-[#eef2f8] object-cover" />
                  ) : (
                    <div className="console-empty">无预览</div>
                  )}
                  <div className="mt-4 font-semibold text-[var(--text-primary)]">{item.filename}</div>
                  <div className="mt-2 text-sm text-[var(--text-secondary)]">
                    {item.width || "-"} x {item.height || "-"} · {item.media_type}
                  </div>
                  {item.download_url ? (
                    <a className="console-link mt-3 inline-flex" href={item.download_url} target="_blank" rel="noreferrer">
                      打开原文件
                    </a>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="console-panel sm:col-span-2 lg:col-span-3">
              <div className="console-panel-body">
                <div className="console-empty">暂无样本</div>
              </div>
            </div>
          )}
        </section>
      )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
