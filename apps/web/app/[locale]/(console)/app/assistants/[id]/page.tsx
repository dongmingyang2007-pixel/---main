"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ModelPickerModal } from "@/components/console/ModelPickerModal";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { StepIdentity } from "@/components/console/wizard/StepIdentity";
import { StepPersonality } from "@/components/console/wizard/StepPersonality";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { startAssistantTraining } from "@/lib/assistant-training";
import { MODEL_PICKER_SELECTION_KEY } from "@/lib/discover-labels";
import { apiGet, apiPatch } from "@/lib/api";
import { uploadKnowledgeFiles } from "@/lib/knowledge-upload";

type ProfileTab = "overview" | "personality" | "knowledge" | "models";
type ChatMode = "standard" | "omni_realtime" | "synthetic_realtime";
type PipelineType =
  | "llm"
  | "asr"
  | "tts"
  | "vision"
  | "realtime"
  | "realtime_asr"
  | "realtime_tts";

interface ProjectData {
  id: string;
  name: string;
  description: string;
  default_chat_mode: ChatMode;
  created_at: string;
}

interface ConversationItem {
  id: string;
  title: string;
  updated_at: string;
}

interface PipelineConfigItem {
  id: string;
  project_id: string;
  model_type: PipelineType;
  model_id: string;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface PipelineResponse {
  items: PipelineConfigItem[];
}

interface DatasetInfo {
  id: string;
  name: string;
  type: string;
}

interface CatalogModelItem {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  category: PipelineType;
  description: string;
  capabilities: string[];
}

interface KnowledgeItem {
  id: string;
  dataset_id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  download_url: string;
  preview_url?: string | null;
  created_at: string;
}

interface ParsedMeta {
  model: string;
  modelTier: string;
  personality: string;
  tags: string[];
  color: string;
  greeting: string;
  plainDescription: string;
}

interface SettingsFormState {
  name: string;
  color: string;
  greeting: string;
  personality: {
    description: string;
    tags: string[];
  };
}

const ACCEPTED_KNOWLEDGE_EXTENSIONS = [".pdf", ".txt", ".docx", ".md"];
const ACCEPTED_KNOWLEDGE_MIME = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
];
const DEFAULT_REALTIME_MODEL_ID = "qwen3-omni-flash-realtime";
const DEFAULT_REALTIME_ASR_MODEL_ID = "qwen3-asr-flash-realtime";
const DEFAULT_REALTIME_TTS_MODEL_ID = "qwen3-tts-flash-realtime";

interface PendingModelSelection {
  from: string;
  category: PipelineType;
  modelId: string;
  displayName: string;
}

function parseDescription(description: string): ParsedMeta {
  const meta: ParsedMeta = {
    model: "",
    modelTier: "",
    personality: "",
    tags: [],
    color: "accent",
    greeting: "",
    plainDescription: "",
  };

  if (!description) return meta;

  const modelMatch = description.match(/\[model:([^|]*)\|([^\]]*)\]/);
  if (modelMatch) {
    meta.model = modelMatch[1];
    meta.modelTier = modelMatch[2];
  }

  const personalityMatch = description.match(/\[personality:([\s\S]*?)\]/);
  if (personalityMatch) {
    meta.personality = personalityMatch[1];
  }

  const tagsMatch = description.match(/\[tags:([^\]]*)\]/);
  if (tagsMatch) {
    meta.tags = tagsMatch[1].split(",").filter(Boolean);
  }

  const colorMatch = description.match(/\[color:([^\]]*)\]/);
  if (colorMatch) {
    meta.color = colorMatch[1];
  }

  const greetingMatch = description.match(/\[greeting:([\s\S]*?)\]/);
  if (greetingMatch) {
    meta.greeting = greetingMatch[1];
  }

  meta.plainDescription = description
    .replace(/\[model:[^\]]*\]/g, "")
    .replace(/\[personality:[\s\S]*?\]/g, "")
    .replace(/\[tags:[^\]]*\]/g, "")
    .replace(/\[color:[^\]]*\]/g, "")
    .replace(/\[greeting:[\s\S]*?\]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return meta;
}

function buildDescription(meta: ParsedMeta): string {
  const parts: string[] = [];

  if (meta.model) {
    parts.push(`[model:${meta.model}|${meta.modelTier || "custom"}]`);
  }
  if (meta.personality) {
    parts.push(`[personality:${meta.personality}]`);
  }
  if (meta.tags.length > 0) {
    parts.push(`[tags:${meta.tags.join(",")}]`);
  }
  if (meta.color) {
    parts.push(`[color:${meta.color}]`);
  }
  if (meta.greeting) {
    parts.push(`[greeting:${meta.greeting}]`);
  }
  if (meta.plainDescription) {
    parts.push(meta.plainDescription);
  }

  return parts.join("\n");
}

