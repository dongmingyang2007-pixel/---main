"use client";

import { useTranslations } from "next-intl";

interface PipelineCardProps {
  label: string;
  modelType: "llm" | "asr" | "tts" | "vision";
  currentModelId?: string;
  currentModelName?: string;
  disabled?: boolean;
  disabledText?: string;
  onChangeClick: () => void;
}

export function PipelineCard({
  label,
  modelType,
  currentModelId,
  currentModelName,
  disabled,
  disabledText,
  onChangeClick,
}: PipelineCardProps) {
  const t = useTranslations("console-models-v2");

  return (
    <div className="canvas-card" data-model-type={modelType}>
      <div className="canvas-card-header">
        <span className="canvas-card-label">{label}</span>
        <button
          type="button"
          className="canvas-card-action"
          onClick={onChangeClick}
          disabled={disabled}
          style={disabled ? { opacity: 0.4, cursor: "default" } : undefined}
        >
          {t("change")}
        </button>
      </div>

      <div className="canvas-card-body">
        {disabled ? (
          <span className="canvas-pipeline-muted">
            {disabledText || t("pipelineVisionAuto")}
          </span>
        ) : currentModelId ? (
          <div className="canvas-pipeline-info">
            <span className="canvas-pipeline-name">
              {currentModelName || currentModelId}
            </span>
            <span className="canvas-pipeline-id">{currentModelId}</span>
          </div>
        ) : (
          <span className="canvas-placeholder">---</span>
        )}
      </div>
    </div>
  );
}
