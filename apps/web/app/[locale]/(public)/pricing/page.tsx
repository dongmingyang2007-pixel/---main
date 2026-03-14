"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { MagneticButton } from "@/components/MagneticButton";
import { PRICING_COMPARE_RAIL } from "@/lib/public-story-content";

export default function PricingPage() {
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

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Pricing
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          选择适合你的方案。
        </p>
      </section>

      <section className="pricing-grid mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PRICING_COMPARE_RAIL.map((plan) => (
            <div
              key={plan.title}
              className="pricing-card flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            >
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {plan.label}
              </p>
              <h3 className="mt-2 text-xl font-bold text-[var(--text-primary)]">{plan.title}</h3>
              <p className="mt-2 flex-1 text-sm text-[var(--text-secondary)]">{plan.body}</p>
              <div className="mt-6">
                <MagneticButton
                  href="/demo"
                  className="block w-full rounded-[var(--radius-md)] bg-[var(--brand-v2)] py-2.5 text-center text-sm font-medium text-white"
                >
                  Get Started
                </MagneticButton>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
