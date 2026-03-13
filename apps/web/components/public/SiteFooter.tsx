"use client";

import { useState } from "react";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/product#specs", label: "Specs" },
      { href: "/product#craftsmanship", label: "Craftsmanship" },
    ],
  },
  {
    title: "AI Ecosystem",
    links: [
      { href: "/ecosystem", label: "Platform" },
      { href: "/demo", label: "Online Demo" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/support", label: "Documentation" },
      { href: "/support#faq", label: "FAQ" },
      { href: "/support#contact", label: "Contact" },
    ],
  },
  {
    title: "About",
    links: [
      { href: "/updates", label: "Updates" },
      { href: "mailto:hello@qihang.ai", label: "Email" },
    ],
  },
];

export function SiteFooter() {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (title: string) =>
    setOpenSection((prev) => (prev === title ? null : title));

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] py-12">
      <div className="mx-auto grid max-w-[var(--site-width)] gap-8 px-6 md:grid-cols-4">
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            {/* Desktop: always open. Mobile: accordion */}
            <button
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--text-primary)] md:cursor-default md:pointer-events-none"
              onClick={() => toggle(col.title)}
              aria-expanded={openSection === col.title}
            >
              {col.title}
              <svg
                className={`h-4 w-4 transition-transform md:hidden ${
                  openSection === col.title ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <ul
              className={`mt-3 flex flex-col gap-2 overflow-hidden transition-[max-height] duration-300 md:max-h-none ${
                openSection === col.title ? "max-h-40" : "max-h-0 md:max-h-none"
              }`}
            >
              {col.links.map((link) => (
                <li key={link.href}>
                  <PublicDocumentLink
                    href={link.href}
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {link.label}
                  </PublicDocumentLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="mx-auto mt-12 flex max-w-[var(--site-width)] flex-col items-center justify-between gap-4 border-t border-[var(--border)] px-6 pt-8 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
          <strong className="text-sm font-semibold">QIHANG</strong>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          &copy; 2026 QIHANG. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
