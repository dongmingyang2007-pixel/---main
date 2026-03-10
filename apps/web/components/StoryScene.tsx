import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import type { StoryAction, StorySceneContent } from "@/lib/story-types";

export function StoryScene({
  scene,
  index,
  opening = false,
  actions = [],
  scrollNote,
}: {
  scene: StorySceneContent;
  index: number;
  opening?: boolean;
  actions?: StoryAction[];
  scrollNote?: string;
}) {
  const Heading = opening ? "h1" : "h2";

  return (
    <section className={`story-experience-section ${opening ? "is-opening" : ""}`}>
      <div className="story-experience-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="story-experience-section-body">
        <div className="home-story-eyebrow">{scene.eyebrow}</div>
        <Heading className="home-story-title">{scene.title}</Heading>
        <p className={`home-story-summary ${opening ? "is-opening" : ""}`}>{scene.summary}</p>
        {opening && actions.length ? (
          <div className="home-story-actions">
            {actions.map((action) => (
              <PublicDocumentLink
                key={`${action.href}-${action.label}`}
                href={action.href}
                className={`home-story-button ${action.variant === "secondary" ? "" : "is-primary"}`}
              >
                {action.label}
              </PublicDocumentLink>
            ))}
          </div>
        ) : null}
        {opening && scrollNote ? <p className="home-story-scroll-note">{scrollNote}</p> : null}
        <div className="home-story-detail-list">
          {scene.details.map((detail) => (
            <div key={detail.label} className="home-story-detail">
              <span>{detail.label}</span>
              <p>{detail.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
