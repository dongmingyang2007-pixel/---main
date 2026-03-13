"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { UPDATE_TIMELINE_RAIL } from "@/lib/public-story-content";

export default function UpdatesPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll(".timeline-item");
    gsap.from(items, {
      opacity: 0,
      x: -20,
      stagger: 0.08,
      duration: 0.5,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".timeline-list"),
        start: "top 80%",
        once: true,
      },
    });
  }, []);

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Updates
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          产品动态与更新日志。
        </p>
      </section>

      <section className="timeline-list mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-col gap-8 border-l-2 border-[var(--border)] pl-8">
          {UPDATE_TIMELINE_RAIL.map((item) => (
            <div key={item.title} className="timeline-item relative">
              {/* Dot on timeline */}
              <span className="absolute -left-[calc(2rem+5px)] top-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-v2)]" />
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {item.label}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {item.title}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
