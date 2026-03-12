"use client";

import { useEffect, type RefObject } from "react";

/**
 * Observes elements with [data-reveal] inside a container.
 * Adds `is-revealed` class when they scroll into view, triggering CSS animations.
 *
 * Supports:
 *  - data-reveal          → revealUp (default)
 *  - data-reveal="scale"  → revealScale
 *  - data-reveal="fade"   → revealFade
 *  - data-reveal-delay="N" → animation-delay via CSS
 */
export function useScrollReveal(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reveals = container.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!reveals.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" },
    );

    reveals.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [containerRef]);
}
