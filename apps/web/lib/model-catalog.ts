const MODEL_CATEGORIES = ["llm", "asr", "tts", "vision"] as const;

export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export interface CatalogModelSummary {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  category: ModelCategory;
  description: string;
  capabilities: string[];
  input_price: number;
  output_price: number;
  context_window: number;
  max_output: number;
}

export interface CatalogModelDetail extends CatalogModelSummary {
  provider_display: string;
  input_modalities: string[];
  output_modalities: string[];
  supports_function_calling: boolean;
  supports_web_search: boolean;
  supports_structured_output: boolean;
  supports_cache: boolean;
  batch_input_price: number | null;
  batch_output_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  price_unit: string;
  price_note: string | null;
}

type LooseCatalogModel = Partial<CatalogModelDetail> & Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function inferCategory(raw: LooseCatalogModel, capabilities: string[]): ModelCategory {
  const category = asString(raw.category);
  if (MODEL_CATEGORIES.includes(category as ModelCategory)) {
    return category as ModelCategory;
  }

  const modelId = asString(raw.model_id).toLowerCase();
  const loweredCaps = capabilities.map((cap) => cap.toLowerCase());

  if (
    loweredCaps.includes("chat")
    || modelId.includes("qwen")
    || modelId.includes("deepseek")
  ) {
    return "llm";
  }
  if (
    modelId.includes("paraformer")
    || modelId.includes("sensevoice")
    || loweredCaps.includes("asr")
  ) {
    return "asr";
  }
  if (
    modelId.includes("cosyvoice")
    || modelId.includes("sambert")
    || loweredCaps.includes("tts")
  ) {
    return "tts";
  }
  if (
    modelId.includes("vision")
    || modelId.includes("ocr")
    || modelId.includes("internvl")
    || loweredCaps.includes("vision")
    || loweredCaps.includes("video")
  ) {
    return "vision";
  }

  return "llm";
}

function deriveModalities(category: ModelCategory, capabilities: string[]) {
  const loweredCaps = capabilities.map((cap) => cap.toLowerCase());

  if (category === "llm") {
    const input_modalities = ["text"];
    if (loweredCaps.includes("vision")) {
      input_modalities.push("image");
    }
    if (loweredCaps.includes("audio_input")) {
      input_modalities.push("audio");
    }
    const output_modalities = ["text"];
    if (loweredCaps.includes("audio_output")) {
      output_modalities.push("audio");
    }
    return { input_modalities, output_modalities };
  }

  if (category === "asr") {
    return { input_modalities: ["audio"], output_modalities: ["text"] };
  }

  if (category === "tts") {
    return { input_modalities: ["text"], output_modalities: ["audio"] };
  }

  const input_modalities = ["image"];
  if (loweredCaps.includes("video")) {
    input_modalities.push("video");
  }
  return { input_modalities, output_modalities: ["text"] };
}

export function normalizeCatalogModelSummary(raw: LooseCatalogModel): CatalogModelSummary {
  const capabilities = asStringArray(raw.capabilities);
  const model_id = asString(raw.model_id) || asString(raw.id) || "unknown-model";
  const category = inferCategory(raw, capabilities);

  return {
    id: asString(raw.id) || model_id,
    model_id,
    display_name: asString(raw.display_name) || model_id,
    provider: asString(raw.provider) || "mingrun",
    category,
    description: asString(raw.description),
    capabilities,
    input_price: asNumber(raw.input_price),
    output_price: asNumber(raw.output_price),
    context_window: asNumber(raw.context_window),
    max_output: asNumber(raw.max_output),
  };
}

export function normalizeCatalogModelDetail(raw: LooseCatalogModel): CatalogModelDetail {
  const summary = normalizeCatalogModelSummary(raw);
  const capabilities = summary.capabilities;
  const category = summary.category;
  const modalities = deriveModalities(category, capabilities);

  return {
    ...summary,
    provider_display: asString(raw.provider_display) || summary.provider,
    input_modalities: asStringArray(raw.input_modalities).length > 0
      ? asStringArray(raw.input_modalities)
      : modalities.input_modalities,
    output_modalities: asStringArray(raw.output_modalities).length > 0
      ? asStringArray(raw.output_modalities)
      : modalities.output_modalities,
    supports_function_calling: Boolean(raw.supports_function_calling ?? capabilities.includes("function_calling")),
    supports_web_search: Boolean(raw.supports_web_search ?? capabilities.includes("web_search")),
    supports_structured_output: Boolean(raw.supports_structured_output),
    supports_cache: Boolean(raw.supports_cache),
    batch_input_price: asOptionalNumber(raw.batch_input_price),
    batch_output_price: asOptionalNumber(raw.batch_output_price),
    cache_read_price: asOptionalNumber(raw.cache_read_price),
    cache_write_price: asOptionalNumber(raw.cache_write_price),
    price_unit: asString(raw.price_unit) || (category === "asr" ? "audio" : category === "tts" ? "characters" : "tokens"),
    price_note: asString(raw.price_note) || null,
  };
}
