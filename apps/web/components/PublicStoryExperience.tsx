"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type JSX } from "react";

import { StoryScene } from "@/components/StoryScene";
import { StoryStage } from "@/components/StoryStage";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { useParallax } from "@/lib/useParallax";
import { useDeferredIframeSrc } from "@/lib/useDeferredIframeSrc";
import {
  QIHANG_VIEWER_SOURCE,
  QIHANG_WEB_SOURCE,
  VIEWER_MESSAGE_GET_STATE,
  VIEWER_MESSAGE_READY,
  VIEWER_MESSAGE_SET_STATE,
  VIEWER_MESSAGE_STATE,
  VIEWER_STORY_SRC_BASE,
  appendParentOrigin,
} from "@/lib/qihang-viewer-contract";
import type { StoryAction, StorySceneContent } from "@/lib/story-types";

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function sameProgressArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.01);
}

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
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handshakeIntervalRef = useRef<number | null>(null);
  const handshakeTimeoutRef = useRef<number | null>(null);
  const latestPatchRef = useRef<Record<string, unknown>>({});
  const lastPatchSignatureRef = useRef("");
  const viewerReadyRef = useRef(false);
  const [sceneProgress, setSceneProgress] = useState<number[]>(() => scenes.map(() => 0));
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerStatus, setViewerStatus] = useState(viewerEnabled ? "准备产品舞台..." : "展位块已准备");
  const viewerSrc = viewerEnabled && viewerParentOrigin
    ? appendParentOrigin(VIEWER_STORY_SRC_BASE, viewerParentOrigin)
    : viewerEnabled
      ? VIEWER_STORY_SRC_BASE
      : "";
  const deferredViewerSrc = useDeferredIframeSrc(viewerSrc, viewerEnabled);

  const experienceRef = useRef<HTMLDivElement>(null);
  useScrollReveal(experienceRef);
  useParallax(experienceRef);

  const activeScene = scenes[activeSceneIndex] ?? scenes[0];
  const activeProgress = sceneProgress[activeSceneIndex] ?? 0;
  const timelineProgress = clamp((activeSceneIndex + activeProgress) / scenes.length);

  const clearHandshakeTimers = useCallback(() => {
    if (handshakeIntervalRef.current !== null) {
      window.clearInterval(handshakeIntervalRef.current);
      handshakeIntervalRef.current = null;
    }
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = null;
    }
  }, []);

  const suspendViewer = useCallback(() => {
    clearHandshakeTimers();
    viewerReadyRef.current = false;
    setViewerConnected(false);
    const frame = iframeRef.current;
    if (frame && frame.src !== "about:blank") {
      frame.src = "about:blank";
    }
  }, [clearHandshakeTimers]);

  const postToViewer = useCallback((type: string, payload?: unknown): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return false;
    targetWindow.postMessage(
      {
        source: QIHANG_WEB_SOURCE,
        type,
        payload,
      },
      "*",
    );
    return true;
  }, []);

  const startHandshake = useCallback((reason: string) => {
    clearHandshakeTimers();
    viewerReadyRef.current = false;
    setViewerConnected(false);
    setViewerStatus("同步产品舞台...");

    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (attempts > 16) {
        clearHandshakeTimers();
        setViewerStatus("模型加载较慢，继续显示展位块。");
        return;
      }
      postToViewer(VIEWER_MESSAGE_GET_STATE, { reason, attempt: attempts });
    };

    tick();
    handshakeIntervalRef.current = window.setInterval(tick, 450);
    handshakeTimeoutRef.current = window.setTimeout(() => {
      if (!viewerReadyRef.current) {
        setViewerStatus("模型尚未返回，先保留展位块。");
      }
    }, 7200);
  }, [clearHandshakeTimers, postToViewer]);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      const viewportHeight = window.innerHeight;
      const measuredRects = scenes.map((_, index) => {
        const node = sceneRefs.current[index];
        return node ? node.getBoundingClientRect() : null;
      });

      const nextProgress = measuredRects.map((rect) => {
        if (!rect) return 0;
        const distance = viewportHeight + rect.height;
        return Math.round(clamp((viewportHeight - rect.top) / distance) * 50) / 50;
      });

      let nextActiveSceneIndex = 0;
      let bestWeight = -1;

      measuredRects.forEach((rect, index) => {
        if (!rect) return;
        const centerOffset = Math.abs(rect.top + rect.height / 2 - viewportHeight * 0.48);
        const weight = 1 - Math.min(centerOffset / (viewportHeight * 0.9), 1);
        if (weight > bestWeight) {
          bestWeight = weight;
          nextActiveSceneIndex = index;
        }
      });

      startTransition(() => {
        setSceneProgress((previous) => (sameProgressArray(previous, nextProgress) ? previous : nextProgress));
        setActiveSceneIndex((previous) => (previous === nextActiveSceneIndex ? previous : nextActiveSceneIndex));
      });
    };

    const requestMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    requestMeasure();
    window.addEventListener("scroll", requestMeasure, { passive: true });
    window.addEventListener("resize", requestMeasure);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", requestMeasure);
    };
  }, [scenes]);

  useEffect(() => {
    if (!viewerEnabled || !deferredViewerSrc) return;

    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | {
            source?: string;
            type?: string;
            payload?: unknown;
          }
        | undefined;
      if (!data || data.source !== QIHANG_VIEWER_SOURCE) {
        return;
      }

      if (data.type === VIEWER_MESSAGE_READY || data.type === VIEWER_MESSAGE_STATE) {
        viewerReadyRef.current = true;
        setViewerConnected(true);
        setViewerStatus("产品舞台已联动");
        clearHandshakeTimers();
        postToViewer(VIEWER_MESSAGE_SET_STATE, latestPatchRef.current);
      }
    };

    window.addEventListener("message", onMessage);
    const frame = iframeRef.current;

    return () => {
      clearHandshakeTimers();
      window.removeEventListener("message", onMessage);
      viewerReadyRef.current = false;
      if (frame) {
        frame.src = "about:blank";
      }
    };
  }, [clearHandshakeTimers, deferredViewerSrc, postToViewer, viewerEnabled]);

  useEffect(() => {
    if (!viewerEnabled || !deferredViewerSrc) return;

    const onViewerSuspend = () => {
      suspendViewer();
    };

    window.addEventListener("qihang:viewer-suspend", onViewerSuspend);
    return () => {
      window.removeEventListener("qihang:viewer-suspend", onViewerSuspend);
    };
  }, [deferredViewerSrc, suspendViewer, viewerEnabled]);

  const viewerPatch = useMemo(
    () => activeScene?.viewerPatch || {},
    [activeScene],
  );

  useEffect(() => {
    if (!viewerEnabled) return;

    latestPatchRef.current = viewerPatch;
    const nextSignature = JSON.stringify(viewerPatch);
    if (nextSignature === lastPatchSignatureRef.current) return;
    lastPatchSignatureRef.current = nextSignature;

    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !viewerReadyRef.current) return;

    targetWindow.postMessage(
      {
        source: QIHANG_WEB_SOURCE,
        type: VIEWER_MESSAGE_SET_STATE,
        payload: viewerPatch,
      },
      "*",
    );
  }, [viewerEnabled, viewerPatch]);

  return (
    <div className="story-experience" ref={experienceRef}>
      <div className="story-experience-grid">
        <div className="story-experience-stage-column">
          <StoryStage
            eyebrow={activeScene.eyebrow}
            status={viewerStatus}
            tone={activeScene.tone}
            label={activeScene.stageLabel}
            summary={activeScene.stageSummary}
            tags={activeScene.stageTags}
            assetSlots={activeScene.assetSlots}
            timelineLabels={scenes.map((scene) => scene.id)}
            activeId={activeScene.id}
            progress={timelineProgress}
            iframeRef={viewerEnabled ? iframeRef : undefined}
            viewerSrc={viewerEnabled ? deferredViewerSrc : undefined}
            viewerTitle={viewerTitle}
            viewerConnected={viewerConnected}
            onViewerLoad={
              viewerEnabled
                ? () => {
                  viewerReadyRef.current = false;
                  setViewerConnected(false);
                  setViewerStatus("产品舞台载入中...");
                  startHandshake("story-stage-iframe-load");
                }
                : undefined
            }
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
