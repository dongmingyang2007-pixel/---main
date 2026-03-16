"use client";

import { useTranslations } from "next-intl";

export type ModelTier = "light" | "medium" | "heavy";

export interface ModelChoice {
  id: string;
  name: string;
  tier: ModelTier;
}

const MODEL_TIERS: {
  tier: ModelTier;
  id: string;
  name: string;
  icon: string;
  gradient: string;
  tag: string;
}[] = [
  {
    tier: "light",
    id: "qwen3.5-7b",
    name: "Qwen3.5-7B",
    icon: "\u8F7B",
    gradient: "linear-gradient(135deg, #e8925a, #c8734a)",
    tag: "\u63A8\u8350\u5165\u95E8",
  },
  {
    tier: "medium",
    id: "deepseek-v3",
    name: "DeepSeek-V3",
    icon: "\u4E2D",
    gradient: "linear-gradient(135deg, #8a9ab0, #6a7a90)",
    tag: "\u6700\u53D7\u6B22\u8FCE",
  },
  {
    tier: "heavy",
    id: "qwen-72b",
    name: "Qwen-72B",
    icon: "\u5F3A",
    gradient: "linear-gradient(135deg, #5a4a8a, #3a2a6a)",
    tag: "\u9AD8\u7EA7\u7528\u6237",
  },
];

const MODEL_DESCS: Record<ModelTier, string> = {
  light: "\u54CD\u5E94\u6781\u5FEB \u00B7 \u65E5\u5E38\u5BF9\u8BDD \u00B7 \u7B80\u5355\u4EFB\u52A1",
  medium: "\u6027\u80FD\u5747\u8861 \u00B7 \u4E13\u4E1A\u8F85\u52A9 \u00B7 \u590D\u6742\u63A8\u7406",
  heavy: "\u6700\u5F3A\u80FD\u529B \u00B7 \u6DF1\u5EA6\u5206\u6790 \u00B7 \u4E13\u5BB6\u7EA7\u4EFB\u52A1",
};

interface StepModelProps {
  selected: ModelChoice | null;
  onSelect: (model: ModelChoice) => void;
}

export function StepModel({ selected, onSelect }: StepModelProps) {
  const t = useTranslations("console-assistants");

  return (
    <div className="wizard-step-model">
      <h2 className="wizard-step-title">{t("wizard.stepModel")}</h2>
      <p className="wizard-step-desc">{t("wizard.stepModelDesc")}</p>

      <div className="wizard-model-list">
        {MODEL_TIERS.map((m) => {
          const isSelected = selected?.tier === m.tier;
          return (
            <button
              key={m.tier}
              type="button"
              className={`wizard-model-card ${isSelected ? "wizard-model-card--selected" : ""}`}
              onClick={() => onSelect({ id: m.id, name: m.name, tier: m.tier })}
            >
              <div
                className="wizard-model-icon"
                style={{ background: m.gradient }}
              >
                {m.icon}
              </div>
              <div className="wizard-model-info">
                <div className="wizard-model-header">
                  <span className="wizard-model-name">{m.name}</span>
                  <span className="wizard-model-tag">{m.tag}</span>
                </div>
                <span className="wizard-model-tier">
                  {t(`wizard.model${m.tier.charAt(0).toUpperCase()}${m.tier.slice(1)}` as "wizard.modelLight" | "wizard.modelMedium" | "wizard.modelHeavy")}
                </span>
                <span className="wizard-model-desc">{MODEL_DESCS[m.tier]}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
