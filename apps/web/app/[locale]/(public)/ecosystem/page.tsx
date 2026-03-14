"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";

const CAPABILITIES = [
  {
    title: "Data Workspace",
    description: "Upload, annotate, version — manage your training data end-to-end.",
    icon: "image" as const,
  },
  {
    title: "Model Training",
    description: "Launch training jobs with one click. Monitor metrics, logs, and curves in real time.",
    icon: "image" as const,
  },
  {
    title: "Personalized Deployment",
    description: "Publish models to your devices. Works offline with on-device inference.",
    icon: "image" as const,
  },
  {
    title: "Cloud Sync",
    description: "Keep models, data, and settings synchronized across all your devices.",
    icon: "image" as const,
  },
];

export default function EcosystemPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll(".capability-card");
    const tween = gsap.from(cards, {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".capabilities-grid"),
        start: "top 80%",
        once: true,
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          AI Ecosystem
        </p>
        <h1 className="mt-4 text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          不只是硬件。
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          完整的 AI 工作台，从数据采集到模型部署，让设备越用越聪明。
        </p>
      </section>

      {/* Capabilities grid */}
      <section className="capabilities-grid mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="capability-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8"
            >
              <ImagePlaceholder label={`${cap.title} Illustration`} aspect="2/1" icon={cap.icon} />
              <h3 className="mt-6 text-xl font-semibold text-[var(--text-primary)]">{cap.title}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow overview */}
      <section className="bg-[var(--bg-surface)] px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            From Data to Deployment
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">
            Upload → Annotate → Train → Deploy → Monitor. A complete pipeline designed for earphone AI.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <MagneticButton href="/demo" className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
              Try Demo
            </MagneticButton>
            <MagneticButton href="/pricing" className="rounded-[var(--radius-full)] border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-primary)]">
              View Pricing
            </MagneticButton>
          </div>
        </div>
      </section>
    </div>
  );
}
