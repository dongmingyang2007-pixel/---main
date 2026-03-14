"use client";

import { useEffect, useMemo, useRef, type ReactNode, type JSX } from "react";

import { StoryScene } from "@/components/StoryScene";
import { StoryStage } from "@/components/StoryStage";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { useParallax } from "@/lib/useParallax";
import { useDeferredIframeSrc } from "@/lib/useDeferredIframeSrc";
import { useStoryScroll } from "@/lib/useStoryScroll";
import { useViewerBridge } from "@/lib/useViewerBridge";
import {
  VIEWER_STORY_SRC_BASE,
  appendParentOrigin,
} from "@/lib/qihang-viewer-contract";
import type { StoryAction, StorySceneContent } from "@/lib/story-types";

export function PublicStoryExperience({
  scenes,
  actions = [],
  scrollNote,
  viewerEnabled = false,
  viewerParentOrigin,
  viewerTitle,
  children,
  illustrations,
}: {
  scenes: StorySceneContent[];
  actions?: StoryAction[];
  scrollNote?: string;
  viewerEnabled?: boolean;
  viewerParentOrigin?: string | null;
  viewerTitle?: string;
  children?: ReactNode;
  illustrations?: Record<string, JSX.Element>;
}) {
  const viewerSrc = viewerEnabled && viewerParentOrigin
    ? appendParentOrigin(VIEWER_STORY_SRC_BASE, viewerParentOrigin)
    : viewerEnabled
      ? VIEWER_STORY_SRC_BASE
      : "";
  const deferredViewerSrc = useDeferredIframeSrc(viewerSrc, viewerEnabled);

  const { sceneRefs, activeSceneIndex, timelineProgress } =
    useStoryScroll(scenes.length);

  const viewer = useViewerBridge({ enabled: viewerEnabled, deferredSrc: deferredViewerSrc });

  const experienceRef = useRef<HTMLDivElement>(null);
  useScrollReveal(experienceRef);
  useParallax(experienceRef);

  const activeScene = scenes[activeSceneIndex] ?? scenes[0];

  const viewerPatch = useMemo(
    () => activeScene?.viewerPatch || {},
    [activeScene],
  );

  useEffect(() => {
    viewer.sendPatch(viewerPatch);
  }, [viewerPatch, viewer]);

  return (
    <div className="story-experience" ref={experienceRef}>
      <div className="story-experience-grid">
        <div className="story-experience-stage-column">
          <StoryStage
            eyebrow={activeScene.eyebrow}
            status={viewer.viewerStatus}
            tone={activeScene.tone}
            label={activeScene.stageLabel}
            summary={activeScene.stageSummary}
            tags={activeScene.stageTags}
            assetSlots={activeScene.assetSlots}
            timelineLabels={scenes.map((scene) => scene.id)}
            activeId={activeScene.id}
            progress={timelineProgress}
            iframeRef={viewerEnabled ? viewer.iframeRef : undefined}
            viewerSrc={viewerEnabled ? deferredViewerSrc : undefined}
            viewerTitle={viewerTitle}
            viewerConnected={viewer.viewerConnected}
            onViewerLoad={viewerEnabled ? viewer.onIframeLoad : undefined}
            loaderLabel={viewerEnabled ? "产品舞台加载中" : undefined}
            illustration={!viewerEnabled && illustrations ? illustrations[activeScene.id] : undefined}
          />
        </div>

        <div className="story-experience-copy-column">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              ref={(node) => {
                sceneRefs.current[index] = node;
              }}
            >
              <StoryScene
                scene={scene}
                index={index}
                opening={index === 0}
                actions={index === 0 ? actions : []}
                scrollNote={index === 0 ? scrollNote : undefined}
              />
            </div>
          ))}
          {children}
        </div>
      </div>
    </div>
  );
}
