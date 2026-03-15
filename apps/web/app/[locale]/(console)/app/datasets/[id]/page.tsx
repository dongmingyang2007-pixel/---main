"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("console-datasets");

  const load = useCallback(async () => {
    const [data, versionData] = await Promise.all([
      apiGet<DataItem[]>(`/api/v1/datasets/${datasetId}/items?limit=50&offset=0`),
      apiGet<DatasetVersion[]>(`/api/v1/datasets/${datasetId}/versions`).catch(() => []),
    ]);
    setItems(data);
    setVersions(versionData);
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) return;
    let active = true;

    void Promise.all([
      apiGet<DataItem[]>(`/api/v1/datasets/${datasetId}/items?limit=50&offset=0`),
      apiGet<DatasetVersion[]>(`/api/v1/datasets/${datasetId}/versions`).catch(() => []),
    ]).then(([data, versionData]) => {
      if (!active) return;
      setItems(data);
      setVersions(versionData);
    });

    return () => {
      active = false;
    };
  }, [datasetId]);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("detail.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("detail.description")}</p>
          </div>

      <Uploader datasetId={datasetId} onDone={() => void load()} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="console-panel">
          <div className="console-panel-header">
            <div>
              <h2 className="console-panel-title">{t("detail.browseTitle")}</h2>
              <p className="console-panel-description">{t("detail.browseDescription")}</p>
            </div>
            <div className="console-actions">
              <button
                className={viewMode === "table" ? "console-button" : "console-button-secondary"}
                onClick={() => setViewMode("table")}
              >
                {t("detail.viewTable")}
              </button>
              <button
                className={viewMode === "gallery" ? "console-button" : "console-button-secondary"}
                onClick={() => setViewMode("gallery")}
              >
                {t("detail.viewGallery")}
              </button>
            </div>
          </div>
          <div className="console-panel-body">
            <div className="console-form-grid columns-3">
              <div className="md:col-span-2">
                <label className="console-label" htmlFor="commit-message">{t("detail.commitLabel")}</label>
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
                    setCommitResult(t("detail.committed", { version: res.dataset_version.version }));
                    await load();
                  }}
                >
                  {t("detail.commitButton")}
                </button>
              </div>
            </div>
            {commitResult ? <div className="console-inline-notice is-success mt-4">{commitResult}</div> : null}
          </div>
        </div>

        <aside className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">{t("detail.historyKicker")}</div>
            {!versions.length ? (
              <div className="console-empty mt-4">{t("detail.noVersions")}</div>
            ) : (
              <div className="mt-4 space-y-3">
                {versions.map((version) => (
                  <div key={version.id} className="console-key-item">
                    <div className="console-key-label">v{version.version}</div>
                    <div className="console-key-value">
                      {t("detail.itemCount")} {version.item_count}
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
          caption={t("table.caption")}
          headers={[t("table.file"), t("table.type"), t("table.size"), t("table.annotation"), t("table.actions")]}
          emptyTitle={t("table.emptyTitle")}
          emptyBody={t("table.emptyBody")}
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
                {t("table.saveTag")}
              </button>
              {item.download_url ? (
                <a className="console-button-secondary !min-h-[40px]" href={item.download_url} target="_blank" rel="noreferrer">
                  {t("table.download")}
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
                    <div className="console-empty">{t("detail.noPreview")}</div>
                  )}
                  <div className="mt-4 font-semibold text-[var(--text-primary)]">{item.filename}</div>
                  <div className="mt-2 text-sm text-[var(--text-secondary)]">
                    {item.width || "-"} x {item.height || "-"} · {item.media_type}
                  </div>
                  {item.download_url ? (
                    <a className="console-link mt-3 inline-flex" href={item.download_url} target="_blank" rel="noreferrer">
                      {t("detail.openFile")}
                    </a>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="console-panel sm:col-span-2 lg:col-span-3">
              <div className="console-panel-body">
                <div className="console-empty">{t("table.emptyTitle")}</div>
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
