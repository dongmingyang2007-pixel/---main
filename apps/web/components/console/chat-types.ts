export type ChatMode = "standard" | "omni_realtime" | "synthetic_realtime";

export interface SearchSource {
  index: number;
  title: string;
  url: string;
  domain: string;
  site_name?: string | null;
  summary?: string | null;
  icon?: string | null;
}

export interface ExtractedFact {
  fact: string;
  category: string;
  importance: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string | null;
  sources?: SearchSource[];
  audioBase64?: string | null;
  memories_extracted?: string;
  extracted_facts?: ExtractedFact[];
  animateOnMount?: boolean;
  isStreaming?: boolean;
}

export interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning_content?: string | null;
  metadata_json?: {
    sources?: unknown;
    [key: string]: unknown;
  };
  created_at?: string;
}

export interface DictationResponse {
  text_input: string;
}

export interface SpeechResponse {
  audio_response: string | null;
}

export interface ImageMessageResponse {
  message: ApiMessage;
  text_input: string;
  audio_response: string | null;
}

export interface ProjectChatSettings {
  id: string;
  default_chat_mode: ChatMode;
}

export interface PipelineConfigItem {
  model_type:
    | "llm"
    | "asr"
    | "tts"
    | "vision"
    | "realtime"
    | "realtime_asr"
    | "realtime_tts";
  model_id: string;
}

export interface PipelineResponse {
  items: PipelineConfigItem[];
}

export interface CatalogModelItem {
  model_id: string;
  capabilities: string[];
}

export interface LiveTranscriptUpdate {
  role: "user" | "assistant";
  text: string;
  final: boolean;
  action?: "upsert" | "discard";
}

export const VOICE_ACTIVE_STATES = new Set([
  "connecting",
  "ready",
  "listening",
  "ai_speaking",
  "reconnecting",
]);

function isCjkCharacter(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value);
}

function isWordLikeCharacter(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}

function startsWithPunctuation(value: string): boolean {
  return /^[\s.,!?;:)\]}，。！？；：、】【》」』、]/.test(value);
}

function endsWithOpeningPunctuation(value: string): boolean {
  return /[\s([{'"“‘（【《「『-]$/.test(value);
}

export function appendNaturalText(base: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) {
    return base.trimEnd();
  }

  const trimmedBase = base.trimEnd();
  if (!trimmedBase) {
    return trimmedAddition;
  }

  const lastChar = trimmedBase.slice(-1);
  const firstChar = trimmedAddition[0] ?? "";
  const shouldInsertSpace =
    isWordLikeCharacter(lastChar) &&
    isWordLikeCharacter(firstChar) &&
    !isCjkCharacter(lastChar) &&
    !isCjkCharacter(firstChar) &&
    !endsWithOpeningPunctuation(trimmedBase) &&
    !startsWithPunctuation(trimmedAddition);

  return shouldInsertSpace
    ? `${trimmedBase} ${trimmedAddition}`
    : `${trimmedBase}${trimmedAddition}`;
}

export function joinNaturalText(segments: string[]): string {
  return segments.reduce((acc, segment) => appendNaturalText(acc, segment), "");
}

export function createAudioPlayer(base64Audio: string) {
  const audioBytes = Uint8Array.from(atob(base64Audio), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([audioBytes], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  return {
    audio: new Audio(url),
    url,
  };
}

export function getPipelineModelId(
  items: PipelineConfigItem[],
  modelType: PipelineConfigItem["model_type"],
  fallback: string,
) {
  return items.find((item) => item.model_type === modelType)?.model_id || fallback;
}

export function modelSupportsCapability(
  catalogItems: CatalogModelItem[],
  modelId: string,
  ...required: string[]
) {
  const entry = catalogItems.find((item) => item.model_id === modelId);
  if (!entry) {
    return false;
  }
  const capabilities = new Set((entry.capabilities || []).map((value) => value.toLowerCase()));
  return required.every((value) => capabilities.has(value.toLowerCase()));
}

export function normalizeSearchSources(value: unknown): SearchSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    if (!title || !url) {
      return [];
    }
    const index =
      typeof candidate.index === "number" && Number.isFinite(candidate.index)
        ? candidate.index
        : 0;
    const domain =
      typeof candidate.domain === "string" && candidate.domain.trim()
        ? candidate.domain.trim()
        : (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return "";
            }
          })();

    return [
      {
        index,
        title,
        url,
        domain,
        site_name:
          typeof candidate.site_name === "string" && candidate.site_name.trim()
            ? candidate.site_name.trim()
            : null,
        summary:
          typeof candidate.summary === "string" && candidate.summary.trim()
            ? candidate.summary.trim()
            : null,
        icon:
          typeof candidate.icon === "string" && candidate.icon.trim()
            ? candidate.icon.trim()
            : null,
      },
    ];
  });
}

export function toMessage(message: ApiMessage): Message {
  const meta = message.metadata_json;
  const rawFacts = meta?.extracted_facts;
  const extractedFacts: ExtractedFact[] | undefined =
    Array.isArray(rawFacts)
      ? rawFacts
          .filter((f: unknown): f is Record<string, unknown> => typeof f === "object" && f !== null)
          .map((f) => ({
            fact: String(f.fact ?? ""),
            category: String(f.category ?? ""),
            importance: typeof f.importance === "number" ? f.importance : 0,
          }))
      : undefined;

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoning_content,
    sources: normalizeSearchSources(meta?.sources),
    extracted_facts: extractedFacts,
    animateOnMount: false,
    isStreaming: false,
  };
}

export function getApiErrorMessage(
  error: { code?: string; message?: string },
  t: (key: string) => string,
): string {
  if (error.code === "inference_timeout") {
    return t("errors.inferenceTimeout");
  }
  if (error.code === "model_api_unconfigured") {
    return t("errors.modelUnconfigured");
  }
  if (error.code === "model_api_unavailable") {
    return t("errors.modelUnavailable");
  }
  return t("errors.generic");
}

export function cycleState(current: "auto" | "on" | "off"): "auto" | "on" | "off" {
  if (current === "auto") return "on";
  if (current === "on") return "off";
  return "auto";
}
