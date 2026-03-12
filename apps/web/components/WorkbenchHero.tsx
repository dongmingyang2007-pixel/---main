"use client";

import { TextReveal } from "@/components/TextReveal";

type WorkbenchPoint = {
  label: string;
  detail: string;
};

export function WorkbenchHero({
  eyebrow,
  title,
  summary,
  points,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  points: WorkbenchPoint[];
}) {
  return (
    <section className="workbench-hero">
      <div className="workbench-hero-topline" data-reveal="fade">
        <div className="site-kicker is-on-dark">{eyebrow}</div>
        <div className="workbench-hero-status">Studio Access</div>
      </div>
      <TextReveal
        text={title}
        tag="h1"
        className="workbench-hero-title"
        staggerMs={30}
        revealDuration={500}
      />
      <p className="workbench-hero-summary" data-reveal data-reveal-delay="2">{summary}</p>
      <div className="workbench-point-list">
        {points.map((point, index) => (
          <article
            key={point.label}
            className="workbench-point"
            data-reveal
            data-reveal-delay={String(index + 3)}
          >
            <strong className="workbench-point-label">{point.label}</strong>
            <span className="workbench-point-detail">{point.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
