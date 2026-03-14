"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { DataTable } from "@/components/DataTable";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet, apiPost, uploadToPresignedUrl } from "@/lib/api";

type Version = {
  id: string;
  version: number;
  run_id?: string;
  metrics_json: Record<string, unknown>;
  notes?: string;
  artifact_download_url?: string;
  artifact_filename?: string;
  created_at: string;
  source?: {
    training_job_id: string;
    dataset_version_id: string;
    recipe: string;
    params_json: Record<string, unknown>;
  };
};

type Alias = { id: string; alias: "prod" | "staging" | "dev"; model_version_id: string };

export default function ModelDetailPage() {
  const params = useParams<{ id: string }>();
  const modelId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [modelName, setModelName] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [runId, setRunId] = useState("");
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactStatus, setArtifactStatus] = useState("");
  const [aliasName, setAliasName] = useState<"prod" | "staging" | "dev">("prod");
  const [aliasVersionId, setAliasVersionId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const load = async () => {
    const detail = await apiGet<{ model: { id: string; name: string }; aliases: Alias[] }>(`/api/v1/models/${modelId}`);
    const versionData = await apiGet<{ items: Version[] }>(`/api/v1/models/${modelId}/versions`);
    setModelName(detail.model.name);
    setAliases(detail.aliases || []);
    setVersions(versionData.items || []);
    if (!aliasVersionId && versionData.items?.length) {
      setAliasVersionId(versionData.items[0].id);
    }
  };

  useEffect(() => {
    if (!modelId) return;
    void load();
  }, [modelId]);

  const uploadManagedArtifact = async (file: File): Promise<string> => {
    setArtifactStatus("正在申请产物上传地址...");
    const presign = await apiPost<{
      artifact_upload_id: string;
      put_url: string;
      headers: Record<string, string>;
    }>(`/api/v1/models/${modelId}/artifact-uploads/presign`, {
      filename: file.name,
      media_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    });
    setArtifactStatus("正在上传受管产物...");
    const putRes = await uploadToPresignedUrl(
      presign.put_url,
      {
        method: "PUT",
        headers: presign.headers,
        body: file,
      },
      { authenticated: true },
    );
    if (!putRes.ok) {
      throw new Error(`产物上传失败(${putRes.status})`);
    }
    setArtifactStatus(`已上传 ${file.name}`);
    return presign.artifact_upload_id;
  };

  const createVersion = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    try {
      if (runId && artifactFile) {
        throw new Error("run_id 与手工产物上传不能同时使用");
      }
      if (!runId && !artifactFile) {
        throw new Error("请填写 run_id 或选择一个受管产物文件");
      }
      const artifactUploadId = !runId && artifactFile ? await uploadManagedArtifact(artifactFile) : null;
      await apiPost(`/api/v1/models/${modelId}/versions`, {
        run_id: runId || null,
        artifact_upload_id: artifactUploadId,
        metrics_json: {},
        notes: "manual create",
      });
      setRunId("");
      setArtifactFile(null);
      setArtifactStatus("");
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "创建模型版本失败");
    }
  };

  const versionLabelMap = versions.reduce<Record<string, string>>((acc, version) => {
    acc[version.id] = `v${version.version}`;
    return acc;
  }, {});

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              Models
            </p>
            <h1 className="mt-2 text-2xl font-bold">模型详情</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">管理版本和发布。</p>
          </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="console-panel">
          <div className="console-panel-header">
            <div>
              <h2 className="console-panel-title">{modelName || "模型详情"}</h2>
              <p className="console-panel-description">支持版本登记、alias 发布与回滚，所有操作会写入审计日志。</p>
            </div>
          </div>
          <div className="console-panel-body">
            <form className="console-form-grid columns-3" onSubmit={createVersion}>
              <div>
                <label className="console-label" htmlFor="run-id">run_id</label>
                <input
                  id="run-id"
                  className="console-input"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                  placeholder="已有训练 run 时可直接填写"
                />
              </div>
              <div>
                <label className="console-label" htmlFor="artifact-file">受管产物文件</label>
                <input
                  id="artifact-file"
                  className="console-input pt-3"
                  type="file"
                  onChange={(e) => setArtifactFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="flex items-end">
                <button className="console-button w-full">创建版本</button>
              </div>
            </form>
            <div className="mt-4 text-sm text-[var(--text-secondary)]">
              {artifactStatus || "手工版本必须通过受管上传文件创建；如已有训练 run，可直接填写 run_id。"}
            </div>
            {errorMessage ? <div className="console-inline-notice is-error mt-4">{errorMessage}</div> : null}
          </div>
        </div>

        <aside className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">Alias Pointers</div>
            <div className="mt-4 space-y-3">
              {["prod", "staging", "dev"].map((alias) => {
                const pointer = aliases.find((item) => item.alias === alias);
                return (
                  <div key={alias} className="console-key-item">
                    <div className="console-key-label">{alias}</div>
                    <div className="console-key-value">
                      {pointer ? versionLabelMap[pointer.model_version_id] || pointer.model_version_id.slice(0, 8) : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </section>

      <DataTable
        caption="模型版本列表"
        headers={["版本", "Run", "来源数据版本", "Recipe", "Artifact", "时间"]}
        emptyTitle="暂无模型版本"
        emptyBody="先从训练 run 或手工受管上传创建一个版本。"
        rows={versions.map((version) => [
          `v${version.version}`,
          version.run_id ? `${version.run_id.slice(0, 8)}...` : "-",
          version.source?.dataset_version_id ? `${version.source.dataset_version_id.slice(0, 8)}...` : "-",
          version.source?.recipe || "-",
          version.artifact_download_url ? (
            <a key={`${version.id}-artifact`} className="console-link" href={version.artifact_download_url} target="_blank" rel="noreferrer">
              {version.artifact_filename || "下载产物"}
            </a>
          ) : (
            "-"
          ),
          new Date(version.created_at).toLocaleString(),
        ])}
      />

      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">Alias 管理</h2>
            <p className="console-panel-description">发布和回滚共用同一套版本选择器，显式控制 prod / staging / dev 指针。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-form-grid columns-3">
            <div>
              <label className="console-label" htmlFor="alias-name">Alias</label>
              <select id="alias-name" className="console-select" value={aliasName} onChange={(e) => setAliasName(e.target.value as "prod" | "staging" | "dev")}>
                <option value="prod">prod</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </select>
            </div>
            <div>
              <label className="console-label" htmlFor="alias-version">目标版本</label>
              <select id="alias-version" className="console-select" value={aliasVersionId} onChange={(e) => setAliasVersionId(e.target.value)}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version} ({version.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <button
                className="console-button w-full"
                onClick={async () => {
                  await apiPost(`/api/v1/models/${modelId}/aliases`, {
                    alias: aliasName,
                    model_version_id: aliasVersionId,
                  });
                  await load();
                }}
              >
                发布
              </button>
              <button
                className="console-button-secondary w-full"
                onClick={async () => {
                  await apiPost(`/api/v1/models/${modelId}/rollback`, {
                    alias: aliasName,
                    to_model_version_id: aliasVersionId,
                  });
                  await load();
                }}
              >
                回滚
              </button>
            </div>
          </div>
        </div>
      </section>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
