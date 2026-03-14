"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";

interface CraftSceneProps {
  eyebrow: string;
  title: string;
  body: string;
}

export function CraftScene({ eyebrow, title, body }: CraftSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const bgLayer = el.querySelector(".craft-bg");
    const fgLayer = el.querySelector(".craft-fg");
    const tweens: gsap.core.Tween[] = [];

    if (bgLayer && fgLayer) {
      tweens.push(
        gsap.to(bgLayer, {
          yPercent: -15,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        }),
        gsap.to(fgLayer, {
          yPercent: 10,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        }),
      );
    }

    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: "top 60%", once: true },
    });
    tl.from(el.querySelector(".craft-copy"), { opacity: 0, y: 30, duration: 0.7 });
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
      tl.kill();
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex min-h-screen items-center overflow-hidden px-6">
      {/* Parallax background */}
      <div className="craft-bg absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-base)] via-[var(--bg-surface)] to-[var(--bg-base)]" />
      </div>

      <div className="mx-auto grid w-full max-w-5xl gap-12 md:grid-cols-2">
        {/* Close-up images */}
        <div className="craft-fg flex flex-col gap-6">
          <ImagePlaceholder label="Hinge Macro Shot" aspect="4/3" icon="photo" />
          <ImagePlaceholder label="Material Detail" aspect="4/3" icon="photo" />
        </div>

        {/* Copy */}
        <div className="craft-copy flex flex-col justify-center">
          <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">{body}</p>
        </div>
      </div>
    </div>
  );
}
