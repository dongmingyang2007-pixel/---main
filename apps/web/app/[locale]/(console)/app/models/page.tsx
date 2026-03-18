"use client";

import { Suspense, useEffect, useMemo, useReducer, useState } from "react";
import { useSearchParams } from "next/navigation";
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

const TABS = ["all", "llm", "asr", "tts", "vision"] as const;
type Tab = (typeof TABS)[number];

type ModelState = {
  loading: boolean;
  models: CatalogModel[];
};

type ModelAction =
  | { type: "request" }
  | { type: "success"; models: CatalogModel[] }
  | { type: "failure" };

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

function modelsReducer(state: ModelState, action: ModelAction): ModelState {
  switch (action.type) {
    case "request":
      return { ...state, loading: true };
    case "success":
      return { loading: false, models: action.models };
    case "failure":
      return { loading: false, models: [] };
    default:
      return state;
  }
}

function ModelsPageContent() {
  const t = useTranslations("console-models-v2");
  const searchParams = useSearchParams();
  const initialTabFromQuery = (() => {
    const category = searchParams.get("category");
    if (category && TABS.includes(category as Tab)) {
      return category as Tab;
    }
    return "all" as Tab;
  })();
  const [{ loading, models }, dispatch] = useReducer(modelsReducer, {
    loading: true,
    models: [],
  });
  const [activeTab, setActiveTab] = useState<Tab>(initialTabFromQuery);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "request" });
    apiGet<CatalogModel[]>("/api/v1/models/catalog")
      .then((data) => {
        if (!cancelled) {
          dispatch({
            type: "success",
            models: Array.isArray(data) ? data : [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "failure" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let list = models;
    if (activeTab !== "all") {
      list = list.filter((m) => m.category === activeTab);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.display_name.toLowerCase().includes(q));
    }
    return list;
  }, [models, activeTab, search]);

  const pickerQuery = useMemo(() => {
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
  }, [searchParams]);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <div className="marketplace-header">
            <div>
              <h1 className="console-page-title">{t("title")}</h1>
              <p className="console-page-desc">{t("description")}</p>
            </div>
            <input
              type="text"
              className="marketplace-search"
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="marketplace-tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                className={`marketplace-tab${activeTab === tab ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {t(tab)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="console-empty">...</div>
          ) : filtered.length === 0 ? (
            <div className="console-empty">{t("noModels")}</div>
          ) : (
            <div className="marketplace-grid">
              {filtered.map((model) => (
                <div key={model.id} className="marketplace-card">
                  <div className="marketplace-card-head">
                    <div
                      className="marketplace-card-icon"
                      style={{ background: getProviderGradient(model.provider) }}
                    >
                      {model.provider.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="marketplace-card-name">{model.display_name}</div>
                      <div className="marketplace-card-provider">{model.provider}</div>
                    </div>
                  </div>

                  <div className="marketplace-card-desc">
                    {model.description || t("noDescription")}
                  </div>

                  <div className="marketplace-card-tags">
                    {model.capabilities.map((cap) => (
                      <span key={cap} className="marketplace-card-tag">{cap}</span>
                    ))}
                  </div>

                  <div className="marketplace-card-footer">
                    <div className="marketplace-card-price">
                      <span>{t("inputPrice")}: {formatPrice(model.input_price, t)}</span>
                      {" / "}
                      <span>{t("outputPrice")}: {formatPrice(model.output_price, t)}</span>
                      {model.input_price > 0 || model.output_price > 0 ? (
                        <span> {t("priceUnit")}</span>
                      ) : null}
                    </div>
                    <Link
                      href={
                        pickerQuery
                          ? `/app/models/${model.model_id}?${pickerQuery}`
                          : `/app/models/${model.model_id}`
                      }
                      className="marketplace-card-btn"
                    >
                      {t("detail")}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

export default function ModelsPage() {
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
      <ModelsPageContent />
    </Suspense>
  );
}
