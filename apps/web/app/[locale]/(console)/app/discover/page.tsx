"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { apiGet, isApiRequestError } from "@/lib/api";
import { getProviderStyle } from "@/lib/model-utils";
import {
  categoryLabel,
  groupLabel,
  capabilityLabel,
  providerDisplayLabel,
} from "@/lib/discover-labels";

interface DiscoverTaxonomyItem {
  key: string;
  label: string;
  group_key?: string | null;
  group_label?: string | null;
  group?: string | null;
  order: number;
  count: number;
}

interface DiscoverModel {
  canonical_model_id: string;
  model_id?: string;
  display_name: string;
  provider: string;
  provider_display: string;
  official_group_key?: string | null;
  official_group?: string | null;
  official_category_key?: string | null;
  official_category?: string | null;
  official_order?: number | null;
  description: string;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_tools: string[];
  supported_features: string[];
  official_url?: string | null;
  aliases: string[];
  pipeline_slot?: "llm" | "asr" | "tts" | "vision" | "realtime" | "realtime_asr" | "realtime_tts" | null;
  is_selectable_in_console?: boolean | null;
}

interface DiscoverResponse {
  taxonomy: DiscoverTaxonomyItem[];
  items: DiscoverModel[];
}

type Tab = "all" | "packs" | "models";

function normalizeDiscoverPayload(raw: unknown): DiscoverResponse {
  if (Array.isArray(raw)) {
    const items = raw.filter((item): item is DiscoverModel => typeof item === "object" && item !== null);
    const taxonomyMap = new Map<string, DiscoverTaxonomyItem>();
    items.forEach((item) => {
      const key = item.official_category_key || item.official_category || "unknown";
      const current = taxonomyMap.get(key);
      if (current) {
        current.count += 1;
        return;
      }
      taxonomyMap.set(key, {
        key,
        label: item.official_category || key,
        group_key: item.official_group_key || null,
        group_label: item.official_group || null,
        group: item.official_group || null,
        order: item.official_order || 0,
        count: 1,
      });
    });
    return {
      taxonomy: Array.from(taxonomyMap.values()).sort((a, b) => a.order - b.order),
      items,
    };
  }

  if (typeof raw !== "object" || raw === null) {
    return { taxonomy: [], items: [] };
  }

  const response = raw as Partial<DiscoverResponse>;
  return {
    taxonomy: Array.isArray(response.taxonomy) ? response.taxonomy : [],
    items: Array.isArray(response.items) ? response.items : [],
  };
}

