"use client";

import { useEffect, useState } from "react";

/**
 * Tracks scroll position to drive navigation appearance changes.
 *
 * Returns:
 * - `scrolled`: true once the user scrolls past the threshold (default 80px)
 * - `hidden`: true when scrolling down fast (auto-hide nav pattern)
 * - `progress`: 0→1 page scroll progress
 */
export function useScrollNav(threshold = 80) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let lastY = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;

      setScrolled(y > threshold);
      setProgress(docHeight > 0 ? Math.min(1, y / docHeight) : 0);

      // Auto-hide: only when scrolling down AND past threshold
      if (y > threshold) {
        const delta = y - lastY;
        if (delta > 12) {
          setHidden(true);
        } else if (delta < -6) {
          setHidden(false);
        }
      } else {
        setHidden(false);
      }

      lastY = y;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return { scrolled, hidden, progress };
}
