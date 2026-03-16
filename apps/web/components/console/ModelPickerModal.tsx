"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";

interface CatalogModel {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  category: "llm" | "asr" | "tts" | "vision";
  description: string;
  capabilities: string[];
  input_price_per_1k: number;
  output_price_per_1k: number;
  context_window: number;
  max_output_tokens: number;
}

interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  category: "llm" | "asr" | "tts" | "vision";
  currentModelId?: string;
  onSelect: (modelId: string, displayName: string) => void;
}

const PROVIDER_GRADIENTS: Record<string, string> = {
  qwen: "linear-gradient(135deg, #c8734a, #e8925a)",
  deepseek: "linear-gradient(135deg, #3a6a9a, #4a8ac8)",
};

function getProviderGradient(provider: string): string {
  const key = provider.toLowerCase();
  for (const [prefix, gradient] of Object.entries(PROVIDER_GRADIENTS)) {
    if (key.includes(prefix)) return gradient;
  }
  return "linear-gradient(135deg, #6b7280, #9ca3af)";
}

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  llm: "pipelineLlm",
  asr: "pipelineAsr",
  tts: "pipelineTts",
  vision: "pipelineVision",
};

export function ModelPickerModal({
  open,
  onClose,
  category,
  currentModelId,
  onSelect,
}: ModelPickerModalProps) {
  const t = useTranslations("console-models-v2");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    apiGet<CatalogModel[]>(`/api/v1/models/catalog?category=${category}`)
      .then((data) => {
        if (!cancelled) setModels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, category]);

  if (!open) return null;

  return (
    <div className="model-picker-overlay" onClick={onClose}>
      <div className="model-picker-card" onClick={(e) => e.stopPropagation()}>
        <div className="model-picker-header">
          <h2 className="model-picker-title">
            {t("pickerTitle")} &mdash; {t(CATEGORY_LABEL_KEYS[category] || category)}
          </h2>
          <button className="model-picker-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="model-picker-body">
          {loading ? (
            <div className="console-empty">...</div>
          ) : models.length === 0 ? (
            <div className="console-empty">{t("noModels")}</div>
          ) : (
            <div className="model-picker-list">
              {models.map((model) => {
                const isSelected = model.id === currentModelId;
                return (
                  <div
                    key={model.id}
                    className={`model-picker-item${isSelected ? " is-selected" : ""}`}
                  >
                    <div className="model-picker-item-head">
                      <div
                        className="marketplace-card-icon"
                        style={{ background: getProviderGradient(model.provider) }}
                      >
                        {model.provider.charAt(0).toUpperCase()}
                      </div>
                      <div className="model-picker-item-info">
                        <div className="marketplace-card-name">{model.display_name}</div>
                        <div className="marketplace-card-provider">{model.provider}</div>
                      </div>
                    </div>
                    <div className="model-picker-item-desc">
                      {model.description || t("noDescription")}
                    </div>
                    <div className="model-picker-item-footer">
                      <span className="marketplace-card-price">
                        {model.input_price_per_1k > 0 || model.output_price_per_1k > 0
                          ? `¥${model.input_price_per_1k.toFixed(2)} / ¥${model.output_price_per_1k.toFixed(2)} ${t("priceUnit")}`
                          : t("free")}
                      </span>
                      <button
                        className="marketplace-card-btn"
                        onClick={() => onSelect(model.id, model.display_name)}
                      >
                        {isSelected ? t("selected") : t("select")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="model-picker-footer">
          <Link href="/app/models" className="model-picker-link" onClick={onClose}>
            {t("pickerViewAll")}
          </Link>
        </div>
      </div>
    </div>
  );
}
