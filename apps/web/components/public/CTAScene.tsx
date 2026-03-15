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
    const titleEl = el.querySelector(".cta-title");
    const bodyEl = el.querySelector(".cta-body");
    const buttons = el.querySelectorAll(".cta-btn");
    const targets = [titleEl, bodyEl, ...Array.from(buttons)].filter(Boolean);

    // Set initial hidden state explicitly
    gsap.set(targets, { opacity: 0, y: 20 });

    // Use native IntersectionObserver — more reliable than ScrollTrigger
    // for the last section on a page where scroll distance is limited
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const tl = gsap.timeline();
          if (titleEl) tl.to(titleEl, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" });
          if (bodyEl) tl.to(bodyEl, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, "<0.1");
          if (buttons.length) tl.to(buttons, { opacity: 1, y: 0, stagger: 0.1, duration: 0.5, ease: "power2.out" }, "<0.15");
          observer.disconnect();
        }
      },
      { threshold: 0.05 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      gsap.set(targets, { clearProps: "all" });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
    >
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
