"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

interface PersonalityTemplate {
  id: string;
  label: string;
  hint: string;
  prompt: string;
}

const TEMPLATES: PersonalityTemplate[] = [
  {
    id: "advisor",
    label: "\u4E13\u4E1A\u987E\u95EE",
    hint: "\u4E25\u8C28\u3001\u4E13\u4E1A\u3001\u5F15\u7528\u6570\u636E",
    prompt: "\u4F60\u662F\u4E00\u4F4D\u4E13\u4E1A\u987E\u95EE\uFF0C\u56DE\u7B54\u95EE\u9898\u65F6\u4FDD\u6301\u4E25\u8C28\u548C\u4E13\u4E1A\uFF0C\u5C3D\u53EF\u80FD\u5F15\u7528\u6570\u636E\u548C\u6743\u5A01\u6765\u6E90\u652F\u6491\u4F60\u7684\u89C2\u70B9\u3002",
  },
  {
    id: "study",
    label: "\u5B66\u4E60\u4F19\u4F34",
    hint: "\u8010\u5FC3\u3001\u9F13\u52B1\u3001\u5FAA\u5E8F\u6E10\u8FDB",
    prompt: "\u4F60\u662F\u4E00\u4F4D\u8010\u5FC3\u7684\u5B66\u4E60\u4F19\u4F34\uFF0C\u5584\u4E8E\u7528\u7B80\u5355\u6613\u61C2\u7684\u65B9\u5F0F\u89E3\u91CA\u590D\u6742\u6982\u5FF5\uFF0C\u9F13\u52B1\u7528\u6237\u4E0D\u65AD\u8FDB\u6B65\u3002",
  },
  {
    id: "life",
    label: "\u751F\u6D3B\u52A9\u624B",
    hint: "\u6E29\u6696\u3001\u5B9E\u7528\u3001\u8D34\u5FC3",
    prompt: "\u4F60\u662F\u4E00\u4F4D\u6E29\u6696\u8D34\u5FC3\u7684\u751F\u6D3B\u52A9\u624B\uFF0C\u63D0\u4F9B\u5B9E\u7528\u7684\u5EFA\u8BAE\u548C\u5E2E\u52A9\uFF0C\u8BED\u6C14\u4EB2\u5207\u53CB\u597D\u3002",
  },
  {
    id: "creative",
    label: "\u521B\u610F\u642D\u6863",
    hint: "\u5F00\u653E\u3001\u6FC0\u53D1\u7075\u611F\u3001\u4E0D\u8BBE\u9650",
    prompt: "\u4F60\u662F\u4E00\u4F4D\u5145\u6EE1\u521B\u610F\u7684\u642D\u6863\uFF0C\u4E50\u4E8E\u63A2\u7D22\u65B0\u60F3\u6CD5\uFF0C\u4E0D\u8BBE\u9650\u5236\u5730\u6FC0\u53D1\u7528\u6237\u7684\u60F3\u8C61\u529B\u3002",
  },
  {
    id: "language",
    label: "\u8BED\u8A00\u6559\u7EC3",
    hint: "\u7EA0\u6B63\u9519\u8BEF\u3001\u63D0\u4F9B\u4F8B\u53E5\u3001\u9F13\u52B1\u8868\u8FBE",
    prompt: "\u4F60\u662F\u4E00\u4F4D\u8BED\u8A00\u6559\u7EC3\uFF0C\u5E2E\u52A9\u7528\u6237\u63D0\u5347\u8BED\u8A00\u80FD\u529B\uFF0C\u6E29\u548C\u5730\u7EA0\u6B63\u9519\u8BEF\uFF0C\u63D0\u4F9B\u4E30\u5BCC\u7684\u4F8B\u53E5\u548C\u7EC3\u4E60\u3002",
  },
  {
    id: "custom",
    label: "\u81EA\u5B9A\u4E49",
    hint: "\u5B8C\u5168\u81EA\u5B9A\u4E49\u4F60\u7684 AI \u4EBA\u683C",
    prompt: "",
  },
];

const TAG_OPTIONS = [
  "\u4E13\u4E1A",
  "\u53CB\u5584",
  "\u5E7D\u9ED8",
  "\u4E25\u8C28",
  "\u521B\u610F",
  "\u8010\u5FC3",
];

interface PersonalityData {
  description: string;
  tags: string[];
}

interface StepPersonalityProps {
  personality: PersonalityData;
  onPersonalityChange: (data: PersonalityData) => void;
  onSkip: () => void;
}

export function StepPersonality({ personality, onPersonalityChange, onSkip }: StepPersonalityProps) {
  const t = useTranslations("console-assistants");

  const selectTemplate = useCallback(
    (tmpl: PersonalityTemplate) => {
      onPersonalityChange({
        ...personality,
        description: tmpl.prompt,
      });
    },
    [personality, onPersonalityChange],
  );

  const toggleTag = useCallback(
    (tag: string) => {
      const tags = personality.tags.includes(tag)
        ? personality.tags.filter((t) => t !== tag)
        : [...personality.tags, tag];
      onPersonalityChange({ ...personality, tags });
    },
    [personality, onPersonalityChange],
  );

  return (
    <div className="wizard-step-personality">
      <h2 className="wizard-step-title">{t("wizard.stepPersonality")}</h2>
      <p className="wizard-step-desc">{t("wizard.stepPersonalityDesc")}</p>

      <div className="wizard-personality-grid">
        {TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.id}
            type="button"
            className={`wizard-personality-card ${personality.description === tmpl.prompt && tmpl.prompt ? "wizard-personality-card--selected" : ""}`}
            onClick={() => selectTemplate(tmpl)}
          >
            <span className="wizard-personality-label">{tmpl.label}</span>
            <span className="wizard-personality-hint">{tmpl.hint}</span>
          </button>
        ))}
      </div>

      <div className="wizard-personality-prompt">
        <label className="wizard-label" htmlFor="personality-textarea">
          {t("wizard.promptLabel")}
        </label>
        <textarea
          id="personality-textarea"
          className="wizard-textarea"
          rows={4}
          value={personality.description}
          onChange={(e) =>
            onPersonalityChange({ ...personality, description: e.target.value })
          }
          placeholder={t("wizard.promptPlaceholder")}
        />
      </div>

      <div className="wizard-personality-tags">
        <span className="wizard-label">{t("wizard.tagsLabel")}</span>
        <div className="wizard-tag-chips">
          {TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`wizard-tag-chip ${personality.tags.includes(tag) ? "wizard-tag-chip--active" : ""}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="wizard-skip-btn" onClick={onSkip}>
        {t("wizard.skipPersonality")}
      </button>
    </div>
  );
}
