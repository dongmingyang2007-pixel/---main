export type ChatMode = "standard" | "omni_realtime" | "synthetic_realtime";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string | null;
  audioBase64?: string | null;
  memories_extracted?: string;
  animateOnMount?: boolean;
  isStreaming?: boolean;
}

export interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning_content?: string | null;
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

export function toMessage(message: ApiMessage): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoning_content,
    animateOnMount: false,
    isStreaming: false,
  };
}

export function cycleState(current: "auto" | "on" | "off"): "auto" | "on" | "off" {
  if (current === "auto") return "on";
  if (current === "on") return "off";
  return "auto";
}
