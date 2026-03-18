"use client";

import { Suspense, useEffect, useReducer } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";
import { normalizeCatalogModelDetail, type CatalogModelDetail } from "@/lib/model-catalog";
import { getSafeNavigationPath } from "@/lib/security";

type DetailState = {
  loading: boolean;
  model: CatalogModelDetail | null;
  error: string;
};

type DetailAction =
  | { type: "request" }
  | { type: "success"; model: CatalogModelDetail }
  | { type: "failure"; error: string };
const MODEL_PICKER_SELECTION_KEY = "model_picker_pending_selection";

interface PendingModelSelection {
  from: string;
  category: "llm" | "asr" | "tts" | "vision";
  modelId: string;
  displayName: string;
}

const PROVIDER_GRADIENTS: Record<string, string> = {
  alibaba: "linear-gradient(135deg, #c8734a, #e8925a)",
  qwen: "linear-gradient(135deg, #c8734a, #e8925a)",
  deepseek: "linear-gradient(135deg, #3a6a9a, #4a8ac8)",
};

function getProviderGradient(provider: string): string {
  const key = provider.toLowerCase();
  for (const [prefix, gradient] of Object.entries(PROVIDER_GRADIENTS)) {
    if (key.includes(prefix)) return gradient;
  }
  return "linear-gradient(135deg, #6b7280, #9ca3af)";
}

function formatPrice(price: number, t: (key: string) => string): string {
  if (price <= 0) return t("free");
  const formatted = price.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `¥${formatted}`;
}

function formatOptionalPrice(
  price: number | null | undefined,
  t: (key: string) => string,
): string {
  if (price == null) return t("notAvailable");
  return formatPrice(price, t);
}

function formatCapability(capability: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    text: t("capLabel.text"),
    vision: t("capLabel.vision"),
    function_calling: t("capLabel.functionCalling"),
    web_search: t("capLabel.webSearch"),
    reasoning_chain: t("capLabel.reasoning"),
    chinese: t("capLabel.chinese"),
    english: t("capLabel.english"),
    realtime: t("capLabel.realtime"),
    emotion: t("capLabel.emotion"),
    multi_voice: t("capLabel.multiVoice"),
    natural: t("capLabel.natural"),
    standard: t("capLabel.standard"),
    fast: t("capLabel.fast"),
    image: t("capLabel.image"),
    ocr: t("capLabel.ocr"),
    video: t("capLabel.video"),
    reasoning: t("capLabel.reasoning"),
    audio_input: t("capLabel.audioInput"),
    audio_output: t("capLabel.audioOutput"),
    multilingual: t("capLabel.multilingual"),
  };
  return map[capability] || capability;
}

function formatModality(modality: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    text: t("modality.text"),
    image: t("modality.image"),
    audio: t("modality.audio"),
    video: t("modality.video"),
  };
  return map[modality] || modality;
}

function formatProvider(provider: string, t: (key: string) => string): string {
  const key = provider.toLowerCase();
  if (key.includes("deepseek")) return t("providerLabel.deepseek");
  if (key.includes("qwen") || key.includes("alibaba")) return t("providerLabel.qwen");
  return provider;
}

function formatPriceUnit(unit: string, t: (key: string) => string): string {
  if (unit === "characters") return t("priceUnitCharacters");
  if (unit === "audio") return t("priceUnitAudio");
  return t("priceUnit");
}

function formatPriceNote(model: CatalogModelDetail, t: (key: string) => string): string {
  if (model.price_unit === "characters") {
    return t("priceNoteCharacters");
  }
  if (model.price_unit === "audio" && model.input_price <= 0 && model.output_price <= 0) {
    return t("priceNoteFreeTier");
  }
  return model.price_note || "";
}

function detailReducer(state: DetailState, action: DetailAction): DetailState {
  switch (action.type) {
    case "request":
      return { loading: true, model: null, error: "" };
    case "success":
      return { loading: false, model: action.model, error: "" };
    case "failure":
      return { loading: false, model: null, error: action.error };
    default:
      return state;
  }
}

