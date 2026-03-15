"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Apple-style character-by-character text reveal.
 *
 * Splits text into individual characters and staggers their appearance
 * when the element enters the viewport. Uses IntersectionObserver for
 * trigger and CSS animations for the actual reveal.
 */
export const TextReveal = memo(function TextReveal({
  text,
  tag: Tag = "h1",
  className = "",
  staggerMs = 32,
  revealDuration = 600,
}: {
  text: string;
  tag?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  staggerMs?: number;
  revealDuration?: number;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    const commitState = (next: { enhanced: boolean; revealed: boolean }) => {
      queueMicrotask(() => {
        if (cancelled) return;
        setEnhanced((previous) =>
          previous === next.enhanced ? previous : next.enhanced,
        );
        setRevealed((previous) =>
          previous === next.revealed ? previous : next.revealed,
        );
      });
    };

    const revealImmediately = (animate = false) => {
      commitState({ enhanced: animate, revealed: true });
    };

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      revealImmediately(false);
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= window.innerHeight * 0.92) {
      revealImmediately(false);
      return;
    }

    commitState({ enhanced: true, revealed: false });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  const chars = useMemo(() => Array.from(text), [text]);
  const effectiveStaggerMs = useMemo(() => {
    if (chars.length <= 1) return 0;
    const maxWindowMs = 260;
    return Math.min(staggerMs, maxWindowMs / (chars.length - 1));
  }, [chars.length, staggerMs]);

  return (
    <Tag
      ref={containerRef as never}
      className={`text-reveal ${enhanced ? "is-enhanced" : ""} ${revealed ? "is-revealed" : ""} ${className}`}
      aria-label={text}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          className="text-reveal-char"
          style={{
            animationDelay: revealed ? `${i * effectiveStaggerMs}ms` : undefined,
            animationDuration: `${revealDuration}ms`,
          }}
          aria-hidden="true"
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </Tag>
  );
});