function formatModelName(modelId: string): string {
  const map: Record<string, string> = {
    "qwen3.5-plus": "Qwen 3.5 Plus",
    "qwen3-omni-flash-realtime": "Qwen3-Omni-Flash-Realtime",
    "qwen3-asr-flash": "Qwen3-ASR-Flash",
    "qwen3-asr-flash-realtime": "Qwen3-ASR-Flash-Realtime",
    "qwen3-tts-flash": "Qwen3-TTS-Flash",
    "qwen3-tts-flash-realtime": "Qwen3-TTS-Flash-Realtime",
    "qwen3-vl-plus": "Qwen3-VL-Plus",
    "qwen-plus": "Qwen Plus",
    "qwen-max": "Qwen Max",
    "qwen-turbo": "Qwen Turbo",
    "qwen-vl-plus": "Qwen VL Plus",
    "qwen-vl-max": "Qwen VL Max",
    "paraformer-v2": "Paraformer-v2",
    "cosyvoice-v1": "CosyVoice-v1",
    cosyvoice: "CosyVoice",
  };
  return map[modelId] || modelId || "Qwen 3.5 Plus";
}

function formatDate(iso: string): string {
  if (!iso) return "---";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedKnowledgeFile(file: File): boolean {
  const extension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  return ACCEPTED_KNOWLEDGE_EXTENSIONS.includes(extension) || ACCEPTED_KNOWLEDGE_MIME.includes(file.type);
}

const COLOR_MAP: Record<string, string> = {
  accent: "#c8734a",
  blue: "#3b82f6",
  green: "#22c55e",
  purple: "#a855f7",
  pink: "#ec4899",
  orange: "#f97316",
  red: "#ef4444",
};

function getColorValue(color: string): string {
  return COLOR_MAP[color] || color || "#c8734a";
}

function getPipelineModelId(items: PipelineConfigItem[], modelType: PipelineType, fallback: string): string {
  return items.find((item) => item.model_type === modelType)?.model_id || fallback;
}

function sortKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  return [...items].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return timeB - timeA;
  });
}

function modelSupportsVision(model?: CatalogModelItem | null): boolean {
  if (!model) {
    return false;
  }
  const capabilities = new Set((model.capabilities || []).map((cap) => cap.toLowerCase()));
  return capabilities.has("vision") || capabilities.has("image") || capabilities.has("ocr") || capabilities.has("video");
}

function modelHasCapabilities(model: CatalogModelItem | undefined, ...required: string[]): boolean {
  if (!model) {
    return false;
  }
  const capabilities = new Set((model.capabilities || []).map((cap) => cap.toLowerCase()));
  return required.every((capability) => capabilities.has(capability.toLowerCase()));
}

