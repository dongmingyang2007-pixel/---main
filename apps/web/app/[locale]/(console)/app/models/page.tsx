"use client";

import { useState, useEffect, useMemo } from "react";
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
  input_price_per_1k: number;
  output_price_per_1k: number;
  context_window: number;
  max_output_tokens: number;
}

const TABS = ["all", "llm", "asr", "tts", "vision"] as const;
type Tab = (typeof TABS)[number];

const PROVIDER_GRADIENTS: Record<string, string> = {
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

export default function ModelsPage() {
  const t = useTranslations("console-models-v2");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<CatalogModel[]>("/api/v1/models/catalog")
      .then((data) => {
        if (!cancelled) {
          setModels(Array.isArray(data) ? data : []);
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
                      <span>{t("inputPrice")}: {formatPrice(model.input_price_per_1k, t)}</span>
                      {" / "}
                      <span>{t("outputPrice")}: {formatPrice(model.output_price_per_1k, t)}</span>
                      {model.input_price_per_1k > 0 || model.output_price_per_1k > 0 ? (
                        <span> {t("priceUnit")}</span>
                      ) : null}
                    </div>
                    <Link href={`/app/models/${model.id}`} className="marketplace-card-btn">
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
