"use client";

import { Link } from "@/i18n/navigation";
import { categoryLabel } from "@/lib/discover-labels";
import { DecoCircles, DecoWave, DecoLandscape } from "./discover-icons";

interface FeaturedModel {
  canonical_model_id: string;
  display_name: string;
  provider: string;
  provider_display: string;
  description: string;
  official_category_key?: string | null;
  official_category?: string | null;
}

interface DiscoverFeaturedProps {
  models: FeaturedModel[];
  locale: string;
  t: (key: string) => string;
  title: string;
  subtitle: string;
  buildDetailHref: (modelId: string) => string;
}

const FEATURED_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #a855f7)",
  "linear-gradient(135deg, #3b82f6, #60a5fa)",
  "linear-gradient(135deg, #f97316, #ef4444)",
  "linear-gradient(135deg, #10b981, #34d399)",
  "linear-gradient(135deg, #ec4899, #f472b6)",
];

const DECO_COMPONENTS = [DecoCircles, DecoWave, DecoLandscape];

export function DiscoverFeatured({
  models,
  locale,
  t,
  title,
  subtitle,
  buildDetailHref,
}: DiscoverFeaturedProps) {
  if (models.length === 0) {
    return null;
  }

  const displayed = models.slice(0, 3);

  return (
    <section className="dhub-featured">
      <div className="dhub-section-head">
        <div>
          <h2 className="dhub-section-title">{title}</h2>
          <p className="dhub-section-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="dhub-featured-grid">
        {displayed.map((model, index) => {
          const gradient = FEATURED_GRADIENTS[index % FEATURED_GRADIENTS.length];
          const Deco = DECO_COMPONENTS[index % DECO_COMPONENTS.length];
          const catName = categoryLabel(
            model.official_category_key,
            model.official_category,
            locale,
            t,
          );

          return (
            <Link
              key={model.canonical_model_id}
              href={buildDetailHref(model.canonical_model_id)}
              className={`dhub-featured-card${index === 0 ? " dhub-featured-card--hero" : ""}`}
              style={{ background: gradient }}
            >
              <Deco />
              <div className="dhub-featured-card-body">
                <span className="dhub-featured-card-cat">{catName}</span>
                <strong className="dhub-featured-card-name">{model.display_name}</strong>
                <span className="dhub-featured-card-desc">{model.description}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
