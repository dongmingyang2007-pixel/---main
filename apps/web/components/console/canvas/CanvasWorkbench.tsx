"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { apiGet, apiPatch } from "@/lib/api";
import { startAssistantTraining } from "@/lib/assistant-training";
import { usePipelineConfig } from "@/hooks/usePipelineConfig";

import { KnowledgeCard } from "./KnowledgeCard";
import { ModelCard } from "./ModelCard";
import { PersonalityCard } from "./PersonalityCard";
import { PipelineCard } from "./PipelineCard";
import { SkillsCard } from "./SkillsCard";
import { ModelPickerModal } from "../ModelPickerModal";

/* ── Description parser ─────────────────────────── */

export interface ParsedDescription {
  modelId: string;
  modelTier: string;
  personality: string;
  tags: string[];
  color: string;
}

export function parseDescription(raw: string): ParsedDescription {
  const result: ParsedDescription = {
    modelId: "",
    modelTier: "",
    personality: "",
    tags: [],
    color: "",
  };

  if (!raw) return result;

  // Match structured fields: [key:value]
  const modelMatch = raw.match(/\[model:([^|]*)\|([^\]]*)\]/);
  if (modelMatch) {
    result.modelId = modelMatch[1];
    result.modelTier = modelMatch[2];
  }

  const personalityMatch = raw.match(/\[personality:([^\]]*)\]/);
  if (personalityMatch) {
    result.personality = personalityMatch[1];
  }

  const tagsMatch = raw.match(/\[tags:([^\]]*)\]/);
  if (tagsMatch) {
    result.tags = tagsMatch[1].split(",").filter(Boolean);
  }

  const colorMatch = raw.match(/\[color:([^\]]*)\]/);
  if (colorMatch) {
    result.color = colorMatch[1];
  }

  // If no structured fields matched, treat raw as personality text
  if (!modelMatch && !personalityMatch && !tagsMatch && !colorMatch) {
    result.personality = raw;
  }

  return result;
}

/* ── Catalog model type ─────────────────────────── */

interface CatalogModelInfo {
  model_id: string;
  display_name: string;
  capabilities: string[];
}

/* ── Component ──────────────────────────────────── */

interface ProjectData {
  id: string;
  name: string;
  description: string;
  status?: string;
}

interface CanvasWorkbenchProps {
  assistantId: string;
}

