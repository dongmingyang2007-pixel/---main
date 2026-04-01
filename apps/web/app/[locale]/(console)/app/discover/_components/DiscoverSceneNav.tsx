"use client";

import { SCENE_ICON_MAP, SCENE_GRADIENT_MAP } from "./discover-icons";
import { sceneLabel } from "@/lib/discover-labels";

interface DiscoverSceneNavProps {
  /** pipeline_slot values that have at least one model in the catalog */
  activeSlots: string[];
  /** Currently selected slot (from URL ?slot=xxx), or null */
  selectedSlot: string | null;
  /** Callback when a scene card is clicked */
  onSelect: (slot: string | null) => void;
  /** i18n translate function scoped to "console" */
  t: (key: string) => string;
  sectionLabel: string;
}

/** Canonical display order for pipeline slots */
const SLOT_ORDER: string[] = [
  "llm",
  "asr",
  "tts",
  "vision",
  "realtime",
  "realtime_asr",
  "realtime_tts",
];

export function DiscoverSceneNav({
  activeSlots,
  selectedSlot,
  onSelect,
  t,
  sectionLabel,
}: DiscoverSceneNavProps) {
  const slotsToShow = SLOT_ORDER.filter((slot) => activeSlots.includes(slot));

  if (slotsToShow.length === 0) {
    return null;
  }

  return (
    <div className="dhub-scenes">
      <div className="dhub-scenes-label">{sectionLabel}</div>
      <div className="dhub-scenes-grid">
        {slotsToShow.map((slot) => {
          const Icon = SCENE_ICON_MAP[slot];
          const gradient = SCENE_GRADIENT_MAP[slot] || "linear-gradient(135deg,#6b7280,#9ca3af)";
          const isSelected = selectedSlot === slot;

          return (
            <button
              key={slot}
              type="button"
              className={`dhub-scene-card${isSelected ? " is-active" : ""}`}
              style={{ background: gradient }}
              onClick={() => onSelect(isSelected ? null : slot)}
            >
              {Icon ? <Icon size={24} /> : null}
              <span className="dhub-scene-card-name">{sceneLabel(slot, t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
