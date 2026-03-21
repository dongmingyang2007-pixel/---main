"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";
import { getProviderStyle } from "@/lib/model-utils";
import {
  MODEL_PICKER_SELECTION_KEY,
  categoryLabel,
  groupLabel,
  labelForToken,
  providerDisplayLabel,
} from "@/lib/discover-labels";

interface ModelDetail {
  id: string;
  model_id: string;
  canonical_model_id?: string | null;
  display_name: string;
  provider: string;
  provider_display: string;
  official_group_key?: string | null;
  official_group?: string | null;
  official_category_key?: string | null;
  official_category?: string | null;
  description: string;
  input_modalities: string[];
  output_modalities: string[];
  supported_tools: string[];
  supported_features: string[];
  official_url?: string | null;
  aliases: string[];
  pipeline_slot?: string | null;
  is_selectable_in_console?: boolean | null;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ModelDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const rawId = params.modelId;
  const modelId = decodeURIComponent(
    Array.isArray(rawId)
      ? rawId.filter((segment): segment is string => typeof segment === "string").join("/")
      : (rawId as string),
  );
  const t = useTranslations("console");

  const pickerMode = searchParams.get("picker") === "1";
  const pickerCategory = searchParams.get("category");
  const from = searchParams.get("from") || "/app/discover";
  const backLabel = pickerMode ? t("modelDetail.backToPrevious") : t("modelDetail.backToDiscover");

  const [model, setModel] = useState<ModelDetail | null>(null);
  const [loadedModelId, setLoadedModelId] = useState(modelId);
  const [loading, setLoading] = useState(Boolean(modelId));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;

    apiGet<ModelDetail>(`/api/v1/models/catalog/${encodeURIComponent(modelId)}`)
      .then((data) => {
        if (!cancelled) {
          setModel(data);
          setLoadedModelId(modelId);
          setError(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModel(null);
          setLoadedModelId(modelId);
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const sections = useMemo(() => {
    if (!model) {
      return [];
    }
    return [
      {
        title: t("modelDetail.inputModalities"),
        items: model.input_modalities ?? [],
      },
      {
        title: t("modelDetail.outputModalities"),
        items: model.output_modalities ?? [],
      },
      {
        title: t("modelDetail.supportedTools"),
        items: model.supported_tools ?? [],
      },
      {
        title: t("modelDetail.supportedFeatures"),
        items: model.supported_features ?? [],
      },
    ];
  }, [model, t]);

  if (loading || loadedModelId !== modelId) {
    return (
      <div className="model-detail">
        <Link href={from} className="model-detail-back">
          <ArrowLeftIcon />
          {backLabel}
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          <div style={{ width: "40%", height: 20, borderRadius: 8, background: "var(--border)" }} />
          <div style={{ width: "60%", height: 14, borderRadius: 6, background: "var(--border)" }} />
          <div style={{ width: "80%", height: 14, borderRadius: 6, background: "var(--border)" }} />
        </div>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="model-detail">
        <Link href={from} className="model-detail-back">
          <ArrowLeftIcon />
          {backLabel}
        </Link>
        <p style={{ color: "var(--text-secondary)", marginTop: 24 }}>
          {t("modelDetail.notFound")}
        </p>
      </div>
    );
  }

  const currentModel = model;
  const providerStyle = getProviderStyle(currentModel.provider);
  const selectableInConsole = currentModel.is_selectable_in_console !== false;
  const actionable = pickerMode && selectableInConsole;
  const statusLabel = selectableInConsole
    ? t("modelDetail.availableInConsole")
    : t("modelDetail.browseOnly");

  function handleUseModel() {
    if (!actionable || typeof window === "undefined" || !pickerCategory) {
      return;
    }
    window.sessionStorage.setItem(
      MODEL_PICKER_SELECTION_KEY,
      JSON.stringify({
        from,
        category: pickerCategory,
        modelId: currentModel.model_id,
        displayName: currentModel.display_name,
      }),
    );
    router.push(from);
  }

  return (
    <div className="model-detail">
      <Link href={from} className="model-detail-back">
        <ArrowLeftIcon />
        {backLabel}
      </Link>

      <div className="model-detail-header">
        <div
          className="model-detail-logo"
          style={{ background: providerStyle.bg, color: "white" }}
        >
          {providerStyle.label}
        </div>
        <div>
          <h1 className="model-detail-name">{currentModel.display_name}</h1>
          <div className="model-detail-provider">
            {providerDisplayLabel(currentModel.provider, currentModel.provider_display, locale, t)}
          </div>
          <div className="model-detail-tags">
            {currentModel.official_category ? (
              <span className="model-card-tag highlight">
                {categoryLabel(currentModel.official_category_key, currentModel.official_category, locale, t)}
              </span>
            ) : null}
            {currentModel.official_group ? (
              <span className="model-card-tag">
                {groupLabel(currentModel.official_group_key, currentModel.official_group, locale, t)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {pickerMode ? (
        <button
          className={`model-detail-cta${actionable ? "" : " is-disabled"}`}
          disabled={!actionable}
          onClick={handleUseModel}
        >
          {selectableInConsole ? t("modelDetail.useModel") : t("modelDetail.browseOnly")}
        </button>
      ) : (
        <div
          className={`model-detail-status${selectableInConsole ? " is-available" : " is-unavailable"}`}
        >
          {statusLabel}
        </div>
      )}

      {currentModel.description ? (
        <div className="model-detail-section">
          <div className="model-detail-section-title">{t("modelDetail.description")}</div>
          <div className="model-detail-desc">{currentModel.description}</div>
        </div>
      ) : null}

      <div className="model-detail-section">
        <div className="model-detail-section-title">{t("modelDetail.capabilities")}</div>

        <div className="model-modality-grid">
          {sections.map((section) => (
            <div key={section.title} className="model-modality-card">
              <div className="model-modality-label">{section.title}</div>
              <div className="model-modality-items">
                {section.items.length > 0 ? section.items.map((item) => (
                  <span key={item} className="model-modality-item supported">
                    <CheckIcon />
                    {labelForToken(item, t)}
                  </span>
                )) : (
                  <span className="model-modality-item unsupported">
                    {t("modelDetail.notDeclared")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {currentModel.aliases?.length ? (
        <div className="model-detail-section">
          <div className="model-detail-section-title">{t("modelDetail.aliases")}</div>
          <div className="model-modality-items">
            {currentModel.aliases.map((alias) => (
              <span key={alias} className="model-modality-item supported">
                <CheckIcon />
                {alias}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {currentModel.official_url ? (
        <div className="model-detail-section">
          <div className="model-detail-section-title">{t("modelDetail.officialSource")}</div>
          <a className="model-detail-source" href={currentModel.official_url} target="_blank" rel="noreferrer">
            {t("modelDetail.openOfficialSource")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

export default function ModelDetailPage() {
  return (
    <Suspense fallback={<div className="model-detail" />}>
      <ModelDetailPageContent />
    </Suspense>
  );
}
