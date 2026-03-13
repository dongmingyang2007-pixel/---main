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
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-parallax]"));
    if (!elements.length) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      if (document.visibilityState === "hidden") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        elements.forEach((el) => {
          if (el.style.getPropertyValue("--parallax") !== "0") {
            el.style.setProperty("--parallax", "0");
          }
        });
        return;
      }

      const vh = window.innerHeight;
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // 0 when element enters bottom, 1 when it exits top
        const progress = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
        const nextValue = progress.toFixed(4);
        if (el.style.getPropertyValue("--parallax") !== nextValue) {
          el.style.setProperty("--parallax", nextValue);
        }
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