function SettingsDialog({
  initialState,
  saving,
  errorMessage,
  onOpenChange,
  onSave,
}: {
  initialState: SettingsFormState;
  saving: boolean;
  errorMessage: string;
  onOpenChange: (open: boolean) => void;
  onSave: (state: SettingsFormState) => Promise<void>;
}) {
  const t = useTranslations("console-assistants");
  const [state, setState] = useState<SettingsFormState>(initialState);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[980px] overflow-y-auto border-[var(--border)] bg-[var(--bg-card)]">
        <DialogHeader>
          <DialogTitle>{t("profile.settings")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-8">
          <StepIdentity
            name={state.name}
            color={state.color}
            greeting={state.greeting}
            onNameChange={(name) => setState((current) => ({ ...current, name }))}
            onColorChange={(color) => setState((current) => ({ ...current, color }))}
            onGreetingChange={(greeting) => setState((current) => ({ ...current, greeting }))}
          />

          <StepPersonality
            personality={state.personality}
            onPersonalityChange={(personality) => setState((current) => ({ ...current, personality }))}
          />

          {errorMessage ? (
            <div className="console-inline-notice is-error">{errorMessage}</div>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="console-button-secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("graph.cancel")}
          </button>
          <button
            type="button"
            className="console-button"
            onClick={() => void onSave(state)}
            disabled={saving || !state.name.trim()}
          >
            {saving ? t("wizard.submitting") : t("graph.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeDialog({
  loading,
  uploading,
  errorMessage,
  items,
  onOpenChange,
  onUpload,
}: {
  loading: boolean;
  uploading: boolean;
  errorMessage: string;
  items: KnowledgeItem[];
  onOpenChange: (open: boolean) => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const t = useTranslations("console-assistants");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const accepted: File[] = [];
    let rejected = false;

    for (const file of Array.from(incoming)) {
      if (isAcceptedKnowledgeFile(file)) {
        accepted.push(file);
      } else {
        rejected = true;
      }
    }

    setSelectedFiles((current) => [...current, ...accepted]);
    setSelectionError(rejected ? t("wizard.uploadHint") : "");
  }, [t]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[860px] overflow-y-auto border-[var(--border)] bg-[var(--bg-card)]">
        <DialogHeader>
          <DialogTitle>{t("profile.card.knowledge")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <div className="wizard-step-title">{t("wizard.stepKnowledge")}</div>
            <div className="wizard-step-desc">{t("wizard.stepKnowledgeDesc")}</div>
          </div>

          <div
            className="wizard-upload-area"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (uploading) return;
              if (event.dataTransfer.files.length > 0) {
                addFiles(event.dataTransfer.files);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !uploading) {
                inputRef.current?.click();
              }
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_KNOWLEDGE_EXTENSIONS.join(",")}
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                if (event.target.files) {
                  addFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <div className="wizard-upload-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="wizard-upload-text">{t("wizard.uploadText")}</p>
            <p className="wizard-upload-hint">{t("wizard.uploadHint")}</p>
          </div>

          {selectedFiles.length > 0 ? (
            <ul className="wizard-file-list">
              {selectedFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="wizard-file-item">
                  <span className="wizard-file-name">{file.name}</span>
                  <span className="wizard-file-size">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    className="wizard-file-remove"
                    onClick={() => {
                      setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
                    }}
                    aria-label={`Remove ${file.name}`}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {t("profile.card.knowledge")}
            </div>
            {loading ? (
              <div className="text-sm text-[var(--text-secondary)]">{t("versions.loading")}</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)]">{t("profile.noFiles")}</div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <a
                    key={item.id}
                    href={item.download_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 no-underline transition-colors hover:border-[var(--accent)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.filename}</div>
                      <div className="text-xs text-[var(--text-secondary)]">{formatFileSize(item.size_bytes)}</div>
                    </div>
                    <span className="text-xs font-medium text-[var(--accent)]">{t("graph.viewDetail")}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {selectionError ? (
            <div className="console-inline-notice is-error">{selectionError}</div>
          ) : null}
          {errorMessage ? (
            <div className="console-inline-notice is-error">{errorMessage}</div>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="console-button-secondary"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            {t("graph.cancel")}
          </button>
          <button
            type="button"
            className="console-button"
            onClick={() => void onUpload(selectedFiles)}
            disabled={uploading || selectedFiles.length === 0}
          >
            {uploading ? t("wizard.submitting") : t("canvas.saveAndTrain")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");

  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [project, setProject] = useState<ProjectData | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [pipelineItems, setPipelineItems] = useState<PipelineConfigItem[]>([]);
  const [catalogModels, setCatalogModels] = useState<CatalogModelItem[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [knowledgeError, setKnowledgeError] = useState("");
  const [pageError, setPageError] = useState("");
  const [pickerCategory, setPickerCategory] = useState<PipelineType | null>(null);

  const loadKnowledgeItems = useCallback(async () => {
    if (!projectId) {
      setKnowledgeItems([]);
      return;
    }

    setKnowledgeLoading(true);
    try {
      const datasets = await apiGet<DatasetInfo[]>(`/api/v1/datasets?project_id=${projectId}`).catch(() => []);
      if (datasets.length === 0) {
        setKnowledgeItems([]);
        return;
      }

      const itemResults = await Promise.allSettled(
        datasets.map((dataset) => apiGet<KnowledgeItem[]>(`/api/v1/datasets/${dataset.id}/items`)),
      );
      const items = itemResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      setKnowledgeItems(sortKnowledgeItems(items));
    } catch {
      setKnowledgeItems([]);
    } finally {
      setKnowledgeLoading(false);
    }
  }, [projectId]);

  const loadData = useCallback(async (showLoading = false) => {
    if (!projectId) {
      setProject(null);
      setConversations([]);
      setPipelineItems([]);
      setKnowledgeItems([]);
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    const [projectResult, conversationResult, pipelineResult, catalogResult] = await Promise.allSettled([
      apiGet<ProjectData>(`/api/v1/projects/${projectId}`),
      apiGet<ConversationItem[]>(`/api/v1/chat/conversations?project_id=${projectId}`),
      apiGet<PipelineResponse>(`/api/v1/pipeline?project_id=${projectId}`),
      apiGet<CatalogModelItem[]>("/api/v1/models/catalog"),
    ]);

    if (projectResult.status === "fulfilled") {
      setProject(projectResult.value);
      setPageError("");
    } else {
      setProject(null);
      setPageError(projectResult.reason instanceof Error ? projectResult.reason.message : "");
    }

    setConversations(
      conversationResult.status === "fulfilled" && Array.isArray(conversationResult.value)
        ? conversationResult.value
        : [],
    );
    setPipelineItems(
      pipelineResult.status === "fulfilled" && Array.isArray(pipelineResult.value.items)
        ? pipelineResult.value.items
        : [],
    );
    setCatalogModels(
      catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value)
        ? catalogResult.value
        : [],
    );

    await loadKnowledgeItems();

    if (showLoading) {
      setLoading(false);
    }
  }, [loadKnowledgeItems, projectId]);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const meta = useMemo(() => parseDescription(project?.description || ""), [project?.description]);
  const colorVal = getColorValue(meta.color);
  const conversationCount = conversations.length;
  const personalityExcerpt = meta.personality
    ? meta.personality.length > 100
      ? `${meta.personality.slice(0, 100)}...`
      : meta.personality
    : "";
  const settingsInitialState = useMemo<SettingsFormState>(() => ({
    name: project?.name || "",
    color: meta.color,
    greeting: meta.greeting,
    personality: {
      description: meta.personality,
      tags: meta.tags,
    },
  }), [meta.color, meta.greeting, meta.personality, meta.tags, project?.name]);

  const llmModelId = getPipelineModelId(pipelineItems, "llm", meta.model || "qwen3.5-plus");
  const visionModelId = getPipelineModelId(pipelineItems, "vision", "qwen-vl-plus");
  const asrModelId = getPipelineModelId(pipelineItems, "asr", "paraformer-v2");
  const ttsModelId = getPipelineModelId(pipelineItems, "tts", "cosyvoice-v1");
  const realtimeModelId = getPipelineModelId(pipelineItems, "realtime", DEFAULT_REALTIME_MODEL_ID);
  const realtimeAsrModelId = getPipelineModelId(
    pipelineItems,
    "realtime_asr",
    DEFAULT_REALTIME_ASR_MODEL_ID,
  );
  const realtimeTtsModelId = getPipelineModelId(
    pipelineItems,
    "realtime_tts",
    DEFAULT_REALTIME_TTS_MODEL_ID,
  );
  const catalogModelsById = useMemo(
    () => new Map(catalogModels.map((item) => [item.model_id, item])),
    [catalogModels],
  );
  const llmCatalogModel = catalogModelsById.get(llmModelId);
  const llmSupportsBuiltInVision = modelSupportsVision(llmCatalogModel);
  const llmSupportsAudioInput = modelHasCapabilities(llmCatalogModel, "audio_input");
  const llmSupportsAudioOutput = modelHasCapabilities(llmCatalogModel, "audio_output");
  const llmSupportsVideoInput = modelHasCapabilities(llmCatalogModel, "video");
  const displayModelName = (modelId: string) => {
    const formatted = formatModelName(modelId);
    if (formatted && formatted !== modelId) {
      return formatted;
    }
    return catalogModelsById.get(modelId)?.display_name || formatted;
  };

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "overview", label: t("profile.tab.overview") },
    { key: "personality", label: t("profile.tab.personality") },
    { key: "knowledge", label: t("profile.tab.knowledge") },
    { key: "models", label: t("profile.tab.models") },
  ];

  const modeOptions: {
    key: ChatMode;
    title: string;
    description: string;
    disabled?: boolean;
    helperText?: string;
  }[] = [
    {
      key: "standard",
      title: t("profile.mode.standard"),
      description: t("profile.mode.standardDesc"),
    },
    {
      key: "omni_realtime",
      title: t("profile.mode.omni"),
      description: t("profile.mode.omniDesc"),
    },
    {
      key: "synthetic_realtime",
      title: t("profile.mode.synthetic"),
      description: t("profile.mode.syntheticDesc"),
      disabled: !llmSupportsBuiltInVision,
      helperText: !llmSupportsBuiltInVision
        ? t("profile.mode.syntheticRequiresVision", {
            model: displayModelName(llmModelId),
          })
        : llmSupportsVideoInput
          ? t("profile.mode.syntheticSupportsVideo", {
              model: displayModelName(llmModelId),
            })
          : t("profile.mode.syntheticImageOnly", {
              model: displayModelName(llmModelId),
            }),
    },
  ];

  const modelRows: {
    key: PipelineType | "realtime";
    changeTargetType?: PipelineType;
    shortLabel: string;
    label: string;
    modelId: string;
    helperText?: string;
    changeable: boolean;
    statusLabel?: string;
  }[] = [
    {
      key: "llm",
      changeTargetType: "llm",
      shortLabel: t("profile.model.llmShort"),
      label: t("profile.model.llm"),
      modelId: llmModelId,
      changeable: true,
    },
    {
      key: "vision",
      changeTargetType: "vision",
      shortLabel: t("profile.model.visionShort"),
      label: t("profile.model.vision"),
      modelId: llmSupportsBuiltInVision ? llmModelId : visionModelId,
      helperText: llmSupportsBuiltInVision
        ? t("profile.model.visionCoveredByLlm", { model: displayModelName(llmModelId) })
        : t("profile.model.visionSelected", { model: displayModelName(visionModelId) }),
      changeable: !llmSupportsBuiltInVision,
      statusLabel: llmSupportsBuiltInVision ? t("profile.model.followChatModel") : undefined,
    },
    {
      key: "asr",
      changeTargetType: "asr",
      shortLabel: t("profile.model.asrShort"),
      label: t("profile.model.asr"),
      modelId: llmSupportsAudioInput ? llmModelId : asrModelId,
      helperText: llmSupportsAudioInput
        ? t("profile.model.audioInputCoveredByLlm", { model: displayModelName(llmModelId) })
        : undefined,
      changeable: !llmSupportsAudioInput,
      statusLabel: llmSupportsAudioInput ? t("profile.model.followChatModel") : undefined,
    },
    {
      key: "tts",
      changeTargetType: "tts",
      shortLabel: t("profile.model.ttsShort"),
      label: t("profile.model.tts"),
      modelId: llmSupportsAudioOutput ? llmModelId : ttsModelId,
      helperText: llmSupportsAudioOutput
        ? t("profile.model.audioOutputCoveredByLlm", { model: displayModelName(llmModelId) })
        : undefined,
      changeable: !llmSupportsAudioOutput,
      statusLabel: llmSupportsAudioOutput ? t("profile.model.followChatModel") : undefined,
    },
    {
      key: "realtime",
      changeTargetType: "realtime",
      shortLabel: t("profile.model.realtimeShort"),
      label: t("profile.model.realtime"),
      modelId: realtimeModelId,
      helperText: t("profile.model.realtimeSelected", { model: displayModelName(realtimeModelId) }),
      changeable: true,
    },
    {
      key: "realtime_asr",
      changeTargetType: "realtime_asr",
      shortLabel: t("profile.model.realtimeAsrShort"),
      label: t("profile.model.realtimeAsr"),
      modelId: realtimeAsrModelId,
      helperText: t("profile.model.realtimeAsrSelected", {
        model: displayModelName(realtimeAsrModelId),
      }),
      changeable: true,
    },
    {
      key: "realtime_tts",
      changeTargetType: "realtime_tts",
      shortLabel: t("profile.model.realtimeTtsShort"),
      label: t("profile.model.realtimeTts"),
      modelId: realtimeTtsModelId,
      helperText: t("profile.model.realtimeTtsSelected", {
        model: displayModelName(realtimeTtsModelId),
      }),
      changeable: true,
    },
  ];

  const standardModeRows = modelRows.filter((row) => ["llm", "vision", "asr", "tts"].includes(row.key));
  const omniModeRows = modelRows.filter((row) => row.key === "realtime");
  const syntheticModeRows = [
    {
      key: "synthetic-llm",
      changeTargetType: "llm" as PipelineType,
      shortLabel: t("profile.model.llmShort"),
      label: t("profile.model.syntheticLlm"),
      modelId: llmModelId,
      helperText: t("profile.model.syntheticLlmHelper", { model: displayModelName(llmModelId) }),
      changeable: true,
      statusLabel: llmSupportsBuiltInVision ? t("profile.model.syntheticVisionReady") : t("profile.model.syntheticVisionMissing"),
    },
    ...modelRows.filter((row) => row.key === "realtime_asr" || row.key === "realtime_tts"),
  ];

  const openKnowledgeManager = useCallback(() => {
    setKnowledgeError("");
    setActiveTab("knowledge");
    setKnowledgeOpen(true);
    void loadKnowledgeItems();
  }, [loadKnowledgeItems]);

  const saveSettings = useCallback(async (state: SettingsFormState) => {
    if (!projectId) return;

    setSettingsSaving(true);
    setSettingsError("");
    try {
      const nextProject = await apiPatch<ProjectData>(`/api/v1/projects/${projectId}`, {
        name: state.name.trim(),
        description: buildDescription({
          ...meta,
          model: llmModelId,
          modelTier: meta.modelTier || "custom",
          color: state.color,
          greeting: state.greeting,
          personality: state.personality.description,
          tags: state.personality.tags,
        }),
      });
      setProject(nextProject);
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSettingsSaving(false);
    }
  }, [llmModelId, meta, projectId]);

  const handleDefaultChatModeSelect = useCallback(async (nextMode: ChatMode) => {
    if (!projectId || !project) {
      return;
    }
    if (nextMode === project.default_chat_mode) {
      return;
    }
    if (nextMode === "synthetic_realtime" && !llmSupportsBuiltInVision) {
      return;
    }

    setModeSaving(true);
    setPageError("");
    try {
      const nextProject = await apiPatch<ProjectData>(`/api/v1/projects/${projectId}`, {
        default_chat_mode: nextMode,
      });
      setProject(nextProject);
      setActiveTab("models");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Chat mode update failed");
    } finally {
      setModeSaving(false);
    }
  }, [llmSupportsBuiltInVision, project, projectId]);

  const handleModelSelect = useCallback(async (modelId: string, explicitCategory?: PipelineType | null) => {
    const targetCategory = explicitCategory ?? pickerCategory;
    if (!projectId || !targetCategory) return;

    setPageError("");
    try {
      await apiPatch("/api/v1/pipeline", {
        project_id: projectId,
        model_type: targetCategory,
        model_id: modelId,
        config_json: {},
      });

      if (targetCategory === "llm") {
        const selectedModel = catalogModelsById.get(modelId);
        const nextSupportsVision = selectedModel ? modelSupportsVision(selectedModel) : true;
        try {
          const updatedProject = await apiPatch<ProjectData>(`/api/v1/projects/${projectId}`, {
            description: buildDescription({
              ...meta,
              model: modelId,
              modelTier: meta.modelTier || "custom",
            }),
            default_chat_mode:
              project?.default_chat_mode === "synthetic_realtime" && !nextSupportsVision
                ? "standard"
                : project?.default_chat_mode,
          });
          setProject(updatedProject);
        } catch (error) {
          await loadData();
          setPageError(
            error instanceof Error
              ? `${t("profile.modelSyncFailed")} ${error.message}`
              : t("profile.modelSyncFailed"),
          );
          return;
        }
      }

      await loadData();
      setPickerCategory(null);
      setActiveTab("models");
    } catch (error) {
      await loadData();
      setPageError(error instanceof Error ? error.message : "Model change failed");
    }
  }, [catalogModelsById, loadData, meta, pickerCategory, project?.default_chat_mode, projectId, t]);

  useEffect(() => {
    if (typeof window === "undefined" || !projectId || !project) {
      return;
    }

    const rawPending = window.sessionStorage.getItem(MODEL_PICKER_SELECTION_KEY);
    if (!rawPending) {
      return;
    }

    let pending: PendingModelSelection | null = null;
    try {
      pending = JSON.parse(rawPending) as PendingModelSelection;
    } catch {
      window.sessionStorage.removeItem(MODEL_PICKER_SELECTION_KEY);
      return;
    }

    if (!pending) {
      window.sessionStorage.removeItem(MODEL_PICKER_SELECTION_KEY);
      return;
    }

    const expectedPath = (pending.from || "").split("?")[0];
    if (!expectedPath || expectedPath !== window.location.pathname) {
      return;
    }

    window.sessionStorage.removeItem(MODEL_PICKER_SELECTION_KEY);
    void handleModelSelect(pending.modelId, pending.category);
  }, [handleModelSelect, project, projectId]);

  const handleKnowledgeUpload = useCallback(async (files: File[]) => {
    if (!projectId || files.length === 0) return;

    setKnowledgeUploading(true);
    setKnowledgeError("");
    try {
      await uploadKnowledgeFiles(projectId, files);
      await startAssistantTraining(projectId);
      await loadKnowledgeItems();
      setKnowledgeOpen(false);
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setKnowledgeUploading(false);
    }
  }, [loadKnowledgeItems, projectId]);

  if (loading) {
    return (
      <PanelLayout>
        <PageTransition>
          <div className="assistant-profile">
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
              Loading...
            </div>
          </div>
        </PageTransition>
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <PageTransition>
        <div className="assistant-profile">
          <div className="assistant-profile-header">
            <div
              className="assistant-profile-avatar"
              style={{
                background: `linear-gradient(135deg, ${colorVal}, color-mix(in srgb, ${colorVal} 70%, white))`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" />
                <rect x="8" y="8" width="8" height="8" rx="1" />
                <path d="M2 12h2M20 12h2M12 2v2M12 20v2" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>

            <div className="assistant-profile-info">
              <h1 className="assistant-profile-name">{project?.name || "---"}</h1>
              {personalityExcerpt ? (
                <div className="assistant-profile-tagline">{personalityExcerpt}</div>
              ) : null}
              <div className="assistant-profile-meta">
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {formatDate(project?.created_at || "")}
                </span>
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {conversationCount} {t("profile.stat.conversations")}
                </span>
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="12 6 9 12 15 12" fill="none" />
                    <line x1="12" y1="12" x2="12" y2="18" />
                  </svg>
                  0 {t("profile.stat.memories")}
                </span>
              </div>
            </div>

            <div className="assistant-profile-actions">
              <Link href={`/app/chat?project_id=${projectId}`} className="profile-btn primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t("profile.startChat")}
              </Link>
              <button
                type="button"
                className="profile-btn"
                onClick={() => {
                  setSettingsError("");
                  setSettingsOpen(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                {t("profile.settings")}
              </button>
            </div>
          </div>

          {pageError ? (
            <div className="console-inline-notice is-error" style={{ marginBottom: "16px" }}>
              {pageError}
            </div>
          ) : null}

          <div className="assistant-profile-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`profile-tab${activeTab === tab.key ? " active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <div className="profile-grid">
              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t("profile.card.personality")}
                  <button
                    type="button"
                    className="profile-card-action"
                    onClick={() => {
                      setActiveTab("personality");
                      setSettingsError("");
                      setSettingsOpen(true);
                    }}
                  >
                    {t("profile.edit")}
                  </button>
                </div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
                  {meta.tags.length > 0 ? meta.tags.join(", ") : t("profile.customPersonality")}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {personalityExcerpt || t("canvas.personalityUnset")}
                </div>
              </div>

              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  {t("profile.card.activity")}
                </div>
                <div className="profile-stat-row">
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">{conversationCount}</div>
                    <div className="profile-stat-label">{t("profile.stat.conversations")}</div>
                  </div>
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">&mdash;</div>
                    <div className="profile-stat-label">{t("profile.stat.memories")}</div>
                  </div>
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">&mdash;</div>
                    <div className="profile-stat-label">{t("profile.stat.hours")}</div>
                  </div>
                </div>
              </div>

              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                  {t("profile.card.models")}
                </div>
                <div className="profile-mode-summary">
                  <span className="profile-mode-summary-label">{t("profile.defaultMode")}</span>
                  <span className="profile-model-badge">
                    {modeOptions.find((option) => option.key === project?.default_chat_mode)?.title || t("profile.mode.standard")}
                  </span>
                </div>
                {modelRows.map((row) => (
                  <div key={row.key} className="profile-model-row">
                    <div className="profile-model-icon">{row.shortLabel}</div>
                    <div className="profile-model-info">
                      <div className="profile-model-label">{row.label}</div>
                      <div className="profile-model-name-row">
                        <div className="profile-model-name">{displayModelName(row.modelId)}</div>
                        {!row.changeable && row.statusLabel ? (
                          <span className="profile-model-badge">{row.statusLabel}</span>
                        ) : null}
                      </div>
                      {row.helperText ? (
                        <div className="profile-model-helper">{row.helperText}</div>
                      ) : null}
                    </div>
                    {row.changeable ? (
                      <button
                        type="button"
                        className="profile-model-change"
                        onClick={() => {
                          setActiveTab("models");
                          setPickerCategory(row.changeTargetType || null);
                        }}
                      >
                        {t("profile.change")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  {t("profile.card.knowledge")}
                  <button
                    type="button"
                    className="profile-card-action"
                    onClick={openKnowledgeManager}
                  >
                    {t("profile.manage")}
                  </button>
                </div>
                {knowledgeItems.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", padding: "16px 0", textAlign: "center" }}>
                    {t("profile.noFiles")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "8px", paddingTop: "10px" }}>
                    {knowledgeItems.slice(0, 3).map((item) => (
                      <a
                        key={item.id}
                        href={item.download_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          padding: "10px 12px",
                          border: "1px solid var(--border)",
                          borderRadius: "14px",
                          color: "var(--text-primary)",
                          textDecoration: "none",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.filename}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          {formatFileSize(item.size_bytes)}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "personality" ? (
            <div style={{ padding: "24px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
              {meta.personality || t("canvas.personalityUnset")}
            </div>
          ) : null}

          {activeTab === "knowledge" ? (
            <div style={{ padding: "24px 0" }}>
              {knowledgeLoading ? (
                <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{t("versions.loading")}</div>
              ) : knowledgeItems.length === 0 ? (
                <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{t("profile.noFiles")}</div>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {knowledgeItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.download_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "16px",
                        padding: "14px 16px",
                        border: "1px solid var(--border)",
                        borderRadius: "18px",
                        textDecoration: "none",
                        color: "var(--text-primary)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.filename}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {formatFileSize(item.size_bytes)}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>{t("graph.viewDetail")}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "models" ? (
            <div style={{ padding: "24px 0", display: "grid", gap: "12px" }}>
              <div className="profile-mode-section">
                <div className="profile-mode-section-header">
                  <div className="profile-card-title" style={{ marginBottom: 0 }}>
                    {t("profile.defaultMode")}
                  </div>
                  {modeSaving ? (
                    <span className="profile-model-helper">{t("wizard.submitting")}</span>
                  ) : null}
                </div>
                <div className="profile-mode-grid">
                  {modeOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`profile-mode-card${project?.default_chat_mode === option.key ? " is-active" : ""}${option.disabled ? " is-disabled" : ""}`}
                      onClick={() => void handleDefaultChatModeSelect(option.key)}
                      disabled={modeSaving || option.disabled}
                    >
                      <div className="profile-mode-card-title-row">
                        <div className="profile-mode-card-title">{option.title}</div>
                        {project?.default_chat_mode === option.key ? (
                          <span className="profile-model-badge">{t("profile.mode.defaultBadge")}</span>
                        ) : null}
                      </div>
                      <div className="profile-mode-card-desc">{option.description}</div>
                      {option.helperText ? (
                        <div className="profile-model-helper">{option.helperText}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="profile-mode-section">
                <div className="profile-mode-section-header">
                  <div className="profile-card-title" style={{ marginBottom: 0 }}>
                    {t("profile.mode.standard")}
                  </div>
                  <div className="profile-model-helper">{t("profile.mode.standardDesc")}</div>
                </div>
                {standardModeRows.map((row) => (
                  <div key={row.key} className="profile-model-row">
                    <div className="profile-model-icon">{row.shortLabel}</div>
                    <div className="profile-model-info">
                      <div className="profile-model-label">{row.label}</div>
                      <div className="profile-model-name-row">
                        <div className="profile-model-name">{displayModelName(row.modelId)}</div>
                        {!row.changeable && row.statusLabel ? (
                          <span className="profile-model-badge">{row.statusLabel}</span>
                        ) : null}
                      </div>
                      {row.helperText ? (
                        <div className="profile-model-helper">{row.helperText}</div>
                      ) : null}
                    </div>
                    {row.changeable ? (
                      <button
                        type="button"
                        className="profile-model-change"
                        onClick={() => setPickerCategory(row.changeTargetType || null)}
                      >
                        {t("profile.change")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="profile-mode-section">
                <div className="profile-mode-section-header">
                  <div className="profile-card-title" style={{ marginBottom: 0 }}>
                    {t("profile.mode.omni")}
                  </div>
                  <div className="profile-model-helper">{t("profile.mode.omniDesc")}</div>
                </div>
                {omniModeRows.map((row) => (
                  <div key={row.key} className="profile-model-row">
                    <div className="profile-model-icon">{row.shortLabel}</div>
                    <div className="profile-model-info">
                      <div className="profile-model-label">{row.label}</div>
                      <div className="profile-model-name-row">
                        <div className="profile-model-name">{displayModelName(row.modelId)}</div>
                      </div>
                      {row.helperText ? (
                        <div className="profile-model-helper">{row.helperText}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="profile-model-change"
                      onClick={() => setPickerCategory(row.changeTargetType || null)}
                    >
                      {t("profile.change")}
                    </button>
                  </div>
                ))}
              </div>

              <div className="profile-mode-section">
                <div className="profile-mode-section-header">
                  <div className="profile-card-title" style={{ marginBottom: 0 }}>
                    {t("profile.mode.synthetic")}
                  </div>
                  <div className="profile-model-helper">
                    {llmSupportsBuiltInVision
                      ? t("profile.mode.syntheticDesc")
                      : t("profile.mode.syntheticRequiresVision", {
                          model: displayModelName(llmModelId),
                        })}
                  </div>
                </div>
                {syntheticModeRows.map((row) => (
                  <div key={row.key} className="profile-model-row">
                    <div className="profile-model-icon">{row.shortLabel}</div>
                    <div className="profile-model-info">
                      <div className="profile-model-label">{row.label}</div>
                      <div className="profile-model-name-row">
                        <div className="profile-model-name">{displayModelName(row.modelId)}</div>
                        {row.statusLabel ? (
                          <span className="profile-model-badge">{row.statusLabel}</span>
                        ) : null}
                      </div>
                      {row.helperText ? (
                        <div className="profile-model-helper">{row.helperText}</div>
                      ) : null}
                    </div>
                    {row.changeable ? (
                      <button
                        type="button"
                        className="profile-model-change"
                        onClick={() => setPickerCategory(row.changeTargetType || null)}
                      >
                        {t("profile.change")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {settingsOpen ? (
            <SettingsDialog
              initialState={settingsInitialState}
              saving={settingsSaving}
              errorMessage={settingsError}
              onOpenChange={setSettingsOpen}
              onSave={saveSettings}
            />
          ) : null}

          {knowledgeOpen ? (
            <KnowledgeDialog
              loading={knowledgeLoading}
              uploading={knowledgeUploading}
              errorMessage={knowledgeError}
              items={knowledgeItems}
              onOpenChange={setKnowledgeOpen}
              onUpload={handleKnowledgeUpload}
            />
          ) : null}

          <ModelPickerModal
            open={pickerCategory !== null}
            category={pickerCategory || "llm"}
            currentModelId={
              pickerCategory
                ? getPipelineModelId(
                    pipelineItems,
                    pickerCategory,
                    pickerCategory === "vision"
                      ? "qwen-vl-plus"
                      : pickerCategory === "tts"
                        ? "cosyvoice-v1"
                        : pickerCategory === "asr"
                          ? "paraformer-v2"
                          : pickerCategory === "realtime"
                            ? DEFAULT_REALTIME_MODEL_ID
                            : pickerCategory === "realtime_asr"
                              ? DEFAULT_REALTIME_ASR_MODEL_ID
                              : pickerCategory === "realtime_tts"
                                ? DEFAULT_REALTIME_TTS_MODEL_ID
                            : "qwen3.5-plus",
                  )
                : undefined
            }
            onClose={() => setPickerCategory(null)}
            onSelect={(modelId) => {
              void handleModelSelect(modelId, pickerCategory);
            }}
          />
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
