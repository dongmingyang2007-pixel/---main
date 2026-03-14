"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { MagneticButton } from "@/components/MagneticButton";

interface CTASceneProps {
  title: string;
  body: string;
  demoLabel: string;
  productLabel: string;
}

export function CTAScene({ title, body, demoLabel, productLabel }: CTASceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const buttons = el.querySelectorAll(".cta-btn");
    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: "top 70%", once: true },
    });
    tl.from(el.querySelector(".cta-title"), { opacity: 0, y: 20, duration: 0.6 });
    tl.from(buttons, { opacity: 0, y: 20, stagger: 0.1, duration: 0.5 }, "<0.2");
    return () => { tl.kill(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
    >
      <h2 className="cta-title text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-lg text-[var(--text-secondary)]">{body}</p>
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
