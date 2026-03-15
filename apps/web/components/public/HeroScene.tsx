"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { TextReveal } from "@/components/TextReveal";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";

interface HeroSceneProps {
  eyebrow: string;
  title: string;
  body: string;
  imageAlt: string;
}

export function HeroScene({ eyebrow, title, body, imageAlt }: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from(el.querySelector(".hero-body"), { opacity: 0, y: 30, duration: 0.8, delay: 0.3 });
    tl.from(el.querySelector(".hero-image"), { opacity: 0, filter: "blur(8px)", duration: 1 }, "<0.2");
    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
      <p className="mb-4 text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
        {eyebrow}
      </p>
      <h1 className="text-[var(--font-size-hero)] font-bold leading-tight text-[var(--text-primary)]">
        {title.split("\n").map((line, i) => (
          <span key={i} className="block">
            <TextReveal text={line} tag="span" />
          </span>
        ))}
      </h1>
      <p className="hero-body mt-6 max-w-xl text-lg text-[var(--text-secondary)]">
        {body}
      </p>
      <div className="hero-image mt-12 w-full max-w-2xl">
        <ImagePlaceholder label={imageAlt} aspect="16/9" icon="photo" />
      </div>
    </div>
  );
}