function DiscoverPageContent() {
  const t = useTranslations("console");
  const locale = useLocale();
  const searchParams = useSearchParams();

  const pickerMode = searchParams.get("picker") === "1";
  const pickerCategory = searchParams.get("category");
  const currentModelId = searchParams.get("current_model_id");
  const from = searchParams.get("from");

  const [tab, setTab] = useState<Tab>(pickerMode ? "models" : "all");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [payload, setPayload] = useState<DiscoverResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadingModels = payload === null && errorMessage === null;
  const effectiveTab: Tab = pickerMode ? "models" : tab;

  useEffect(() => {
    let cancelled = false;
    apiGet<DiscoverResponse | DiscoverModel[]>("/api/v1/models/catalog?view=discover")
      .then((data) => {
        if (!cancelled) {
          setPayload(normalizeDiscoverPayload(data));
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPayload({ taxonomy: [], items: [] });
          setErrorMessage(
            isApiRequestError(error) ? error.message : t("discover.loadFailed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const taxonomy = useMemo(
    () => (payload?.taxonomy ?? []).filter((item) => item.count > 0),
    [payload],
  );

  const q = search.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    let items = payload?.items ?? [];
    if (pickerMode && pickerCategory) {
      items = items.filter(
        (item) =>
          item.pipeline_slot === pickerCategory && item.is_selectable_in_console !== false,
      );
    }
    return items.filter((item) => {
      const categoryKey = item.official_category_key || item.official_category || "unknown";
      if (activeCategory !== "all" && categoryKey !== activeCategory) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = [
        item.display_name,
        providerDisplayLabel(item.provider, item.provider_display, locale, t),
        item.description,
        item.official_category || "",
        categoryLabel(item.official_category_key, item.official_category, locale, t),
        item.official_group || "",
        groupLabel(item.official_group_key, item.official_group, locale, t),
        ...(item.aliases ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeCategory, locale, payload, pickerCategory, pickerMode, q, t]);

  const showPacks = !pickerMode && (effectiveTab === "all" || effectiveTab === "packs");
  const showModels = effectiveTab === "all" || effectiveTab === "models" || pickerMode;

  return (
    <div className="discover-page">
      <div className="discover-topbar">
        <h1 className="discover-topbar-title">
          {pickerMode ? t("discover.modelsOfficial") : t("discover.title")}
        </h1>
        <input
          className="discover-search"
          type="text"
          placeholder={t("discover.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!pickerMode ? (
        <div className="discover-tabs">
          {(
            [
              ["all", t("discover.tabAll")],
              ["packs", t("discover.tabPacks")],
              ["models", t("discover.tabModels")],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`discover-tab${effectiveTab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {showPacks && (
        <section>
          <div className="discover-section-header">
            <h2 className="discover-section-title">{t("discover.hotPacks")}</h2>
          </div>
          <div className="discover-empty-state">
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            <p>{t("discover.noPacksYet")}</p>
          </div>
        </section>
      )}

      {showModels && (
        <section>
          <div className="discover-section-header">
            <h2 className="discover-section-title">{t("discover.modelsOfficial")}</h2>
          </div>

          <div className="discover-category-row">
            <button
              className={`discover-category-chip${activeCategory === "all" ? " active" : ""}`}
              onClick={() => setActiveCategory("all")}
            >
              {t("discover.tabAll")}
            </button>
            {taxonomy.map((item) => (
              <button
                key={item.key}
                className={`discover-category-chip${activeCategory === item.key ? " active" : ""}`}
                onClick={() => setActiveCategory(item.key)}
              >
                {categoryLabel(item.key, item.label, locale, t)}
              </button>
            ))}
          </div>

          {loadingModels ? (
            <div className="discover-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="model-card" style={{ minHeight: 160, opacity: 0.4 }}>
                  <div style={{ width: "60%", height: 14, borderRadius: 6, background: "var(--border)", marginBottom: 12 }} />
                  <div style={{ width: "80%", height: 10, borderRadius: 6, background: "var(--border)", marginBottom: 8 }} />
                  <div style={{ width: "50%", height: 10, borderRadius: 6, background: "var(--border)" }} />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <div className="discover-empty-state">
              <p>{t("discover.loadFailed")}</p>
              <p style={{ color: "var(--text-secondary)" }}>{errorMessage}</p>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="discover-empty-state">
              <p>{t("discover.noModelsFound")}</p>
            </div>
          ) : (
            <div className="discover-grid">
              {filteredModels.map((model) => {
                const prov = getProviderStyle(model.provider);
                const secondaryTag = [...(model.supported_tools ?? []), ...(model.supported_features ?? [])][0];
                const detailParams = new URLSearchParams();
                if (pickerMode) {
                  detailParams.set("picker", "1");
                }
                if (pickerCategory) {
                  detailParams.set("category", pickerCategory);
                }
                if (currentModelId) {
                  detailParams.set("current_model_id", currentModelId);
                }
                if (from) {
                  detailParams.set("from", from);
                }
                const detailHref = `/app/discover/models/${encodeURIComponent(model.canonical_model_id)}${detailParams.size ? `?${detailParams.toString()}` : ""}`;

                return (
                  <Link
                    key={model.canonical_model_id}
                    href={detailHref}
                    className="model-card"
                  >
                    <div className="model-card-header">
                      <div
                        className="model-card-logo"
                        style={{ background: prov.bg, color: "white" }}
                      >
                        {prov.label}
                      </div>
                      <div>
                        <div className="model-card-name">{model.display_name}</div>
                        <div className="model-card-provider">
                          {providerDisplayLabel(model.provider, model.provider_display, locale, t)}
                        </div>
                      </div>
                    </div>

                    <div className="model-card-tags">
                      <span className="model-card-tag highlight">
                        {categoryLabel(model.official_category_key, model.official_category, locale, t)}
                      </span>
                      {secondaryTag ? (
                        <span className="model-card-tag">
                          {capabilityLabel(secondaryTag, t)}
                        </span>
                      ) : null}
                    </div>

                    <div className="model-card-desc">
                      {model.description || model.display_name}
                    </div>

                    <span className="model-card-btn">{t("discover.viewDetail")}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div className="discover-page" />}>
      <DiscoverPageContent />
    </Suspense>
  );
}
