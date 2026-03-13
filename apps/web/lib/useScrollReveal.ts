"use client";

import { useLayoutEffect, type RefObject } from "react";

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
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reveals = container.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!reveals.length) return;

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      reveals.forEach((el) => {
        el.classList.remove("reveal-pending");
        el.classList.add("is-revealed");
      });
      return;
    }

    const viewportHeight = window.innerHeight;
    const shouldRevealNow = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= viewportHeight * 0.92;
    };

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

    reveals.forEach((el) => {
      if (el.classList.contains("is-revealed")) return;
      if (shouldRevealNow(el)) {
        el.classList.add("is-revealed");
        return;
      }
      el.classList.add("reveal-pending");
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [containerRef]);
}