export function CanvasWorkbench({ assistantId }: CanvasWorkbenchProps) {
  const t = useTranslations("console-assistants");
  const tModels = useTranslations("console-models-v2");
  const router = useRouter();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [training, setTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  /* Pipeline config */
  const { getConfig, updateConfig } = usePipelineConfig(assistantId);

  /* Model picker modal state */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategory, setPickerCategory] = useState<
    "llm" | "asr" | "tts" | "vision"
  >("llm");

  /* LLM catalog info for vision capability check */
  const [llmCatalogInfo, setLlmCatalogInfo] =
    useState<CatalogModelInfo | null>(null);

  /* Fetch project data */
  useEffect(() => {
    if (!assistantId) return;
    void apiGet<ProjectData>(`/api/v1/projects/${assistantId}`).then((data) => {
      setProject(data);
      setNameValue(data.name);
    });
  }, [assistantId]);

  /* Fetch LLM catalog info when pipeline LLM config changes */
  const llmConfig = getConfig("llm");
  useEffect(() => {
    if (!llmConfig?.model_id) {
      setLlmCatalogInfo(null);
      return;
    }
    void apiGet<CatalogModelInfo>(
      `/api/v1/models/catalog/${llmConfig.model_id}`,
    )
      .then((info) => setLlmCatalogInfo(info))
      .catch(() => setLlmCatalogInfo(null));
  }, [llmConfig?.model_id]);

  const llmHasVision =
    llmCatalogInfo?.capabilities?.includes("vision") ?? false;

  /* Inline name edit */
  const handleNameBlur = useCallback(async () => {
    setEditingName(false);
    if (!project || nameValue.trim() === project.name) return;
    try {
      await apiPatch(`/api/v1/projects/${assistantId}`, {
        name: nameValue.trim(),
      });
      setProject((prev) =>
        prev ? { ...prev, name: nameValue.trim() } : prev,
      );
    } catch {
      // Revert on error
      if (project) setNameValue(project.name);
    }
  }, [assistantId, nameValue, project]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleNameBlur();
    }
    if (e.key === "Escape") {
      setEditingName(false);
      if (project) setNameValue(project.name);
    }
  };

  /* Save & Train */
  const handleSaveAndTrain = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    setTraining(true);
    setTrainProgress(0);

    try {
      await startAssistantTraining(assistantId);

      // Simulate progress for UX (real polling would replace this)
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setTraining(false);
        }
        setTrainProgress(Math.min(progress, 100));
      }, 600);
    } catch {
      setTraining(false);
    } finally {
      setSaving(false);
    }
  }, [assistantId, project]);

  /* Parse description */
  const parsed = parseDescription(project?.description || "");

  /* Handle personality description update */
  const handleDescriptionChange = useCallback(
    async (newPersonality: string) => {
      if (!project) return;
      // Rebuild description with updated personality
      const parts: string[] = [];
      if (parsed.modelId) {
        parts.push(`[model:${parsed.modelId}|${parsed.modelTier}]`);
      }
      if (newPersonality) {
        parts.push(`[personality:${newPersonality}]`);
      }
      if (parsed.tags.length > 0) {
        parts.push(`[tags:${parsed.tags.join(",")}]`);
      }
      if (parsed.color) {
        parts.push(`[color:${parsed.color}]`);
      }
      const description = parts.join("\n");

      try {
        await apiPatch(`/api/v1/projects/${assistantId}`, { description });
        setProject((prev) => (prev ? { ...prev, description } : prev));
      } catch {
        // Silently fail — could add toast later
      }
    },
    [assistantId, parsed, project],
  );

  /* Open model picker for a given category */
  const openPicker = (category: "llm" | "asr" | "tts" | "vision") => {
    setPickerCategory(category);
    setPickerOpen(true);
  };

  /* Handle model selection from picker */
  const handleModelSelect = async (modelId: string) => {
    await updateConfig(pickerCategory, modelId);
    setPickerOpen(false);
  };

  /* Resolve display names from pipeline config */
  const asrConfig = getConfig("asr");
  const ttsConfig = getConfig("tts");
  const visionConfig = getConfig("vision");

  if (!project) {
    return (
      <div className="canvas-loading">
        <span>{"\u2026"}</span>
      </div>
    );
  }

  return (
    <div className="canvas-workbench">
      {/* Top bar */}
      <div className="canvas-top-bar">
        <div className="canvas-top-bar-left">
          {editingName ? (
            <input
              className="canvas-top-bar-name-input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={() => void handleNameBlur()}
              onKeyDown={handleNameKeyDown}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="canvas-top-bar-name"
              onClick={() => setEditingName(true)}
              title={t("canvas.clickToRename")}
            >
              {project.name}
            </button>
          )}
          {project.status && (
            <span className="canvas-status-badge">{project.status}</span>
          )}
        </div>

        <div className="canvas-top-bar-right">
          <button
            type="button"
            className="canvas-btn-secondary"
            onClick={() => router.push("/app/chat")}
          >
            {t("canvas.tryChat")}
          </button>
          <button
            type="button"
            className="canvas-btn-primary"
            onClick={() => void handleSaveAndTrain()}
            disabled={saving}
          >
            {saving ? "\u2026" : t("canvas.saveAndTrain")}
          </button>
        </div>
      </div>

      {/* Training progress bar */}
      {training && (
        <div className="canvas-progress-bar">
          <div
            className="canvas-progress-fill"
            style={{ width: `${trainProgress}%` }}
          />
        </div>
      )}

      {/* 2x2 Grid */}
      <div className="canvas-grid">
        <ModelCard parsed={parsed} onChangeClick={() => openPicker("llm")} />
        <KnowledgeCard assistantId={assistantId} />
        <PersonalityCard
          parsed={parsed}
          rawDescription={project.description}
          onDescriptionChange={handleDescriptionChange}
        />
        <SkillsCard parsed={parsed} />
      </div>

      {/* Pipeline row: ASR + TTS (+ Vision if LLM lacks it) */}
      <div className="canvas-grid canvas-grid--pipeline">
        <PipelineCard
          label={tModels("pipelineAsr")}
          modelType="asr"
          currentModelId={asrConfig?.model_id}
          onChangeClick={() => openPicker("asr")}
        />
        <PipelineCard
          label={tModels("pipelineTts")}
          modelType="tts"
          currentModelId={ttsConfig?.model_id}
          onChangeClick={() => openPicker("tts")}
        />
        {!llmHasVision && (
          <PipelineCard
            label={tModels("pipelineVision")}
            modelType="vision"
            currentModelId={visionConfig?.model_id}
            onChangeClick={() => openPicker("vision")}
          />
        )}
        {llmHasVision && (
          <PipelineCard
            label={tModels("pipelineVision")}
            modelType="vision"
            disabled
            disabledText={tModels("pipelineVisionAuto")}
            onChangeClick={() => {}}
          />
        )}
      </div>

      {/* Model picker modal */}
      <ModelPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        category={pickerCategory}
        currentModelId={
          pickerCategory === "llm"
            ? llmConfig?.model_id
            : pickerCategory === "asr"
              ? asrConfig?.model_id
              : pickerCategory === "tts"
                ? ttsConfig?.model_id
                : visionConfig?.model_id
        }
        onSelect={(modelId) => void handleModelSelect(modelId)}
      />
    </div>
  );
}
