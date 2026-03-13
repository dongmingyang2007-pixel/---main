"use client";

import { memo } from "react";

import { MagneticButton } from "@/components/MagneticButton";
import { TextReveal } from "@/components/TextReveal";
import type { StoryAction, StorySceneContent } from "@/lib/story-types";

export const StoryScene = memo(function StoryScene({
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
  return (
    <section className={`story-experience-section ${opening ? "is-opening" : ""}`}>
      <div className="story-experience-index" data-reveal data-reveal-delay="1">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="story-experience-section-body">
        <div className="home-story-eyebrow" data-reveal>{scene.eyebrow}</div>
        {opening ? (
          <TextReveal
            text={scene.title}
            tag="h1"
            className="home-story-title gradient-text"
            staggerMs={38}
          />
        ) : (
          <h2
            className="home-story-title"
            data-reveal
            data-reveal-delay="1"
          >
            {scene.title}
          </h2>
        )}
        <p
          className={`home-story-summary ${opening ? "is-opening" : ""}`}
          data-reveal
          data-reveal-delay="2"
        >
          {scene.summary}
        </p>
        {opening && actions.length ? (
          <div className="home-story-actions" data-reveal data-reveal-delay="3">
            {actions.map((action) => (
              <MagneticButton
                key={`${action.href}-${action.label}`}
                href={action.href}
                className={`home-story-button ${action.variant === "secondary" ? "" : "is-primary"}`}
                strength={0.25}
              >
                {action.label}
              </MagneticButton>
            ))}
          </div>
        ) : null}
        {opening && scrollNote ? (
          <p className="home-story-scroll-note" data-reveal="fade" data-reveal-delay="5">
            {scrollNote}
          </p>
        ) : null}
        <div className="home-story-detail-list">
          {scene.details.map((detail, detailIndex) => (
            <div
              key={detail.label}
              className="home-story-detail"
              data-reveal
              data-reveal-delay={String(detailIndex + 3)}
            >
              <span>{detail.label}</span>
              <p>{detail.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});