function ModelDetailPageContent() {
  const router = useRouter();
  const params = useParams<{ modelId: string }>();
  const searchParams = useSearchParams();
  const modelId = Array.isArray(params.modelId) ? params.modelId[0] : params.modelId;
  const t = useTranslations("console-models-v2");

  const [{ loading, model, error }, dispatch] = useReducer(detailReducer, {
    loading: true,
    model: null,
    error: "",
  });

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    dispatch({ type: "request" });
    apiGet<Record<string, unknown>>(`/api/v1/models/catalog/${modelId}`)
      .then((data) => {
        if (!cancelled) {
          dispatch({ type: "success", model: normalizeCatalogModelDetail(data) });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          dispatch({
            type: "failure",
            error: err.message || "Failed to load model",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const pickerQuery = (() => {
    if (searchParams.get("picker") !== "1") {
      return "";
    }
    const params = new URLSearchParams();
    params.set("picker", "1");
    const from = searchParams.get("from");
    const category = searchParams.get("category");
    const currentModelId = searchParams.get("current_model_id");
    if (from) params.set("from", from);
    if (category) params.set("category", category);
    if (currentModelId) params.set("current_model_id", currentModelId);
    return params.toString();
  })();

  const backHref = pickerQuery ? `/app/models?${pickerQuery}` : "/app/models";

  const handleSelectModel = () => {
    if (!model) return;
    const from = searchParams.get("from");
    const pickerMode = searchParams.get("picker") === "1";
    const rawCategory = searchParams.get("category");
    const category = rawCategory || model.category;
    const safeFrom = getSafeNavigationPath(from);

    if (
      pickerMode &&
      safeFrom &&
      (category === "llm" ||
        category === "asr" ||
        category === "tts" ||
        category === "vision") &&
      typeof window !== "undefined"
    ) {
      const pending: PendingModelSelection = {
        from: safeFrom,
        category,
        modelId: model.model_id,
        displayName: model.display_name,
      };
      window.sessionStorage.setItem(
        MODEL_PICKER_SELECTION_KEY,
        JSON.stringify(pending),
      );
      router.push(safeFrom);
      return;
    }

    if (safeFrom) {
      router.push(safeFrom);
      return;
    }
    router.push("/app/models");
  };

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <Link href={backHref} className="model-detail-back">
            &larr; {t("backToMarketplace")}
          </Link>

          {loading ? (
            <div className="console-empty">...</div>
          ) : error ? (
            <div className="console-empty">{error}</div>
          ) : model ? (
            <>
              <div className="model-detail-header">
                <div
                  className="model-detail-icon"
                  style={{ background: getProviderGradient(model.provider) }}
                >
                  {model.provider.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="model-detail-name">{model.display_name}</div>
                  <div className="model-detail-provider">{formatProvider(model.provider, t)}</div>
                </div>
              </div>

              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {model.description || t("noDescription")}
              </p>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("capabilities")}</h2>
                <div className="model-detail-caps">
                  {model.capabilities.map((cap) => (
                    <span key={cap} className="model-detail-cap">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {formatCapability(cap, t)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("modalities")}</h2>
                <div className="model-detail-grid">
                  <div className="model-detail-stat">
                    <div className="model-detail-stat-label">{t("inputModalities")}</div>
                    <div className="model-detail-caps">
                      {model.input_modalities.map((modality) => (
                        <span key={modality} className="model-detail-cap">
                          {formatModality(modality, t)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="model-detail-stat">
                    <div className="model-detail-stat-label">{t("outputModalities")}</div>
                    <div className="model-detail-caps">
                      {model.output_modalities.map((modality) => (
                        <span key={modality} className="model-detail-cap">
                          {formatModality(modality, t)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("featureSupport")}</h2>
                <table className="model-detail-table">
                  <thead>
                    <tr>
                      <th>{t("feature")}</th>
                      <th>{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { labelKey: "featureFunctionCalling", enabled: model.supports_function_calling },
                      { labelKey: "featureWebSearch", enabled: model.supports_web_search },
                      { labelKey: "featureStructuredOutput", enabled: model.supports_structured_output },
                      { labelKey: "featureCache", enabled: model.supports_cache },
                    ].map(({ labelKey, enabled }) => (
                      <tr key={labelKey}>
                        <td>{t(labelKey)}</td>
                        <td>
                          <span className={`model-detail-support${enabled ? " is-on" : ""}`}>
                            {enabled ? t("supported") : t("unsupported")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("pricing")}</h2>
                <table className="model-detail-table">
                  <thead>
                    <tr>
                      <th>{t("inputPrice")}</th>
                      <th>{t("outputPrice")}</th>
                      <th>{t("batchInputPrice")}</th>
                      <th>{t("batchOutputPrice")}</th>
                      <th>{t("cacheReadPrice")}</th>
                      <th>{t("cacheWritePrice")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{formatOptionalPrice(model.input_price, t)}</td>
                      <td>{formatOptionalPrice(model.output_price, t)}</td>
                      <td>{formatOptionalPrice(model.batch_input_price, t)}</td>
                      <td>{formatOptionalPrice(model.batch_output_price, t)}</td>
                      <td>{formatOptionalPrice(model.cache_read_price, t)}</td>
                      <td>{formatOptionalPrice(model.cache_write_price, t)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="model-detail-note">
                  {t("pricingUnitLabel")}: {formatPriceUnit(model.price_unit, t)}
                  {formatPriceNote(model, t) ? ` · ${formatPriceNote(model, t)}` : ""}
                </div>
              </div>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("provider")}</h2>
                <table className="model-detail-table">
                  <thead>
                    <tr>
                      <th>{t("provider")}</th>
                      <th>{t("contextWindow")}</th>
                      <th>{t("maxOutput")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{formatProvider(model.provider, t)}</td>
                      <td>{model.context_window.toLocaleString()} {t("tokens")}</td>
                      <td>{model.max_output.toLocaleString()} {t("tokens")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 24 }}>
                <button
                  className="marketplace-card-btn"
                  style={{ padding: "10px 28px", fontSize: 13 }}
                  onClick={handleSelectModel}
                >
                  {t("selectModel")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

export default function ModelDetailPage() {
  return (
    <Suspense
      fallback={
        <PanelLayout>
          <PageTransition>
            <div className="p-6">
              <div className="console-empty">...</div>
            </div>
          </PageTransition>
        </PanelLayout>
      }
    >
      <ModelDetailPageContent />
    </Suspense>
  );
}
