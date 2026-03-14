"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";

interface EcosystemPreviewProps {
  eyebrow: string;
  title: string;
  body: string;
  details?: { label: string; body: string }[];
  learnMoreLabel: string;
  imageAlt: string;
}

export function EcosystemPreview({
  eyebrow,
  title,
  body,
  details,
  learnMoreLabel,
  imageAlt,
}: EcosystemPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: el,
        start: "top 70%",
        once: true,
      },
    });
    tl.from(el.querySelector(".eco-text"), { opacity: 0, x: -30, duration: 0.7 });
    tl.from(el.querySelector(".eco-visual"), { opacity: 0, x: 30, duration: 0.7 }, "<0.15");
    return () => { tl.kill(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-screen items-center justify-center bg-[var(--bg-surface)] px-6"
    >
      <div className="grid w-full max-w-5xl gap-12 md:grid-cols-2">
        <div className="eco-text flex flex-col justify-center">
          <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">{body}</p>
          {details && (
            <ul className="mt-8 flex flex-col gap-4">
              {details.map((d) => (
                <li key={d.label} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-v2)]" />
                  <div>
                    <span className="font-medium text-[var(--text-primary)]">{d.label}</span>
                    <span className="ml-2 text-sm text-[var(--text-secondary)]">{d.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-8">
            <MagneticButton href="/ecosystem" className="inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
              {learnMoreLabel}
            </MagneticButton>
          </div>
        </div>
        <div className="eco-visual flex items-center justify-center">
          <ImagePlaceholder label={imageAlt} aspect="1/1" icon="image" />
        </div>
      </div>
    </div>
  );
}
