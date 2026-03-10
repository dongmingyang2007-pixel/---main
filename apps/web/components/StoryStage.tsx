import type { CSSProperties, Ref } from "react";

import type { StoryTone } from "@/lib/story-types";

export function StoryStage({
  eyebrow,
  status,
  tone,
  label,
  summary,
  tags,
  assetSlots,
  timelineLabels,
  activeId,
  progress,
  iframeRef,
  viewerSrc,
  viewerTitle,
  viewerConnected,
  onViewerLoad,
  loaderLabel,
}: {
  eyebrow: string;
  status: string;
  tone: StoryTone;
  label: string;
  summary: string;
  tags: string[];
  assetSlots: string[];
  timelineLabels: string[];
  activeId: string;
  progress: number;
  iframeRef?: Ref<HTMLIFrameElement>;
  viewerSrc?: string;
  viewerTitle?: string;
  viewerConnected?: boolean;
  onViewerLoad?: () => void;
  loaderLabel?: string;
}) {
  const [topSlot, bottomSlot, sideSlot] = assetSlots;

  return (
    <div className={`story-stage tone-${tone}`} style={{ "--story-progress": progress.toFixed(3) } as CSSProperties}>
      <div className="story-stage-topline">
        <div className="story-stage-caption">{eyebrow}</div>
        <span className="story-stage-status">{status}</span>
      </div>

      <div className="story-stage-shell">
        <div className="story-stage-orbit story-stage-orbit-a" aria-hidden="true" />
        <div className="story-stage-orbit story-stage-orbit-b" aria-hidden="true" />
        {topSlot ? <div className="story-stage-slot story-stage-slot-top">{topSlot}</div> : null}
        {bottomSlot ? <div className="story-stage-slot story-stage-slot-bottom">{bottomSlot}</div> : null}
        {sideSlot ? <div className="story-stage-slot story-stage-slot-side">{sideSlot}</div> : null}

        {viewerSrc ? (
          <iframe
            ref={iframeRef}
            src={viewerSrc}
            title={viewerTitle || "QIHANG Story Stage"}
            className="story-stage-iframe"
            onLoad={onViewerLoad}
          />
        ) : (
          <div className="story-stage-no-media" />
        )}

        {viewerSrc && !viewerConnected ? <div className="story-stage-loader">{loaderLabel || "舞台加载中"}</div> : null}
      </div>

      <div className="story-stage-copy">
        <div>
          <p className="story-stage-label">{label}</p>
          <p className="story-stage-summary">{summary}</p>
        </div>
        <div className="story-stage-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      <div className="story-stage-timeline" aria-hidden="true">
        <div className="story-stage-timeline-track">
          <span className="story-stage-timeline-fill" />
        </div>
        <div className="story-stage-timeline-labels">
          {timelineLabels.map((timelineLabel) => (
            <span key={timelineLabel} className={timelineLabel === activeId ? "is-active" : undefined}>
              {timelineLabel}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
