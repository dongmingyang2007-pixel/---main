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
  status?: string | null;
  triage_action?: string | null;
  triage_reason?: string | null;
  target_memory_id?: string | null;
}

export interface RetrievalTraceMemory {
  id: string;
  type?: string;
  category?: string;
  memory_kind?: string | null;
  source?: string | null;
  score?: number | null;
  semantic_score?: number | null;
  pinned?: boolean;
  salience?: number | null;
  content: string;
}

export interface RetrievalTraceChunk {
  id?: string | null;
  data_item_id?: string | null;
  filename?: string | null;
  score?: number | null;
  chunk_text: string;
}

export type RetrievalContextLevel =
  | "none"
  | "profile_only"
  | "memory_only"
  | "full_rag";

export interface RetrievalTrace {
  strategy?: string | null;
  context_level?: RetrievalContextLevel | null;
  decision_source?: string | null;
  decision_reason?: string | null;
  decision_confidence?: number | null;
  memory_counts?: {
    static?: number;
    relevant?: number;
    graph?: number;
    temporary?: number;
  };
  memories: RetrievalTraceMemory[];
  knowledge_chunks: RetrievalTraceChunk[];
  linked_file_chunks: RetrievalTraceChunk[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string | null;
  sources?: SearchSource[];
  retrievalTrace?: RetrievalTrace | null;
  audioBase64?: string | null;
  memories_extracted?: string;
  extracted_facts?: ExtractedFact[];
  memory_extraction_status?: string | null;
  memory_extraction_attempts?: number | null;
  memory_extraction_error?: string | null;
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
    retrieval_trace?: unknown;
    [key: string]: unknown;
  };
  created_at?: string;
}

function normalizeExtractedFacts(value: unknown): ExtractedFact[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const facts = value
    .filter((f: unknown): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      fact: String(f.fact ?? ""),
      category: String(f.category ?? ""),
      importance: typeof f.importance === "number" ? f.importance : 0,
      status:
        typeof f.status === "string" && f.status.trim()
          ? f.status.trim()
          : null,
      triage_action:
        typeof f.triage_action === "string" && f.triage_action.trim()
          ? f.triage_action.trim()
          : null,
      triage_reason:
        typeof f.triage_reason === "string" && f.triage_reason.trim()
          ? f.triage_reason.trim()
          : null,
      target_memory_id:
        typeof f.target_memory_id === "string" && f.target_memory_id.trim()
          ? f.target_memory_id.trim()
          : null,
    }))
    .filter((fact) => fact.fact.trim().length > 0);

  return facts.length ? facts : undefined;
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

function normalizeContextLevel(value: unknown): RetrievalContextLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  if (
    value === "none" ||
    value === "profile_only" ||
    value === "memory_only" ||
    value === "full_rag"
  ) {
    return value;
  }
  return null;
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

function normalizeTraceMemory(value: unknown): RetrievalTraceMemory | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
  if (!id || !content) {
    return null;
  }
  return {
    id,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
    category: typeof candidate.category === "string" ? candidate.category : undefined,
    memory_kind:
      typeof candidate.memory_kind === "string" ? candidate.memory_kind : null,
    source: typeof candidate.source === "string" ? candidate.source : null,
    score:
      typeof candidate.score === "number" && Number.isFinite(candidate.score)
        ? candidate.score
        : null,
    semantic_score:
      typeof candidate.semantic_score === "number" &&
      Number.isFinite(candidate.semantic_score)
        ? candidate.semantic_score
        : null,
    pinned: candidate.pinned === true,
    salience:
      typeof candidate.salience === "number" && Number.isFinite(candidate.salience)
        ? candidate.salience
        : null,
    content,
  };
}

function normalizeTraceChunk(value: unknown): RetrievalTraceChunk | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const chunkText =
    typeof candidate.chunk_text === "string" ? candidate.chunk_text.trim() : "";
  if (!chunkText) {
    return null;
  }
  return {
    id: typeof candidate.id === "string" ? candidate.id : null,
    data_item_id:
      typeof candidate.data_item_id === "string" ? candidate.data_item_id : null,
    filename: typeof candidate.filename === "string" ? candidate.filename : null,
    score:
      typeof candidate.score === "number" && Number.isFinite(candidate.score)
        ? candidate.score
        : null,
    chunk_text: chunkText,
  };
}

