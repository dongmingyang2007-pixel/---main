"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";

/* ── Types (mirrors ModelCatalogDetailOut) ── */

interface ModelDetail {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  provider_display: string;
  category: "llm" | "asr" | "tts" | "vision";
  description: string;
  capabilities: string[];
  input_price: number;
  output_price: number;
  context_window: number;
  max_output: number;
  input_modalities: string[];
  output_modalities: string[];
  supports_function_calling: boolean;
  supports_web_search: boolean;
  supports_structured_output: boolean;
  supports_cache: boolean;
  price_unit: string;
  price_note: string | null;
}

/* ── Provider colours (same as discover page) ── */

const PROVIDER_COLORS: Record<string, { bg: string; label: string }> = {
  qwen: { bg: "linear-gradient(135deg, #c8734a, #e8925a)", label: "Q" },
  alibaba: { bg: "linear-gradient(135deg, #c8734a, #e8925a)", label: "Q" },
  deepseek: { bg: "linear-gradient(135deg, #3a6a9a, #4a8ac8)", label: "DS" },
};

function providerStyle(provider: string): { bg: string; label: string } {
  const key = provider.toLowerCase();
  for (const [prefix, val] of Object.entries(PROVIDER_COLORS)) {
    if (key.includes(prefix)) return val;
  }
  return {
    bg: "linear-gradient(135deg, #6b7280, #9ca3af)",
    label: provider.charAt(0).toUpperCase(),
  };
}

/* ── Capability tag mapping (same consumer language as discover page) ── */

function buildTags(
  model: ModelDetail,
  t: (key: string) => string,
): { text: string; highlight: boolean }[] {
  const tags: { text: string; highlight: boolean }[] = [];
  const catMap: Record<string, string> = {
    llm: "discover.category.llm",
    asr: "discover.category.asr",
    tts: "discover.category.tts",
    vision: "discover.category.vision",
  };
  if (catMap[model.category]) {
    tags.push({ text: t(catMap[model.category]), highlight: true });
  }
  if (model.capabilities?.includes("function_calling")) {
    tags.push({ text: t("modelDetail.cap.functionCalling"), highlight: false });
  }
  if (model.capabilities?.includes("thinking")) {
    tags.push({ text: t("modelDetail.cap.thinking"), highlight: false });
  }
  return tags;
}

/* ── Inline SVG icons ── */

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/* ── Component ── */

export default function ModelDetailPage() {
  const params = useParams();
  const modelId = params.modelId as string;
  const t = useTranslations("console");

  const [model, setModel] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    apiGet<ModelDetail>(`/api/v1/models/catalog/${modelId}`)
      .then((data) => {
        if (!cancelled) setModel(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modelId]);

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="model-detail">
        <Link href="/app/discover" className="model-detail-back">
          <ArrowLeftIcon />
          {t("modelDetail.backToDiscover")}
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          <div style={{ width: "40%", height: 20, borderRadius: 8, background: "var(--border)" }} />
          <div style={{ width: "60%", height: 14, borderRadius: 6, background: "var(--border)" }} />
          <div style={{ width: "80%", height: 14, borderRadius: 6, background: "var(--border)" }} />
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error || !model) {
    return (
      <div className="model-detail">
        <Link href="/app/discover" className="model-detail-back">
          <ArrowLeftIcon />
          {t("modelDetail.backToDiscover")}
        </Link>
        <p style={{ color: "var(--text-secondary)", marginTop: 24 }}>
          Model not found.
        </p>
      </div>
    );
  }

  const prov = providerStyle(model.provider);
  const tags = buildTags(model, t);

  /* ── Modality helpers ── */
  const allModalities = ["text", "image", "audio", "video"] as const;
  const modalityLabelMap: Record<string, string> = {
    text: t("modelDetail.text"),
    image: t("modelDetail.image"),
    audio: t("modelDetail.audio"),
    video: t("modelDetail.video"),
  };

  const inputSet = new Set(model.input_modalities ?? []);
  const outputSet = new Set(model.output_modalities ?? []);

  /* ── Core capability list ── */
  const coreCapabilities: { key: string; label: string; supported: boolean }[] = [
    { key: "function_calling", label: t("modelDetail.cap.functionCalling"), supported: model.supports_function_calling },
    { key: "thinking", label: t("modelDetail.cap.thinking"), supported: (model.capabilities ?? []).includes("thinking") },
    { key: "web_search", label: t("modelDetail.cap.webSearch"), supported: model.supports_web_search },
    { key: "streaming", label: t("modelDetail.cap.streaming"), supported: true },
    { key: "cache", label: t("modelDetail.cap.cache"), supported: model.supports_cache },
  ];

  return (
    <div className="model-detail">
      {/* ── Back link ── */}
      <Link href="/app/discover" className="model-detail-back">
        <ArrowLeftIcon />
        {t("modelDetail.backToDiscover")}
      </Link>

      {/* ── Header ── */}
      <div className="model-detail-header">
        <div
          className="model-detail-logo"
          style={{ background: prov.bg, color: "white" }}
        >
          {prov.label}
        </div>
        <div>
          <h1 className="model-detail-name">{model.display_name}</h1>
          <div className="model-detail-provider">{model.provider_display}</div>
          <div className="model-detail-tags">
            {tags.map((tag) => (
              <span
                key={tag.text}
                className={`model-card-tag${tag.highlight ? " highlight" : ""}`}
              >
                {tag.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA button ── */}
      <button className="model-detail-cta">
        {t("modelDetail.useModel")}
      </button>

      {/* ── Description section ── */}
      {model.description && (
        <div className="model-detail-section">
          <div className="model-detail-section-title">{t("modelDetail.description")}</div>
          <div className="model-detail-desc">{model.description}</div>
        </div>
      )}

      {/* ── Capability matrix ── */}
      <div className="model-detail-section">
        <div className="model-detail-section-title">{t("modelDetail.capabilities")}</div>

        {/* Modality grid */}
        <div className="model-modality-grid" style={{ marginBottom: 16 }}>
          {/* Input modalities */}
          <div className="model-modality-card">
            <div className="model-modality-label">{t("modelDetail.inputModalities")}</div>
            <div className="model-modality-items">
              {allModalities.map((mod) => {
                const supported = inputSet.has(mod);
                return (
                  <span key={mod} className={`model-modality-item ${supported ? "supported" : "unsupported"}`}>
                    {supported ? <CheckIcon /> : <XIcon />}
                    {modalityLabelMap[mod]}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Output modalities */}
          <div className="model-modality-card">
            <div className="model-modality-label">{t("modelDetail.outputModalities")}</div>
            <div className="model-modality-items">
              {allModalities.map((mod) => {
                const supported = outputSet.has(mod);
                return (
                  <span key={mod} className={`model-modality-item ${supported ? "supported" : "unsupported"}`}>
                    {supported ? <CheckIcon /> : <XIcon />}
                    {modalityLabelMap[mod]}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Core capabilities checklist */}
        <div className="model-capability-list">
          {coreCapabilities.map((cap) => (
            <div key={cap.key} className={`model-capability-item ${cap.supported ? "supported" : "unsupported"}`}>
              {cap.supported ? <CheckIcon /> : <XIcon />}
              {cap.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
