"use client";

import { useRef, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

const DOC_KEYS = ["start", "product", "workflow", "security"] as const;
const FAQ_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export default function SupportPage() {
  const t = useTranslations("support");
  const containerRef = useRef<HTMLDivElement>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
  const wechatId = t("contact.wechatId");

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {t("hero.eyebrow")}
        </p>
        <h1 className="mt-4 text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          {t("hero.title")}
        </h1>
      </section>

      {/* Documentation paths */}
      <section className="support-section mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("docs.title")}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {DOC_KEYS.map((key) => (
            <div
              key={key}
              className="group relative rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-6 transition-shadow hover:shadow-md"
            >
              <span className="absolute right-4 top-4 rounded-[var(--radius-full)] bg-[var(--bg-raised)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                {t("docs.comingSoon")}
              </span>
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

      {/* FAQ — accordion */}
      <section id="faq" className="support-section bg-[var(--bg-surface)] px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("faq.title")}</h2>
          <div className="mt-8 flex flex-col gap-1">
            {FAQ_INDICES.map((i) => {
              const isOpen = openFaq === i;
              return (
                <div
                  key={i}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)]"
                >
                  <button
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    aria-expanded={isOpen}
                  >
                    <span className="font-semibold text-[var(--text-primary)]">{t(`faq.q${i}`)}</span>
                    <svg
                      className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div
                    className={`overflow-hidden transition-[max-height,opacity] duration-300 ${isOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}
                  >
                    <p className="px-5 pb-4 text-sm text-[var(--text-secondary)]">{t(`faq.a${i}`)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="support-section mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t("contact.title")}</h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          {t("contact.response")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-2 rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {email}
          </a>
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-full)] border border-[var(--border)] px-8 py-3 text-sm font-medium text-[var(--text-primary)]">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05a5.79 5.79 0 01-.271-1.737c0-3.08 2.846-5.608 6.437-5.608.296 0 .588.013.876.042C15.73 5.252 12.563 2.188 8.691 2.188zM12.5 11.338c3.107 0 5.5 2.11 5.5 4.662 0 2.553-2.393 4.662-5.5 4.662a7.03 7.03 0 01-2.14-.332.629.629 0 00-.52.07l-1.374.804a.236.236 0 01-.12.039.213.213 0 01-.21-.213c0-.052.02-.103.034-.154l.282-1.07a.428.428 0 00-.155-.48C6.96 18.205 6 16.666 6 15c0-2.553 2.893-3.662 6.5-3.662z" />
            </svg>
            {t("contact.wechat")}: {wechatId}
          </span>
        </div>
      </section>
    </div>
  );
}
