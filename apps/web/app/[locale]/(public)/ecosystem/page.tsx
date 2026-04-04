"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";

const CAPABILITY_KEYS = ["workspace", "training", "deployment", "sync"] as const;

export default function EcosystemPage() {
  const t = useTranslations("ecosystem");
  const tc = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);

  useScrollReveal(containerRef);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 pt-20 text-center">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {t("hero.eyebrow")}
        </p>
        <h1 className="mt-4 text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          {t("hero.title")}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          {t("hero.body")}
        </p>
      </section>

      {/* Capabilities grid */}
      <section className="capabilities-grid mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {CAPABILITY_KEYS.map((key, i) => (
            <div
              key={key}
              data-reveal
              data-reveal-delay={`${i + 1}`}
              className="capability-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 transition-all hover:shadow-lg hover:border-[var(--brand-v2)]/30 hover:-translate-y-0.5"
            >
              <ImagePlaceholder label={`${t(`capabilities.${key}.title`)} Illustration`} aspect="2/1" icon="image" />
              <h3 className="mt-6 text-xl font-semibold text-[var(--text-primary)]">{t(`capabilities.${key}.title`)}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{t(`capabilities.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow overview */}
      <section className="bg-[var(--bg-surface)] px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("workflow.title")}
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <MagneticButton href="/demo" className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
              {tc("nav.tryDemo")}
            </MagneticButton>
            <MagneticButton href="/pricing" className="rounded-[var(--radius-full)] border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-primary)]">
              {tc("nav.pricing")}
            </MagneticButton>
          </div>
        </div>
      </section>
    </div>
  );
}
