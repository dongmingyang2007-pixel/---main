"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { apiPatch, apiPost } from "@/lib/api";
import { startAssistantTraining } from "@/lib/assistant-training";

import { StepFinish } from "./StepFinish";
import { StepKnowledge } from "./StepKnowledge";
import type { ModelChoice, PipelineChoices } from "./StepModel";
import { StepModel } from "./StepModel";
import { StepPersonality } from "./StepPersonality";

interface WizardData {
  model: ModelChoice | null;
  pipeline: PipelineChoices;
  knowledgeFiles: File[];
  personality: { description: string; tags: string[] };
  name: string;
  color: string;
}

const STEP_COUNT = 4;

const STEP_KEYS = [
  "wizard.stepModelLabel",
  "wizard.stepKnowledgeLabel",
  "wizard.stepPersonalityLabel",
  "wizard.stepFinishLabel",
] as const;

export function WizardShell() {
  const t = useTranslations("console-assistants");
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [data, setData] = useState<WizardData>({
    model: null,
    pipeline: {
      asrModelId: "paraformer-v2",
      asrModelName: "Paraformer V2",
      ttsModelId: "cosyvoice-v1",
      ttsModelName: "CosyVoice V1",
    },
    knowledgeFiles: [],
    personality: { description: "", tags: [] },
    name: "",
    color: "accent",
  });

  const canNext = useCallback(() => {
    if (step === 0) return data.model !== null;
    if (step === 3) return data.name.trim().length > 0;
    return true;
  }, [step, data.model, data.name]);

  const goNext = useCallback(() => {
    if (step < STEP_COUNT - 1) setStep((s) => s + 1);
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const handleSkip = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleSubmit = useCallback(async () => {
    if (!data.name.trim()) return;
    setIsSubmitting(true);

    try {
      // Build description from model/personality choices
      const parts: string[] = [];
      if (data.model) {
        parts.push(`[model:${data.model.id}|${data.model.tier}]`);
      }
      if (data.personality.description) {
        parts.push(`[personality:${data.personality.description}]`);
      }
      if (data.personality.tags.length > 0) {
        parts.push(`[tags:${data.personality.tags.join(",")}]`);
      }
      if (data.color) {
        parts.push(`[color:${data.color}]`);
      }
      const description = parts.join("\n");

      const result = await apiPost<{ id: string }>("/api/v1/projects", {
        name: data.name.trim(),
        description,
      });

      // Set pipeline configs after project creation
      const pipelinePromises: Promise<unknown>[] = [];

      if (data.model) {
        pipelinePromises.push(
          apiPatch("/api/v1/pipeline", {
            project_id: result.id,
            model_type: "llm",
            model_id: data.model.id,
            config_json: {},
          }),
        );
      }

      if (data.pipeline.asrModelId) {
        pipelinePromises.push(
          apiPatch("/api/v1/pipeline", {
            project_id: result.id,
            model_type: "asr",
            model_id: data.pipeline.asrModelId,
            config_json: {},
          }),
        );
      }

      if (data.pipeline.ttsModelId) {
        pipelinePromises.push(
          apiPatch("/api/v1/pipeline", {
            project_id: result.id,
            model_type: "tts",
            model_id: data.pipeline.ttsModelId,
            config_json: {},
          }),
        );
      }

      // Fire all pipeline config calls concurrently
      await Promise.all(pipelinePromises);
      await startAssistantTraining(result.id);

      router.push(`/app/assistants/${result.id}`);
    } catch {
      setIsSubmitting(false);
    }
  }, [data, router]);

  return (
    <div className="wizard-shell">
      {/* Progress bar */}
      <div className="wizard-progress">
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <div key={i} className="wizard-progress-step">
            {i > 0 && (
              <div
                className={`wizard-progress-line ${i <= step ? "wizard-progress-line--active" : ""}`}
              />
            )}
            <div
              className={`wizard-progress-circle ${
                i === step
                  ? "wizard-progress-circle--current"
                  : i < step
                    ? "wizard-progress-circle--done"
                    : ""
              }`}
            >
              {i < step ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`wizard-progress-label ${
                i === step ? "wizard-progress-label--current" : ""
              }`}
            >
              {t(STEP_KEYS[i] as "wizard.stepModelLabel")}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="wizard-content">
        {step === 0 && (
          <StepModel
            selected={data.model}
            pipeline={data.pipeline}
            onSelect={(model) => setData((d) => ({ ...d, model }))}
            onPipelineChange={(pipeline) =>
              setData((d) => ({ ...d, pipeline }))
            }
          />
        )}
        {step === 1 && (
          <StepKnowledge
            files={data.knowledgeFiles}
            onFilesChange={(knowledgeFiles) =>
              setData((d) => ({ ...d, knowledgeFiles }))
            }
            onSkip={handleSkip}
          />
        )}
        {step === 2 && (
          <StepPersonality
            personality={data.personality}
            onPersonalityChange={(personality) =>
              setData((d) => ({ ...d, personality }))
            }
            onSkip={handleSkip}
          />
        )}
        {step === 3 && (
          <StepFinish
            name={data.name}
            color={data.color}
            model={data.model}
            fileCount={data.knowledgeFiles.length}
            personalityPreview={data.personality.description}
            onNameChange={(name) => setData((d) => ({ ...d, name }))}
            onColorChange={(color) => setData((d) => ({ ...d, color }))}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        )}
      </div>

      {/* Bottom navigation bar */}
      <div className="wizard-nav">
        {step > 0 ? (
          <button type="button" className="wizard-nav-btn wizard-nav-btn--back" onClick={goBack}>
            {t("wizard.back")}
          </button>
        ) : (
          <div />
        )}

        <div className="wizard-nav-right">
          {(step === 1 || step === 2) && (
            <button type="button" className="wizard-nav-btn wizard-nav-btn--skip" onClick={handleSkip}>
              {t("wizard.skip")}
            </button>
          )}
          {step < STEP_COUNT - 1 && (
            <button
              type="button"
              className="wizard-nav-btn wizard-nav-btn--next"
              onClick={goNext}
              disabled={!canNext()}
            >
              {t("wizard.next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
