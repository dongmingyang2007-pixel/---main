"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";

export function SiteFooter() {
  const t = useTranslations("common");
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (title: string) =>
    setOpenSection((prev) => (prev === title ? null : title));

  const columns = [
    {
      titleKey: "footer.product",
      links: [
        { href: "/product", labelKey: "footer.product.overview" },
        { href: "/product#specs", labelKey: "footer.product.specs" },
        { href: "/product#craftsmanship", labelKey: "footer.product.craftsmanship" },
      ],
    },
    {
      titleKey: "footer.ecosystem",
      links: [
        { href: "/ecosystem", labelKey: "footer.ecosystem.platform" },
        { href: "/demo", labelKey: "footer.ecosystem.demo" },
        { href: "/pricing", labelKey: "footer.ecosystem.pricing" },
      ],
    },
    {
      titleKey: "footer.support",
      links: [
        { href: "/support", labelKey: "footer.support.docs" },
        { href: "/support#faq", labelKey: "footer.support.faq" },
        { href: "/support#contact", labelKey: "footer.support.contact" },
      ],
    },
    {
      titleKey: "footer.about",
      links: [
        { href: "/updates", labelKey: "footer.about.updates" },
        { href: "mailto:hello@mingrun-tech.com", labelKey: "footer.about.email" },
      ],
    },
  ];

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] py-12">
      <div className="mx-auto grid max-w-[var(--site-width)] gap-8 px-6 md:grid-cols-4">
        {columns.map((col) => {
          const title = t(col.titleKey);
          return (
            <div key={col.titleKey}>
              <button
                className="flex w-full items-center justify-between text-sm font-semibold text-[var(--text-primary)] md:cursor-default md:pointer-events-none"
                onClick={() => toggle(col.titleKey)}
                aria-expanded={openSection === col.titleKey}
              >
                {title}
                <svg
                  className={`h-4 w-4 transition-transform md:hidden ${
                    openSection === col.titleKey ? "rotate-180" : ""
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
                  openSection === col.titleKey ? "max-h-40" : "max-h-0 md:max-h-none"
                }`}
              >
                {col.links.map((link) => (
                  <li key={link.href}>
                    <PublicDocumentLink
                      href={link.href}
                      className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {t(link.labelKey)}
                    </PublicDocumentLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-12 flex max-w-[var(--site-width)] flex-col items-center justify-between gap-4 border-t border-[var(--border)] px-6 pt-8 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
          <strong className="text-sm font-semibold">{t("brand.company")}</strong>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("footer.copyright")}
        </p>
      </div>
    </footer>
  );
}
