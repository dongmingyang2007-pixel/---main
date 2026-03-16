"use client";

import { useTranslations } from "next-intl";

import type { ModelChoice } from "./StepModel";

const COLOR_OPTIONS = [
  { name: "accent", value: "var(--accent)" },
  { name: "blue", value: "#3b82f6" },
  { name: "green", value: "#22c55e" },
  { name: "purple", value: "#8b5cf6" },
  { name: "pink", value: "#ec4899" },
  { name: "orange", value: "#f97316" },
];

interface StepFinishProps {
  name: string;
  color: string;
  model: ModelChoice | null;
  fileCount: number;
  personalityPreview: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function StepFinish({
  name,
  color,
  model,
  fileCount,
  personalityPreview,
  onNameChange,
  onColorChange,
  onSubmit,
  isSubmitting,
}: StepFinishProps) {
  const t = useTranslations("console-assistants");

  return (
    <div className="wizard-step-finish">
      <h2 className="wizard-step-title">{t("wizard.stepFinish")}</h2>
      <p className="wizard-step-desc">{t("wizard.stepFinishDesc")}</p>

      <div className="wizard-finish-form">
        <div className="wizard-field">
          <label className="wizard-label" htmlFor="assistant-name">
            {t("wizard.nameLabel")}
          </label>
          <input
            id="assistant-name"
            type="text"
            className="wizard-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("wizard.namePlaceholder")}
            maxLength={50}
          />
        </div>

        <div className="wizard-field">
          <span className="wizard-label">{t("wizard.colorLabel")}</span>
          <div className="wizard-color-picker">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`wizard-color-swatch ${color === c.name ? "wizard-color-swatch--selected" : ""}`}
                style={{ background: c.value }}
                onClick={() => onColorChange(c.name)}
                aria-label={c.name}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="wizard-summary">
        <h3 className="wizard-summary-title">{t("wizard.summaryTitle")}</h3>
        <div className="wizard-summary-row">
          <span className="wizard-summary-label">{t("wizard.summaryModel")}</span>
          <span className="wizard-summary-value">
            {model ? model.name : t("wizard.summaryNone")}
          </span>
        </div>
        <div className="wizard-summary-row">
          <span className="wizard-summary-label">{t("wizard.summaryFiles")}</span>
          <span className="wizard-summary-value">
            {fileCount > 0 ? `${fileCount} ${t("wizard.summaryFileUnit")}` : t("wizard.summaryNone")}
          </span>
        </div>
        <div className="wizard-summary-row">
          <span className="wizard-summary-label">{t("wizard.summaryPersonality")}</span>
          <span className="wizard-summary-value">
            {personalityPreview
              ? personalityPreview.length > 60
                ? `${personalityPreview.slice(0, 60)}...`
                : personalityPreview
              : t("wizard.summaryDefault")}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="wizard-submit-btn"
        onClick={onSubmit}
        disabled={!name.trim() || isSubmitting}
      >
        {isSubmitting ? t("wizard.submitting") : t("wizard.submit")}
      </button>
    </div>
  );
}
