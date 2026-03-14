"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

const DOC_KEYS = ["start", "product", "workflow", "security"] as const;
const FAQ_INDICES = [0, 1, 2, 3] as const;

export default function SupportPage() {
  const t = useTranslations("support");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll(".support-section");
    const tweens: gsap.core.Tween[] = [];
    sections.forEach((section) => {
      tweens.push(
        gsap.from(section, {
          opacity: 0,
          y: 30,
          duration: 0.6,
          ease: "power2.out",
          scrollTrigger: {
            trigger: section,
            start: "top 85%",
            once: true,
          },
        }),
      );
    });
    return () => {
      tweens.forEach((tw) => {
        tw.scrollTrigger?.kill();
        tw.kill();
      });
    };
  }, []);

  const email = t("contact.email");

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          {t("hero.eyebrow")}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          {t("hero.title")}
        </p>
      </section>

      {/* Documentation paths */}
      <section className="support-section mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("docs.title")}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {DOC_KEYS.map((key) => (
            <div
              key={key}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            >
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {t(`docs.${key}.label`)}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                {t(`docs.${key}.title`)}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{t(`docs.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="support-section bg-[var(--bg-surface)] px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("faq.title")}</h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQ_INDICES.map((i) => (
              <div key={i}>
                <h3 className="font-semibold text-[var(--text-primary)]">{t(`faq.q${i}`)}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{t(`faq.a${i}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="support-section mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("contact.title")}</h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          {t("contact.response")}
        </p>
        <a
          href={`mailto:${email}`}
          className="mt-6 inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {email}
        </a>
      </section>
    </div>
  );
}
