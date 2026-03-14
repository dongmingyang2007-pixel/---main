"use client";

import { useState, useCallback } from "react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { MobileNav } from "@/components/public/MobileNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useScrollNav } from "@/lib/useScrollNav";

const NAV_KEYS = [
  { href: "/product", key: "nav.product" },
  { href: "/ecosystem", key: "nav.ecosystem" },
  { href: "/demo", key: "nav.demo" },
  { href: "/pricing", key: "nav.pricing" },
  { href: "/support", key: "nav.support" },
] as const;

export function SiteHeader() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const { scrolled, hidden, progress } = useScrollNav();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const navItems = NAV_KEYS.map((item) => ({
    href: item.href,
    label: t(item.key),
  }));

  return (
    <>
      <header
        className={clsx(
          "site-header-v2",
          scrolled && "is-scrolled",
          hidden && "is-hidden",
        )}
      >
        <div className="mx-auto flex h-full max-w-[var(--site-width)] items-center justify-between px-6">
          <PublicDocumentLink href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
            <strong className="text-base font-semibold tracking-tight">
              {t("brand.company")}
            </strong>
          </PublicDocumentLink>

          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <PublicDocumentLink
                key={item.href}
                href={item.href}
                className={clsx(
                  "site-nav-link-v2 text-sm transition-colors",
                  pathname === item.href
                    ? "text-[var(--brand-v2)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {item.label}
                {pathname === item.href && (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[var(--brand-v2)]" />
                )}
              </PublicDocumentLink>
            ))}
            <LanguageSwitcher className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" />
            <PublicDocumentLink
              href="/demo"
              className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {t("nav.getStarted")}
            </PublicDocumentLink>
          </nav>

          <button
            className="flex items-center justify-center p-2.5 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t("nav.openMenu")}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--brand-v2)] transition-none"
          style={{ width: `${progress * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <MobileNav
        open={mobileOpen}
        onClose={closeMobile}
        items={navItems}
        pathname={pathname}
      />
    </>
  );
}
