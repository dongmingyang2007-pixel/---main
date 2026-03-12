"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Apple-style character-by-character text reveal.
 *
 * Splits text into individual characters and staggers their appearance
 * when the element enters the viewport. Uses IntersectionObserver for
 * trigger and CSS animations for the actual reveal.
 */
export function TextReveal({
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
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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
    return () => observer.disconnect();
  }, []);

  const chars = text.split("");

  return (
    <Tag
      ref={containerRef as never}
      className={`text-reveal ${revealed ? "is-revealed" : ""} ${className}`}
      aria-label={text}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          className="text-reveal-char"
          style={{
            animationDelay: revealed ? `${i * staggerMs}ms` : undefined,
            animationDuration: `${revealDuration}ms`,
          }}
          aria-hidden="true"
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </Tag>
  );
}
