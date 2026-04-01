"use client";

import {
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { apiGet, isApiRequestError } from "@/lib/api";
import { getProviderStyle } from "@/lib/model-utils";
import {
  categoryLabel,
  groupLabel,
  labelForToken,
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
  pipeline_slot?:
    | "llm"
    | "asr"
    | "tts"
    | "vision"
    | "realtime"
    | "realtime_asr"
    | "realtime_tts"
    | null;
  is_selectable_in_console?: boolean | null;
}

interface DiscoverResponse {
  taxonomy: DiscoverTaxonomyItem[];
  items: DiscoverModel[];
}

type Tab = "all" | "packs" | "models";
type AvailabilityFilter = "all" | "selectable";

const TAXONOMY_QUERY_KEY = "taxonomy";
const SEARCH_QUERY_KEY = "q";
const TAB_QUERY_KEY = "tab";
const AVAILABILITY_QUERY_KEY = "availability";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20 16.65 16.65" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function categoryKeyForModel(item: DiscoverModel): string {
  return item.official_category_key || item.official_category || "unknown";
}

function normalizeTab(value: string | null, pickerMode: boolean): Tab {
  if (pickerMode) {
    return "models";
  }
  if (value === "packs" || value === "models") {
    return value;
  }
  return "all";
}

function normalizeAvailabilityFilter(value: string | null): AvailabilityFilter {
  return value === "selectable" ? "selectable" : "all";
}

