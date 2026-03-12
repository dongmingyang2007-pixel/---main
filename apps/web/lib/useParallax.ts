"use client";

import { useEffect, type RefObject } from "react";

/**
 * Continuous scroll-linked parallax.
 *
 * Sets `--parallax` CSS custom property (0 → 1) on each `[data-parallax]`
 * element based on how far through the viewport it has scrolled.
 *
 * Elements can use this in CSS like:
 *   transform: translateY(calc(var(--parallax) * -40px));
 *   opacity: calc(1 - var(--parallax) * 0.3);
 */
export function useParallax(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      const elements = container.querySelectorAll<HTMLElement>("[data-parallax]");

      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // 0 when element enters bottom, 1 when it exits top
        const progress = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
        el.style.setProperty("--parallax", progress.toFixed(4));
      });
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef]);
}
