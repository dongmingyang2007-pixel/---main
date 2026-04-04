"use client";

import { MagneticButton } from "@/components/MagneticButton";

interface CTASceneProps {
  title: string;
  body: string;
  demoLabel: string;
  productLabel: string;
}

export function CTAScene({ title, body, demoLabel, productLabel }: CTASceneProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="cta-title text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
        {title}
      </h2>
      <p className="cta-body mt-4 text-lg text-[var(--text-secondary)]">{body}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <MagneticButton
          href="/demo"
          className="cta-btn inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-4 text-base font-semibold text-white"
        >
          {demoLabel}
        </MagneticButton>
        <MagneticButton
          href="/product"
          className="cta-btn inline-block rounded-[var(--radius-full)] border border-[var(--border)] px-8 py-4 text-base font-semibold text-[var(--text-primary)]"
        >
          {productLabel}
        </MagneticButton>
      </div>
    </div>
  );
}
