import clsx from "clsx";

import type { RailItem } from "@/lib/story-types";

export function ContentRail({
  eyebrow,
  title,
  summary,
  items,
  variant = "story",
}: {
  eyebrow: string;
  title: string;
  summary?: string;
  items: RailItem[];
  variant?: "story" | "plans" | "timeline" | "metrics";
}) {
  return (
    <section className={clsx("content-rail", `is-${variant}`)}>
      <div className="content-rail-header">
        <div className="home-story-eyebrow">{eyebrow}</div>
        <h2 className="home-story-band-title">{title}</h2>
        {summary ? <p className="home-story-band-summary">{summary}</p> : null}
      </div>
      <div className="content-rail-track">
        {items.map((item) => (
          <article key={`${item.label}-${item.title ?? item.body ?? ""}`} className="content-rail-item">
            <div className="content-rail-item-label">{item.label}</div>
            {item.meta ? <div className="content-rail-item-meta">{item.meta}</div> : null}
            {item.title ? <h3>{item.title}</h3> : null}
            {item.body ? <p>{item.body}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
