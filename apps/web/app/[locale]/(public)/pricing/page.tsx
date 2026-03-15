"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";
import { MagneticButton } from "@/components/MagneticButton";

const TIER_KEYS = ["explore", "studio", "team"] as const;

export default function PricingPage() {
  const t = useTranslations("pricing");
  const tc = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll(".pricing-card");
    const tween = gsap.from(cards, {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".pricing-grid"),
        start: "top 80%",
        once: true,
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  const plans = TIER_KEYS.map((key) => ({
    key,
    label: t(`tiers.${key}.label`),
    title: t(`tiers.${key}.title`),
    body: t(`tiers.${key}.body`),
    price: t(`tiers.${key}.price`),
    meta: t(`tiers.${key}.meta`),
  }));

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
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

      <section className="pricing-grid mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isRecommended = plan.key === "studio";
            return (
              <div
                key={plan.key}
                className={`pricing-card relative flex flex-col rounded-[var(--radius-lg)] border p-6 transition-shadow hover:shadow-lg ${
                  isRecommended
                    ? "border-[var(--brand-v2)] bg-[var(--bg-base)] shadow-[0_0_0_1px_var(--brand-v2)]"
                    : "border-[var(--border)] bg-[var(--bg-surface)]"
                }`}
              >
                {isRecommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-4 py-1 text-xs font-semibold text-white">
                    {t("tiers.studio.badge")}
                  </span>
                )}
                <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                  {plan.label}
                </p>
                <h3 className="mt-2 text-xl font-bold text-[var(--text-primary)]">{plan.title}</h3>
                <p className="mt-4 text-3xl font-bold text-[var(--text-primary)]">{plan.price}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{plan.meta}</p>
                <p className="mt-4 flex-1 text-sm text-[var(--text-secondary)]">{plan.body}</p>
                <div className="mt-6">
                  <MagneticButton
                    href="/demo"
                    className={`block w-full rounded-[var(--radius-md)] py-2.5 text-center text-sm font-medium transition-colors ${
                      isRecommended
                        ? "bg-[var(--brand-v2)] text-white"
                        : "border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] hover:border-[var(--brand-v2)] hover:text-[var(--brand-v2)]"
                    }`}
                  >
                    {tc("nav.getStarted")}
                  </MagneticButton>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
