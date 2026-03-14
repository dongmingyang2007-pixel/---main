"use client";

import { startTransition, useEffect, useRef, useState } from "react";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function sameProgressArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.01);
}

export type StoryScrollResult = {
  sceneRefs: React.MutableRefObject<Array<HTMLElement | null>>;
  sceneProgress: number[];
  activeSceneIndex: number;
  activeProgress: number;
  timelineProgress: number;
};

export function useStoryScroll(sceneCount: number): StoryScrollResult {
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);
  const [sceneProgress, setSceneProgress] = useState<number[]>(() =>
    Array.from({ length: sceneCount }, () => 0),
  );
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

  useEffect(() => {
    let frame = 0;

    // Cache element geometry — only update on resize, not every scroll frame.
    // This avoids calling getBoundingClientRect() per scene per frame.
    let cachedOffsets: Array<{ top: number; height: number } | null> = [];
    let cachedVH = window.innerHeight;

    const refreshGeometry = () => {
      cachedVH = window.innerHeight;
      const scrollY = window.scrollY;
      cachedOffsets = Array.from({ length: sceneCount }, (_, index) => {
        const node = sceneRefs.current[index];
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { top: rect.top + scrollY, height: rect.height };
      });
    };

    const measure = () => {
      const scrollY = window.scrollY;
      const vh = cachedVH;

      const nextProgress = cachedOffsets.map((cached) => {
        if (!cached) return 0;
        const rectTop = cached.top - scrollY;
        const distance = vh + cached.height;
        return Math.round(clamp((vh - rectTop) / distance) * 50) / 50;
      });

      let nextActiveSceneIndex = 0;
      let bestWeight = -1;
      cachedOffsets.forEach((cached, index) => {
        if (!cached) return;
        const rectTop = cached.top - scrollY;
        const centerOffset = Math.abs(rectTop + cached.height / 2 - vh * 0.48);
        const weight = 1 - Math.min(centerOffset / (vh * 0.9), 1);
        if (weight > bestWeight) {
          bestWeight = weight;
          nextActiveSceneIndex = index;
        }
      });

      startTransition(() => {
        setSceneProgress((previous) =>
          sameProgressArray(previous, nextProgress) ? previous : nextProgress,
        );
        setActiveSceneIndex((previous) =>
          previous === nextActiveSceneIndex ? previous : nextActiveSceneIndex,
        );
      });
    };

    const requestMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const onResize = () => {
      refreshGeometry();
      requestMeasure();
    };

    refreshGeometry();
    requestMeasure();
    window.addEventListener("scroll", requestMeasure, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", onResize);
    };
  }, [sceneCount]);

  const activeProgress = sceneProgress[activeSceneIndex] ?? 0;
  const timelineProgress = clamp(
    (activeSceneIndex + activeProgress) / sceneCount,
  );

  return {
    sceneRefs,
    sceneProgress,
    activeSceneIndex,
    activeProgress,
    timelineProgress,
  };
}
