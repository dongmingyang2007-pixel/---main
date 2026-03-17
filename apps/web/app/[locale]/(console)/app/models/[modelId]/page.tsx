"use client";

import { useEffect, useReducer } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiGet } from "@/lib/api";

interface CatalogModel {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  category: "llm" | "asr" | "tts" | "vision";
  description: string;
  capabilities: string[];
  input_price: number;
  output_price: number;
  context_window: number;
  max_output: number;
}

type DetailState = {
  loading: boolean;
  model: CatalogModel | null;
  error: string;
};

type DetailAction =
  | { type: "request" }
  | { type: "success"; model: CatalogModel }
  | { type: "failure"; error: string };

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
  return `¥${price.toFixed(2)}`;
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

export default function ModelDetailPage() {
  const params = useParams<{ modelId: string }>();
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
    apiGet<CatalogModel>(`/api/v1/models/catalog/${modelId}`)
      .then((data) => {
        if (!cancelled) {
          dispatch({ type: "success", model: data });
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

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <Link href="/app/models" className="model-detail-back">
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
                  <div className="model-detail-provider">{model.provider}</div>
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
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className="model-detail-section">
                <h2 className="model-detail-section-title">{t("provider")}</h2>
                <table className="model-detail-table">
                  <thead>
                    <tr>
                      <th>{t("inputPrice")}</th>
                      <th>{t("outputPrice")}</th>
                      <th>{t("contextWindow")}</th>
                      <th>Max Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{formatPrice(model.input_price, t)} {model.input_price > 0 ? t("priceUnit") : ""}</td>
                      <td>{formatPrice(model.output_price, t)} {model.output_price > 0 ? t("priceUnit") : ""}</td>
                      <td>{model.context_window.toLocaleString()} {t("tokens")}</td>
                      <td>{model.max_output.toLocaleString()} {t("tokens")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 24 }}>
                <button className="marketplace-card-btn" style={{ padding: "10px 28px", fontSize: 13 }}>
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
