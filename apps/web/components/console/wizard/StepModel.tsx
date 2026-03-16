"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ModelPickerModal } from "../ModelPickerModal";

export interface ModelChoice {
  id: string;
  name: string;
  tier: string;
}

export interface PipelineChoices {
  asrModelId?: string;
  asrModelName?: string;
  ttsModelId?: string;
  ttsModelName?: string;
}

interface StepModelProps {
  selected: ModelChoice | null;
  pipeline: PipelineChoices;
  onSelect: (model: ModelChoice) => void;
  onPipelineChange: (pipeline: PipelineChoices) => void;
}

export function StepModel({
  selected,
  pipeline,
  onSelect,
  onPipelineChange,
}: StepModelProps) {
  const t = useTranslations("console-assistants");
  const tModels = useTranslations("console-models-v2");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategory, setPickerCategory] = useState<
    "llm" | "asr" | "tts" | "vision"
  >("llm");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const openPicker = (category: "llm" | "asr" | "tts" | "vision") => {
    setPickerCategory(category);
    setPickerOpen(true);
  };

  const handlePickerSelect = (modelId: string, displayName: string) => {
    if (pickerCategory === "llm") {
      onSelect({ id: modelId, name: displayName, tier: "custom" });
    } else if (pickerCategory === "asr") {
      onPipelineChange({
        ...pipeline,
        asrModelId: modelId,
        asrModelName: displayName,
      });
    } else if (pickerCategory === "tts") {
      onPipelineChange({
        ...pipeline,
        ttsModelId: modelId,
        ttsModelName: displayName,
      });
    }
    setPickerOpen(false);
  };

  return (
    <div className="wizard-step-model">
      <h2 className="wizard-step-title">{t("wizard.stepModel")}</h2>
      <p className="wizard-step-desc">{t("wizard.stepModelDesc")}</p>

      {/* LLM selection */}
      {selected ? (
        <div className="wizard-selected-model">
          <div className="wizard-selected-model-info">
            <span className="wizard-selected-model-name">{selected.name}</span>
            <span className="wizard-selected-model-id">{selected.id}</span>
          </div>
          <button
            type="button"
            className="wizard-selected-model-change"
            onClick={() => openPicker("llm")}
          >
            {tModels("change")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="wizard-model-picker-btn"
          onClick={() => openPicker("llm")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          {t("wizard.stepModel")}
        </button>
      )}

      {/* Advanced: ASR + TTS */}
      <button
        type="button"
        className="wizard-advanced-toggle"
        onClick={() => setAdvancedOpen((prev) => !prev)}
        aria-expanded={advancedOpen}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {t("canvas.expandAdvanced")}
      </button>

      {advancedOpen && (
        <div className="wizard-advanced-section">
          {/* ASR */}
          <div className="wizard-pipeline-row">
            <span className="wizard-pipeline-label">
              {tModels("pipelineAsr")}
            </span>
            <div className="wizard-pipeline-value">
              {pipeline.asrModelId ? (
                <>
                  <span>{pipeline.asrModelName || pipeline.asrModelId}</span>
                  <button
                    type="button"
                    className="wizard-pipeline-pick-btn"
                    onClick={() => openPicker("asr")}
                  >
                    {tModels("change")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="wizard-pipeline-pick-btn"
                  onClick={() => openPicker("asr")}
                >
                  {tModels("select")}
                </button>
              )}
            </div>
          </div>

          {/* TTS */}
          <div className="wizard-pipeline-row">
            <span className="wizard-pipeline-label">
              {tModels("pipelineTts")}
            </span>
            <div className="wizard-pipeline-value">
              {pipeline.ttsModelId ? (
                <>
                  <span>{pipeline.ttsModelName || pipeline.ttsModelId}</span>
                  <button
                    type="button"
                    className="wizard-pipeline-pick-btn"
                    onClick={() => openPicker("tts")}
                  >
                    {tModels("change")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="wizard-pipeline-pick-btn"
                  onClick={() => openPicker("tts")}
                >
                  {tModels("select")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model picker modal */}
      <ModelPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        category={pickerCategory}
        currentModelId={
          pickerCategory === "llm"
            ? selected?.id
            : pickerCategory === "asr"
              ? pipeline.asrModelId
              : pipeline.ttsModelId
        }
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
