"use client";

import { useState } from "react";

import { apiPost, uploadToPresignedUrl } from "@/lib/api";

export function Uploader({ datasetId, onDone }: { datasetId: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const onUpload = async (file: File) => {
    setBusy(true);
    setMessage("上传初始化中...");
    try {
      const presign = await apiPost<{
        upload_id: string;
        put_url: string;
        headers: Record<string, string>;
        data_item_id: string;
      }>("/api/v1/uploads/presign", {
        dataset_id: datasetId,
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });

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
        throw new Error(`对象存储上传失败(${putRes.status})`);
      }

      await apiPost("/api/v1/uploads/complete", {
        upload_id: presign.upload_id,
        data_item_id: presign.data_item_id,
      });

      setMessage("上传完成并已提交处理任务");
      onDone?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`console-panel studio-dropzone border-dashed ${dragActive ? "is-drag-active" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) {
          setDragActive(true);
        }
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (busy) return;
        const file = event.dataTransfer.files?.[0];
        if (file) {
          void onUpload(file);
        }
      }}
    >
      <div className="console-panel-body">
        <div className="console-kicker">Dataset Upload</div>
        <div className="mt-2 text-lg font-semibold">拖入样本文件，或从本地选择上传</div>
        <div className="mt-2 text-sm leading-6 text-[var(--muted)]">
          仍然使用直传对象存储的现有流程；这里只重做交互反馈，不改变上传协议。
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="console-button">
            <span>{busy ? "上传中..." : "选择文件"}</span>
            <input
              disabled={busy}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
              }}
            />
          </label>
          <span className="console-pill">支持图片 / 文本 / 音频 / 视频</span>
        </div>
        <div className="mt-4 text-sm text-[var(--muted)]">{message || "上传完成后会自动创建 Data Item 并触发后续处理。"}</div>
      </div>
    </div>
  );
}
