"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { DOCS_PATH_RAIL } from "@/lib/public-story-content";

const FAQ_ITEMS = [
  { q: "QIHANG 支持哪些设备？", a: "目前支持 QIHANG 圆盘盒系列。更多设备适配即将推出。" },
  { q: "数据安全如何保障？", a: "所有数据加密传输和存储，支持离线模式下完全本地处理。" },
  { q: "训练任务需要多久？", a: "取决于数据集规模。典型任务 5-30 分钟，可在控制台实时查看进度。" },
  { q: "如何开始使用？", a: "访问 Demo 页面即可免费体验核心功能，无需注册。" },
];

export default function SupportPage() {
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
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Support
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          文档、常见问题和联系方式。
        </p>
      </section>

      {/* Documentation paths */}
      <section className="support-section mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Documentation</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {DOCS_PATH_RAIL.map((item) => (
            <div
              key={item.title}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            >
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {item.label}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                {item.title}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="support-section bg-[var(--bg-surface)] px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">FAQ</h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q}>
                <h3 className="font-semibold text-[var(--text-primary)]">{item.q}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="support-section mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Contact</h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          有问题或合作意向？发邮件给我们。
        </p>
        <a
          href="mailto:hello@qihang.ai"
          className="mt-6 inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          hello@qihang.ai
        </a>
      </section>
    </div>
  );
}
