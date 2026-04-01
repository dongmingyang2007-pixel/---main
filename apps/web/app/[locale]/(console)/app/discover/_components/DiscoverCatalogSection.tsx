"use client";

import { ArrowRightIcon } from "./discover-icons";
import { DiscoverModelCard } from "./DiscoverModelCard";

interface CatalogModel {
  canonical_model_id: string;
  display_name: string;
  provider: string;
  provider_display: string;
  description: string;
  official_category_key?: string | null;
  official_category?: string | null;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_tools: string[];
  supported_features: string[];
  is_selectable_in_console?: boolean | null;
}

interface DiscoverCatalogSectionProps {
  categoryKey: string;
  categoryName: string;
  models: CatalogModel[];
  isHighlighted: boolean;
  locale: string;
  t: (key: string) => string;
  countLabel: string;
  viewAllLabel: string;
  availableLabel: string;
  browseOnlyLabel: string;
  buildDetailHref: (modelId: string) => string;
  sectionRef?: (el: HTMLElement | null) => void;
}

export function DiscoverCatalogSection({
  categoryKey,
  categoryName,
  models,
  isHighlighted,
  locale,
  t,
  countLabel,
  viewAllLabel,
  availableLabel,
  browseOnlyLabel,
  buildDetailHref,
  sectionRef,
}: DiscoverCatalogSectionProps) {
  return (
    <div
      ref={sectionRef}
      className={`dhub-catalog-section${isHighlighted ? " is-highlighted" : ""}`}
      data-category={categoryKey}
    >
      <div className="dhub-catalog-section-head">
        <div className="dhub-catalog-section-title-row">
          <span className="dhub-catalog-section-name">{categoryName}</span>
          <span className="dhub-catalog-section-count">{countLabel}</span>
        </div>
        <span className="dhub-catalog-section-viewall">
          {viewAllLabel} <ArrowRightIcon size={12} />
        </span>
      </div>
      <div className="dhub-catalog-scroll">
        {models.map((model) => (
          <DiscoverModelCard
            key={model.canonical_model_id}
            model={model}
            detailHref={buildDetailHref(model.canonical_model_id)}
            locale={locale}
            t={t}
            availableLabel={availableLabel}
            browseOnlyLabel={browseOnlyLabel}
          />
        ))}
      </div>
    </div>
  );
}