function normalizeDiscoverPayload(raw: unknown): DiscoverResponse {
  if (Array.isArray(raw)) {
    const items = raw.filter((item): item is DiscoverModel => typeof item === "object" && item !== null);
    const taxonomyMap = new Map<string, DiscoverTaxonomyItem>();
    items.forEach((item) => {
      const key = categoryKeyForModel(item);
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

function dedupeTokens(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function formatPipelineSlot(
  value: string | null | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  if (!value) {
    return null;
  }
  const slotLabelMap: Record<string, string> = {
    llm: "dashboard.slot.llm",
    asr: "dashboard.slot.asr",
    tts: "dashboard.slot.tts",
    vision: "dashboard.slot.vision",
    realtime: "dashboard.slot.realtime",
    realtime_asr: "dashboard.slot.realtimeAsr",
    realtime_tts: "dashboard.slot.realtimeTts",
  };
  if (slotLabelMap[value]) {
    return t(slotLabelMap[value]);
  }
  return value
    .split("_")
    .map((part) => {
      if (part === "llm" || part === "asr" || part === "tts") {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function DiscoverPageContent() {
  const t = useTranslations("console");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const pickerMode = searchParams.get("picker") === "1";
  const pickerCategory = searchParams.get("category");
  const currentModelId = searchParams.get("current_model_id");
  const from = searchParams.get("from");
  const queryTab = normalizeTab(searchParams.get(TAB_QUERY_KEY), pickerMode);
  const querySearch = searchParams.get(SEARCH_QUERY_KEY) || "";
  const requestedTaxonomy = searchParams.get(TAXONOMY_QUERY_KEY) || "all";
  const availabilityFilter = normalizeAvailabilityFilter(searchParams.get(AVAILABILITY_QUERY_KEY));
  const [payload, setPayload] = useState<DiscoverResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(querySearch);
  const loadingModels = payload === null && errorMessage === null;
  const effectiveTab: Tab = pickerMode ? "models" : queryTab;

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
          setErrorMessage(isApiRequestError(error) ? error.message : t("discover.loadFailed"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const baseItems = useMemo(() => {
    let items = [...(payload?.items ?? [])];
    if (pickerMode && pickerCategory) {
      items = items.filter(
        (item) => item.pipeline_slot === pickerCategory && item.is_selectable_in_console !== false,
      );
    }
    if (!pickerMode && availabilityFilter === "selectable") {
      items = items.filter((item) => item.is_selectable_in_console !== false);
    }
    return items;
  }, [availabilityFilter, payload, pickerCategory, pickerMode]);

  const taxonomy = useMemo(() => {
    const counts = new Map<string, number>();
    baseItems.forEach((item) => {
      const key = categoryKeyForModel(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return (payload?.taxonomy ?? [])
      .map((item) => ({
        ...item,
        count: counts.get(item.key) || 0,
      }))
      .filter((item) => item.count > 0);
  }, [baseItems, payload]);

  const activeCategory = taxonomy.some((item) => item.key === requestedTaxonomy)
    ? requestedTaxonomy
    : "all";

  function replaceDiscoverQuery({
    tab = queryTab,
    taxonomy: nextTaxonomy = requestedTaxonomy,
    q = querySearch,
    availability = availabilityFilter,
  }: {
    tab?: Tab | null;
    taxonomy?: string | null;
    q?: string | null;
    availability?: AvailabilityFilter | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());

    if (pickerMode) {
      params.delete(TAB_QUERY_KEY);
      params.delete(AVAILABILITY_QUERY_KEY);
    } else {
      if (tab && tab !== "all") {
        params.set(TAB_QUERY_KEY, tab);
      } else {
        params.delete(TAB_QUERY_KEY);
      }
      if (availability === "selectable") {
        params.set(AVAILABILITY_QUERY_KEY, "selectable");
      } else {
        params.delete(AVAILABILITY_QUERY_KEY);
      }
    }

    if (nextTaxonomy && nextTaxonomy !== "all") {
      params.set(TAXONOMY_QUERY_KEY, nextTaxonomy);
    } else {
      params.delete(TAXONOMY_QUERY_KEY);
    }

    const trimmedSearch = q?.trim();
    if (trimmedSearch) {
      params.set(SEARCH_QUERY_KEY, trimmedSearch);
    } else {
      params.delete(SEARCH_QUERY_KEY);
    }

    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;

    if (nextHref !== currentHref) {
      startTransition(() => {
        router.replace(nextHref);
      });
    }
  }

  const q = deferredSearch.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    return baseItems
      .filter((item) => {
        const categoryKey = categoryKeyForModel(item);
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
      })
      .sort((a, b) => {
        const orderA = a.official_order ?? 9999;
        const orderB = b.official_order ?? 9999;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.display_name.localeCompare(b.display_name);
      });
  }, [activeCategory, baseItems, locale, q, t]);

  const showPacks = !pickerMode && (effectiveTab === "all" || effectiveTab === "packs");
  const showModels = effectiveTab === "all" || effectiveTab === "models" || pickerMode;
  const activeCategoryLabel =
    activeCategory === "all"
      ? t("discover.tabAll")
      : categoryLabel(
          activeCategory,
          taxonomy.find((item) => item.key === activeCategory)?.label || activeCategory,
          locale,
          t,
        );
  const pickerSlotLabel = pickerCategory ? formatPipelineSlot(pickerCategory, t) : null;
  const pickerCategoryLabel = pickerCategory
    ? categoryLabel(pickerCategory, pickerCategory, locale, t)
    : null;
  const activeSummaryLabel = q ? `"${deferredSearch.trim()}"` : activeCategoryLabel;
  const toolbarTitle = pickerMode ? t("discover.toolbarMetaPicker") : t("discover.title");
  const toolbarDescription = pickerMode
    ? t("discover.catalogSubtitlePicker")
    : `${activeSummaryLabel} · ${t("discover.surfaceHint")}`;

  return (
    <div className="discover-page discover-console-page">
      {pickerMode ? (
        <div
          className="discover-console-context discover-picker-context"
          data-testid="discover-picker-context"
        >
          <div className="discover-console-context-stat">
            <span>{t("discover.pickerSlot")}</span>
            <strong>{pickerSlotLabel || pickerCategoryLabel || t("discover.modelsOfficial")}</strong>
          </div>
          <div className="discover-console-context-stat">
            <span>{t("discover.pickerModel")}</span>
            <strong>{currentModelId || t("dashboard.modelFallback")}</strong>
          </div>
          {from ? (
            <Link href={from} className="discover-console-context-link">
              {t("discover.pickerReturn")}
            </Link>
          ) : null}
        </div>
      ) : null}

      <section className="discover-console-toolbar">
        <div className="discover-console-header">
          <div className="discover-console-copy">
            <span className="discover-console-kicker">{toolbarTitle}</span>
            <div className="discover-console-titleline">
              <h1 className="discover-console-title">{t("discover.modelsOfficial")}</h1>
              <div className="discover-console-summary" aria-label={t("discover.activeFilters")}>
                <span className="discover-console-toolbar-pill">
                  {t("discover.toolbarMetaResults", { count: filteredModels.length })}
                </span>
                <span className="discover-console-toolbar-pill">
                  {t("discover.toolbarMetaCategories", { count: taxonomy.length })}
                </span>
                <span className="discover-console-toolbar-pill">{activeSummaryLabel}</span>
              </div>
            </div>
            <p className="discover-console-description">{toolbarDescription}</p>
          </div>

          <div className="discover-console-actions">
            <label className="discover-console-search-shell">
              <span className="discover-console-search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                className="discover-console-search"
                type="text"
                placeholder={t("discover.search")}
                value={querySearch}
                onChange={(event) => replaceDiscoverQuery({ q: event.target.value })}
              />
              {querySearch.trim() ? (
                <button
                  type="button"
                  className="discover-console-search-clear"
                  onClick={() => replaceDiscoverQuery({ q: null })}
                >
                  {t("discover.clearSearch")}
                </button>
              ) : null}
            </label>
          </div>
        </div>

        <div className="discover-console-filterbar">
          {!pickerMode ? (
            <div className="discover-console-switcher" role="tablist" aria-label={t("discover.title")}>
              {(
                [
                  ["all", t("discover.tabAll")],
                  ["packs", t("discover.tabPacks")],
                  ["models", t("discover.tabModels")],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={effectiveTab === key}
                  className={`discover-console-switch${effectiveTab === key ? " is-active" : ""}`}
                  onClick={() => replaceDiscoverQuery({ tab: key })}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="discover-console-filter-group">
            <div className="discover-console-filter-head">
              <span>{t("discover.filterCategories")}</span>
            </div>

            <div className="discover-console-category-list">
              <button
                type="button"
                className={`discover-console-category discover-category-chip${activeCategory === "all" ? " is-active" : ""}`}
                onClick={() => replaceDiscoverQuery({ taxonomy: null })}
              >
                <span>{t("discover.tabAll")}</span>
                <strong>{baseItems.length}</strong>
              </button>
              {taxonomy.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`discover-console-category discover-category-chip${activeCategory === item.key ? " is-active" : ""}`}
                  onClick={() => replaceDiscoverQuery({ taxonomy: item.key })}
                >
                  <span>{categoryLabel(item.key, item.label, locale, t)}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
          </div>

          {!pickerMode ? (
            <div className="discover-console-filter-group discover-console-filter-group--compact">
              <div className="discover-console-filter-head">
                <span>{t("discover.filterAvailability")}</span>
              </div>
              <div className="discover-console-availability-list">
                {(
                  [
                    ["all", t("discover.availabilityAll")],
                    ["selectable", t("discover.availabilityReady")],
                  ] as [AvailabilityFilter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`discover-console-availability${availabilityFilter === key ? " is-active" : ""}`}
                    onClick={() => replaceDiscoverQuery({ availability: key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="discover-console-main">
        {showModels ? (
          <section className="discover-console-surface">
            {loadingModels ? (
              <div className="discover-model-table is-loading" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="discover-model-row discover-model-row--skeleton">
                    <div className="discover-model-skeleton model" />
                    <div className="discover-model-skeleton short" />
                  </div>
                ))}
              </div>
            ) : errorMessage ? (
              <div className="discover-console-empty">
                <strong>{t("discover.loadFailed")}</strong>
                <span>{errorMessage}</span>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="discover-console-empty">
                <strong>{t("discover.noModelsFound")}</strong>
              </div>
            ) : (
              <div className="discover-model-table">
                {filteredModels.map((model) => {
                  const providerStyle = getProviderStyle(model.provider);
                  const providerName = providerDisplayLabel(model.provider, model.provider_display, locale, t);
                  const categoryName = categoryLabel(
                    model.official_category_key,
                    model.official_category,
                    locale,
                    t,
                  );
                  const groupName = model.official_group
                    ? groupLabel(model.official_group_key, model.official_group, locale, t)
                    : null;
                  const slotName = formatPipelineSlot(model.pipeline_slot, t);
                  const previewTokens = dedupeTokens([
                    ...(model.input_modalities ?? []),
                    ...(model.supported_tools ?? []),
                    ...(model.supported_features ?? []),
                  ]).slice(0, 5);

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

                  const detailHref = `/app/discover/models/${encodeURIComponent(model.canonical_model_id)}${
                    detailParams.size ? `?${detailParams.toString()}` : ""
                  }`;
                  const isSelectable = model.is_selectable_in_console !== false;

                  return (
                    <Link
                      key={model.canonical_model_id}
                      href={detailHref}
                      className="discover-model-row model-card"
                    >
                      <div className="discover-model-primary">
                        <div
                          className="discover-model-logo"
                          style={{ background: providerStyle.bg, color: "white" }}
                        >
                          {providerStyle.label}
                        </div>
                        <div className="discover-model-copy">
                          <div className="discover-model-title-row">
                            <strong className="discover-model-title">{model.display_name}</strong>
                            <span className="discover-model-provider model-card-provider">{providerName}</span>
                          </div>
                          <p className="discover-model-description">
                            {model.description || model.display_name}
                          </p>
                          <div className="discover-model-summary">
                            <span className="discover-model-summary-item is-emphasis">{categoryName}</span>
                            {groupName ? (
                              <span className="discover-model-summary-item">{groupName}</span>
                            ) : null}
                            {slotName ? (
                              <span className="discover-model-summary-item">
                                {t("discover.slotFits", { slot: slotName })}
                              </span>
                            ) : null}
                          </div>
                          <div className="discover-model-capabilities">
                            {previewTokens.length ? previewTokens.map((token) => (
                              <span key={token} className="discover-model-capability">
                                {labelForToken(token, t)}
                              </span>
                            )) : (
                              <span className="discover-model-capability is-muted">
                                {t("modelDetail.notDeclared")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="discover-model-access">
                        <span className={`discover-model-state${isSelectable ? " is-ready" : ""}`}>
                          {isSelectable ? t("discover.availableNow") : t("discover.browseOnlyShort")}
                        </span>
                        <span className="discover-model-action">
                          {t("discover.openDetail")}
                          <ArrowRightIcon />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {showPacks ? (
          <section className="discover-console-surface discover-console-surface--secondary">
            <div className="discover-console-surface-head">
              <div className="discover-console-surface-copy">
                <h2 className="discover-console-surface-title">{t("discover.hotPacks")}</h2>
                <p className="discover-console-surface-description">{t("discover.packsComingSoonBody")}</p>
              </div>
            </div>
            <div className="discover-pack-empty">
              <div className="discover-pack-empty-copy">
                <strong>{t("discover.packsComingSoonTitle")}</strong>
                <span>{t("discover.noPacksYet")}</span>
              </div>
              <div className="discover-pack-pill-row">
                <span>{t("discover.packsRoadmap0")}</span>
                <span>{t("discover.packsRoadmap1")}</span>
                <span>{t("discover.packsRoadmap2")}</span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div className="discover-page discover-console-page" />}>
      <DiscoverPageContent />
    </Suspense>
  );
}
