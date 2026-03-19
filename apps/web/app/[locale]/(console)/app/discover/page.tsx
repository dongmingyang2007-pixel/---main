"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";
import { getProviderStyle } from "@/lib/model-utils";

/* ── Types (mirrored from ModelPickerModal) ── */

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

/* ── Capability tag mapping ── */

function buildTags(
  model: CatalogModel,
  t: (key: string) => string,
): { text: string; highlight: boolean }[] {
  const tags: { text: string; highlight: boolean }[] = [];
  const catMap: Record<string, string> = {
    llm: "discover.category.llm",
    asr: "discover.category.asr",
    tts: "discover.category.tts",
    vision: "discover.category.vision",
  };
  if (catMap[model.category]) {
    tags.push({ text: t(catMap[model.category]), highlight: true });
  }
  if (model.capabilities?.includes("function_calling")) {
    tags.push({ text: "\u5DE5\u5177\u8C03\u7528", highlight: false });
  }
  if (model.capabilities?.includes("thinking")) {
    tags.push({ text: "\u6DF1\u5EA6\u601D\u8003", highlight: false });
  }
  return tags;
}

/* ── Tab type ── */

type Tab = "all" | "packs" | "models";

/* ── Component ── */

export default function DiscoverPage() {
  const t = useTranslations("console");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  /* Fetch models from catalog */
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    apiGet<CatalogModel[]>("/api/v1/models/catalog")
      .then((data) => {
        if (!cancelled) setModels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => { cancelled = true; };
  }, []);

  /* Search filter */
  const q = search.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!q) return models;
    return models.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  }, [models, q]);

  const showPacks = tab === "all" || tab === "packs";
  const showModels = tab === "all" || tab === "models";


  return (
    <div className="discover-page">
      {/* ── Top bar ── */}
      <div className="discover-topbar">
        <h1 className="discover-topbar-title">{t("discover.title")}</h1>
        <input
          className="discover-search"
          type="text"
          placeholder={t("discover.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── Category tabs ── */}
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
            className={`discover-tab${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Memory packs section ── */}
      {showPacks && (
        <section>
          <div className="discover-section-header">
            <h2 className="discover-section-title">{t("discover.hotPacks")}</h2>
          </div>
          <div className="discover-empty-state">
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.4, marginBottom: 12}}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            <p>{t("discover.noPacksYet")}</p>
          </div>
        </section>
      )}

      {/* ── Models section ── */}
      {showModels && (
        <section>
          <div className="discover-section-header">
            <h2 className="discover-section-title">{t("discover.models")}</h2>
            <button className="discover-section-link">
              {t("discover.viewAll")} &rarr;
            </button>
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
          ) : (
            <div className="discover-grid">
              {filteredModels.map((model) => {
                const prov = getProviderStyle(model.provider);
                const tags = buildTags(model, t);
                return (
                  <Link
                    key={model.model_id}
                    href={`/app/discover/models/${model.model_id}`}
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
                        <div className="model-card-provider">{model.provider}</div>
                      </div>
                    </div>

                    <div className="model-card-tags">
                      {tags.map((tag) => (
                        <span
                          key={tag.text}
                          className={`model-card-tag${tag.highlight ? " highlight" : ""}`}
                        >
                          {tag.text}
                        </span>
                      ))}
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
