"use client";

import { useEffect, useRef, useState } from "react";

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
  const hiddenRef = useRef(false);

  useEffect(() => {
    let lastY = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const nextScrolled = y > threshold;
      const nextProgress = docHeight > 0 ? Math.min(1, y / docHeight) : 0;
      const roundedProgress = Math.round(nextProgress * 1000) / 1000;
      let nextHidden = false;

      if (nextScrolled) {
        const delta = y - lastY;
        if (delta > 12) {
          nextHidden = true;
        } else if (delta < -6) {
          nextHidden = false;
        } else {
          nextHidden = hiddenRef.current;
        }
      }

      setScrolled((previous) => (previous === nextScrolled ? previous : nextScrolled));
      setHidden((previous) => {
        if (previous === nextHidden) {
          return previous;
        }
        hiddenRef.current = nextHidden;
        return nextHidden;
      });
      setProgress((previous) => (Math.abs(previous - roundedProgress) < 0.01 ? previous : roundedProgress));
      hiddenRef.current = nextHidden;

      lastY = y;
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
  }, [threshold]);

  return { scrolled, hidden, progress };
}
