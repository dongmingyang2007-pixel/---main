"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

const TIMELINE_INDICES = [0, 1, 2] as const;

export default function UpdatesPage() {
  const t = useTranslations("updates");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll(".timeline-item");
    const tween = gsap.from(items, {
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
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  const timelineItems = TIMELINE_INDICES.map((i) => ({
    i,
    label: t(`timeline.${i}.label`),
    title: t(`timeline.${i}.title`),
    body: t(`timeline.${i}.body`),
  }));

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          {t("hero.eyebrow")}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          {t("hero.title")}
        </p>
      </section>

      <section className="timeline-list mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-col gap-8 border-l-2 border-[var(--border)] pl-8">
          {timelineItems.map((item) => (
            <div key={item.i} className="timeline-item relative">
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
