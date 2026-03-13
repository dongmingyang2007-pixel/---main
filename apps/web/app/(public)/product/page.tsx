"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";
import { PRODUCT_STORY_SCENES } from "@/lib/public-story-content";

export default function ProductPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll(".product-section");
    sections.forEach((section) => {
      gsap.from(section, {
        opacity: 0,
        y: 40,
        duration: 0.7,
        ease: "power2.out",
        scrollTrigger: {
          trigger: section,
          start: "top 80%",
          once: true,
        },
      });
    });
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Product
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          随身携带的 AI 感知系统。
        </p>
        <div className="mt-8 w-full max-w-2xl">
          <ImagePlaceholder label="Product Hero Shot" aspect="16/9" icon="photo" />
        </div>
      </section>

      {/* Sections from existing story content */}
      {PRODUCT_STORY_SCENES.map((scene) => (
        <section
          key={scene.id}
          className="product-section mx-auto max-w-5xl px-6 py-20"
        >
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
                {scene.eyebrow}
              </p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
                {scene.title}
              </h2>
              <p className="mt-3 text-[var(--text-secondary)]">{scene.summary}</p>
              <ul className="mt-6 flex flex-col gap-3">
                {scene.details.map((d) => (
                  <li key={d.label} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-v2)]" />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">{d.label}</span>
                      <span className="ml-1 text-sm text-[var(--text-secondary)]">— {d.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-center">
              <ImagePlaceholder
                label={scene.assetSlots[0] || "Product Image"}
                aspect="4/3"
                icon="photo"
              />
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">体验产品</h2>
        <div className="mt-6 flex gap-4">
          <MagneticButton href="/demo" className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
            Try Demo
          </MagneticButton>
          <MagneticButton href="/ecosystem" className="rounded-[var(--radius-full)] border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-primary)]">
            AI Ecosystem
          </MagneticButton>
        </div>
      </section>
    </div>
  );
}
