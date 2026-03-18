"use client";

import { useTranslations } from "next-intl";

import { useDeveloperMode } from "@/lib/developer-mode";

import type { ParsedDescription } from "./CanvasWorkbench";

const TIER_CONFIG: Record<string, { icon: string; gradient: string; label: string; desc: string }> = {
  light: {
    icon: "\u8F7B",
    gradient: "linear-gradient(135deg, #e8925a, #c8734a)",
    label: "\u8F7B\u91CF\u7EA7",
    desc: "\u54CD\u5E94\u6781\u5FEB \u00B7 \u65E5\u5E38\u5BF9\u8BDD \u00B7 \u7B80\u5355\u4EFB\u52A1",
  },
  medium: {
    icon: "\u4E2D",
    gradient: "linear-gradient(135deg, #8a9ab0, #6a7a90)",
    label: "\u5747\u8861\u578B",
    desc: "\u6027\u80FD\u5747\u8861 \u00B7 \u4E13\u4E1A\u8F85\u52A9 \u00B7 \u590D\u6742\u63A8\u7406",
  },
  heavy: {
    icon: "\u5F3A",
    gradient: "linear-gradient(135deg, #5a4a8a, #3a2a6a)",
    label: "\u65D7\u8230\u7EA7",
    desc: "\u6700\u5F3A\u80FD\u529B \u00B7 \u6DF1\u5EA6\u5206\u6790 \u00B7 \u4E13\u5BB6\u7EA7\u4EFB\u52A1",
  },
};

const MODEL_NAMES: Record<string, string> = {
  "qwen3.5-7b": "Qwen3.5-7B",
  "qwen3.5-flash": "Qwen3.5 Flash",
  "qwen3.5-plus": "Qwen3.5 Plus",
  "qwen3-max": "Qwen3 Max",
  "deepseek-v3": "DeepSeek-V3",
  "deepseek-v3.2": "DeepSeek V3.2",
  "deepseek-r1": "DeepSeek R1",
  "qwen-72b": "Qwen-72B",
  "qwen3-omni-flash-realtime": "Qwen3 Omni Flash Realtime",
};

interface ModelCardProps {
  parsed: ParsedDescription;
  currentModelId?: string;
  currentModelName?: string;
  onChangeClick?: () => void;
}

export function ModelCard({
  parsed,
  currentModelId,
  currentModelName,
  onChangeClick,
}: ModelCardProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();

  const tier = parsed.modelTier || "medium";
  const modelId = currentModelId || parsed.modelId || "";
  const config = TIER_CONFIG[tier] || TIER_CONFIG.medium;
  const modelName = currentModelName || MODEL_NAMES[modelId] || modelId || "---";

  return (
    <div className="canvas-card">
      <div className="canvas-card-header">
        <span className="canvas-card-label">{t("canvas.model")}</span>
        <button type="button" className="canvas-card-action" onClick={onChangeClick}>
          {t("canvas.change")}
        </button>
      </div>

      <div className="canvas-card-body">
        <div className="canvas-model-row">
          <div
            className="canvas-model-icon"
            style={{ background: config.gradient }}
          >
            {config.icon}
          </div>
          <div className="canvas-model-info">
            <span className="canvas-model-name">{modelName}</span>
            <span className="canvas-model-tier">{config.label}</span>
            <span className="canvas-model-desc">{config.desc}</span>
          </div>
        </div>
      </div>

      {isDeveloperMode && (
        <div className="canvas-card-dev-info">
          <span>model_id: {modelId || "N/A"}</span>
          <span>tier: {tier}</span>
        </div>
      )}
    </div>
  );
}
