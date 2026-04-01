"use client";

interface DiscoverMemoryPacksProps {
  title: string;
  subtitle: string;
  comingSoonLabel: string;
  roadmapLabels: string[];
}

export function DiscoverMemoryPacks({
  title,
  subtitle,
  comingSoonLabel,
  roadmapLabels,
}: DiscoverMemoryPacksProps) {
  return (
    <section className="dhub-memory-packs">
      <div className="dhub-section-head">
        <div>
          <h2 className="dhub-section-title">{title}</h2>
          <p className="dhub-section-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="dhub-memory-packs-empty">
        <div className="dhub-memory-packs-empty-copy">
          <strong>{comingSoonLabel}</strong>
        </div>
        <div className="dhub-memory-packs-pills">
          {roadmapLabels.map((label) => (
            <span key={label} className="dhub-memory-packs-pill">{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
