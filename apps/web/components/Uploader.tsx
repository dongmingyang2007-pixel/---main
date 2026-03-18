"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { apiPost, buildPresignedUploadInit, uploadToPresignedUrl } from "@/lib/api";

export function Uploader({ datasetId, onDone }: { datasetId: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const t = useTranslations("console-datasets");

  const onUpload = async (file: File) => {
    setBusy(true);
    setMessage(t("upload.initializing"));
    try {
      const presign = await apiPost<{
        upload_id: string;
        put_url: string;
        headers: Record<string, string>;
        fields: Record<string, string>;
        upload_method: "PUT" | "POST";
        data_item_id: string;
      }>("/api/v1/uploads/presign", {
        dataset_id: datasetId,
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });

      const putRes = await uploadToPresignedUrl(
        presign.put_url,
        buildPresignedUploadInit(presign, file),
        { authenticated: true },
      );
      if (!putRes.ok) {
        throw new Error(t("upload.storageFailed", { status: putRes.status }));
      }

      await apiPost("/api/v1/uploads/complete", {
        upload_id: presign.upload_id,
        data_item_id: presign.data_item_id,
      });

      setMessage(t("upload.complete"));
      onDone?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("upload.failed"));
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
        <div className="console-kicker">{t("upload.kicker")}</div>
        <div className="mt-2 text-lg font-semibold">{t("upload.title")}</div>
        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          {t("upload.description")}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="console-button">
            <span>{busy ? t("upload.uploading") : t("upload.selectFile")}</span>
            <input
              disabled={busy}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onUpload(f);
              }}
            />
          </label>
          <span className="console-pill">{t("upload.supportedTypes")}</span>
        </div>
        <div className="mt-4 text-sm text-[var(--text-secondary)]">{message || t("upload.defaultMessage")}</div>
      </div>
    </div>
  );
}