export function normalizeRetrievalTrace(value: unknown): RetrievalTrace | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const contextLevel = normalizeContextLevel(candidate.context_level);
  const memories = Array.isArray(candidate.memories)
    ? candidate.memories
        .map((item) => normalizeTraceMemory(item))
        .filter((item): item is RetrievalTraceMemory => item !== null)
    : [];
  const knowledgeChunks = Array.isArray(candidate.knowledge_chunks)
    ? candidate.knowledge_chunks
        .map((item) => normalizeTraceChunk(item))
        .filter((item): item is RetrievalTraceChunk => item !== null)
    : [];
  const linkedFileChunks = Array.isArray(candidate.linked_file_chunks)
    ? candidate.linked_file_chunks
        .map((item) => normalizeTraceChunk(item))
        .filter((item): item is RetrievalTraceChunk => item !== null)
    : [];
  const memoryCounts =
    candidate.memory_counts && typeof candidate.memory_counts === "object"
      ? {
          static:
            typeof (candidate.memory_counts as Record<string, unknown>).static === "number"
              ? ((candidate.memory_counts as Record<string, unknown>).static as number)
              : undefined,
          relevant:
            typeof (candidate.memory_counts as Record<string, unknown>).relevant === "number"
              ? ((candidate.memory_counts as Record<string, unknown>).relevant as number)
              : undefined,
          graph:
            typeof (candidate.memory_counts as Record<string, unknown>).graph === "number"
              ? ((candidate.memory_counts as Record<string, unknown>).graph as number)
              : undefined,
          temporary:
            typeof (candidate.memory_counts as Record<string, unknown>).temporary === "number"
              ? ((candidate.memory_counts as Record<string, unknown>).temporary as number)
              : undefined,
        }
      : undefined;

  if (!memories.length && !knowledgeChunks.length && !linkedFileChunks.length && !contextLevel) {
    return null;
  }

  return {
    strategy:
      typeof candidate.strategy === "string" ? candidate.strategy : null,
    context_level: contextLevel,
    decision_source:
      typeof candidate.decision_source === "string" ? candidate.decision_source : null,
    decision_reason:
      typeof candidate.decision_reason === "string" ? candidate.decision_reason : null,
    decision_confidence:
      typeof candidate.decision_confidence === "number" &&
      Number.isFinite(candidate.decision_confidence)
        ? candidate.decision_confidence
        : null,
    memory_counts: memoryCounts,
    memories,
    knowledge_chunks: knowledgeChunks,
    linked_file_chunks: linkedFileChunks,
  };
}

export function toMessage(message: ApiMessage): Message {
  const meta = message.metadata_json;
  const extractedFacts = normalizeExtractedFacts(meta?.extracted_facts);
  const memoriesExtracted =
    typeof meta?.memories_extracted === "string" && meta.memories_extracted.trim()
      ? meta.memories_extracted
      : undefined;
  const memoryExtractionStatus =
    typeof meta?.memory_extraction_status === "string" && meta.memory_extraction_status.trim()
      ? meta.memory_extraction_status.trim()
      : null;
  const memoryExtractionAttempts =
    typeof meta?.memory_extraction_attempts === "number" &&
    Number.isFinite(meta.memory_extraction_attempts)
      ? meta.memory_extraction_attempts
      : null;
  const memoryExtractionError =
    typeof meta?.memory_extraction_error === "string" && meta.memory_extraction_error.trim()
      ? meta.memory_extraction_error.trim()
      : null;

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoning_content,
    sources: normalizeSearchSources(meta?.sources),
    retrievalTrace: normalizeRetrievalTrace(meta?.retrieval_trace),
    memories_extracted: memoriesExtracted,
    extracted_facts: extractedFacts,
    memory_extraction_status: memoryExtractionStatus,
    memory_extraction_attempts: memoryExtractionAttempts,
    memory_extraction_error: memoryExtractionError,
    animateOnMount: false,
    isStreaming: false,
  };
}

export function mergeAssistantMetadataPatch(
  message: Message,
  metadata: unknown,
): Message {
  if (!metadata || typeof metadata !== "object") {
    return message;
  }

  const candidate = metadata as Record<string, unknown>;
  const extractedFacts = normalizeExtractedFacts(candidate.extracted_facts);
  const sources = normalizeSearchSources(candidate.sources);
  const retrievalTrace = normalizeRetrievalTrace(candidate.retrieval_trace);
  const memoriesExtracted =
    typeof candidate.memories_extracted === "string" && candidate.memories_extracted.trim()
      ? candidate.memories_extracted
      : undefined;
  const memoryExtractionStatus =
    typeof candidate.memory_extraction_status === "string" && candidate.memory_extraction_status.trim()
      ? candidate.memory_extraction_status.trim()
      : null;
  const memoryExtractionAttempts =
    typeof candidate.memory_extraction_attempts === "number" &&
    Number.isFinite(candidate.memory_extraction_attempts)
      ? candidate.memory_extraction_attempts
      : null;
  const memoryExtractionError =
    typeof candidate.memory_extraction_error === "string" && candidate.memory_extraction_error.trim()
      ? candidate.memory_extraction_error.trim()
      : null;

  return {
    ...message,
    sources: sources.length ? sources : message.sources,
    retrievalTrace: retrievalTrace ?? message.retrievalTrace,
    extracted_facts: extractedFacts ?? message.extracted_facts,
    memories_extracted: memoriesExtracted ?? message.memories_extracted,
    memory_extraction_status: memoryExtractionStatus ?? message.memory_extraction_status,
    memory_extraction_attempts: memoryExtractionAttempts ?? message.memory_extraction_attempts,
    memory_extraction_error: memoryExtractionError ?? message.memory_extraction_error,
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
