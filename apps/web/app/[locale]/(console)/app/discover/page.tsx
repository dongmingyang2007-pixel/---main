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

  /* Static pack data filtered by search */
  const packMatches = useMemo(() => {
    if (!q) return [true, true];
    return [
      "\u7EBF\u6027\u4EE3\u6570\u57FA\u7840 \u6570\u5B66\u8001\u738B \u5411\u91CF \u77E9\u9635 \u7279\u5F81\u503C \u884C\u5217\u5F0F".toLowerCase().includes(q),
      "\u65E5\u8BED N3 \u8BCD\u6C47 Yuki JLPT \u8BED\u6CD5".toLowerCase().includes(q),
    ];
  }, [q]);

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
            <button className="discover-section-link">
              {t("discover.viewAll")} &rarr;
            </button>
          </div>

          <div className="discover-grid">
            {/* Card 1 – Linear Algebra */}
            {(!q || packMatches[0]) && (
              <div className="pack-card">
                <span className="pack-badge hot">{t("discover.badgeHot")}</span>
                <div className="pack-header">
                  <div
                    className="pack-icon"
                    style={{ background: "rgba(124, 77, 196, 0.12)" }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#7c4dc4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="pack-name">{"\u7EBF\u6027\u4EE3\u6570\u57FA\u7840"}</div>
                    <div className="pack-author">by {"\u6570\u5B66\u8001\u738B"}</div>
                  </div>
                </div>
                <div className="pack-desc">
                  {"\u6DB5\u76D6\u5411\u91CF\u3001\u77E9\u9635\u8FD0\u7B97\u3001\u7279\u5F81\u503C\u3001\u884C\u5217\u5F0F\u7B49\u6838\u5FC3\u6982\u5FF5"}
                </div>
                <div className="pack-footer">
                  <div className="pack-stats">
                    <span className="pack-stat">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      2.3k
                    </span>
                    <span className="pack-stat">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      48 {t("discover.memories")}
                    </span>
                  </div>
                  <button className="pack-dl-btn">{t("discover.get")}</button>
                </div>
              </div>
            )}

            {/* Card 2 – Japanese N3 */}
            {(!q || packMatches[1]) && (
              <div className="pack-card">
                <span className="pack-badge new">{t("discover.badgeNew")}</span>
                <div className="pack-header">
                  <div
                    className="pack-icon"
                    style={{ background: "rgba(42, 138, 90, 0.12)" }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#2a8a5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <div>
                    <div className="pack-name">{"\u65E5\u8BED N3 \u8BCD\u6C47"}</div>
                    <div className="pack-author">by Yuki</div>
                  </div>
                </div>
                <div className="pack-desc">
                  {"JLPT N3 \u5E38\u7528\u8BCD\u6C47\u548C\u8BED\u6CD5\u70B9\uFF0C\u52A9\u624B\u80FD\u7528\u65E5\u8BED\u5BF9\u8BDD\u7EC3\u4E60"}
                </div>
                <div className="pack-footer">
                  <div className="pack-stats">
                    <span className="pack-stat">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      856
                    </span>
                    <span className="pack-stat">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      120 {t("discover.memories")}
                    </span>
                  </div>
                  <button className="pack-dl-btn">{t("discover.get")}</button>
                </div>
              </div>
            )}

            {/* Card 3 – Upload CTA */}
            <div className="upload-cta">
              <div className="upload-cta-icon">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="upload-cta-title">{t("discover.sharePack")}</div>
              <div className="upload-cta-desc">{t("discover.sharePackDesc")}</div>
            </div>
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
