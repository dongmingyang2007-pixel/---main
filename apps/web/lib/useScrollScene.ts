"use client";

import { useEffect, useRef, useCallback } from "react";
import { ScrollTrigger } from "@/lib/gsap-register";

export interface ScrollSceneOptions {
  /** Pin the scene while scrubbing (desktop only). Default: true */
  pin?: boolean;
  /** Scrub smoothness: true = 1:1, number = smooth seconds. Default: true */
  scrub?: boolean | number;
  /** Extra scroll distance as multiplier of scene height. Default: 1 (100% extra) */
  scrollPad?: number;
  /** Callback with progress 0→1 on every scroll update */
  onProgress?: (progress: number) => void;
  /** Snap to detent positions (e.g., [0, 0.5, 1]). Optional */
  snap?: number[] | false;
  /** Disable pin on mobile (< 768px). Default: true */
  disablePinOnMobile?: boolean;
}

export function useScrollScene(options: ScrollSceneOptions = {}) {
  const {
    pin = true,
    scrub = true,
    scrollPad = 1,
    onProgress,
    snap = false,
    disablePinOnMobile = true,
  } = options;

  const sceneRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const onProgressRef = useRef(onProgress);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Serialize snap to avoid reference equality issues in deps
  const snapKey = snap ? JSON.stringify(snap) : "false";

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;

    const isMobile = window.innerWidth < 768;
    const shouldPin = pin && !(isMobile && disablePinOnMobile);
    const parsedSnap: number[] | false = snapKey !== "false" ? JSON.parse(snapKey) : false;

    const config: ScrollTrigger.Vars = {
      trigger: el,
      start: "top top",
      end: () => `+=${el.offsetHeight * scrollPad}`,
      pin: shouldPin,
      scrub: scrub,
      onUpdate: (self) => {
        onProgressRef.current?.(self.progress);
      },
    };

    if (parsedSnap && !isMobile) {
      config.snap = {
        snapTo: parsedSnap,
        duration: 0.3,
        ease: "power2.inOut",
      };
    }

    triggerRef.current = ScrollTrigger.create(config);

    return () => {
      triggerRef.current?.kill();
      triggerRef.current = null;
    };
  }, [pin, scrub, scrollPad, snapKey, disablePinOnMobile]);

  /** Imperatively get current progress (0–1) */
  const getProgress = useCallback(() => triggerRef.current?.progress ?? 0, []);

  return { sceneRef, getProgress };
}
