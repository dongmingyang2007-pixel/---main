"use client";

import { useState, useCallback } from "react";
import clsx from "clsx";
import { usePathname } from "next/navigation";

import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { MobileNav } from "@/components/public/MobileNav";
import { useScrollNav } from "@/lib/useScrollNav";

const NAV_ITEMS = [
  { href: "/product", label: "Product" },
  { href: "/ecosystem", label: "AI Ecosystem" },
  { href: "/demo", label: "Demo" },
  { href: "/pricing", label: "Pricing" },
  { href: "/support", label: "Support" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { scrolled, hidden, progress } = useScrollNav();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

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
          {/* Brand */}
          <PublicDocumentLink href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
            <strong className="text-base font-semibold tracking-tight">QIHANG</strong>
          </PublicDocumentLink>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-8 md:flex">
            {NAV_ITEMS.map((item) => (
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
            <PublicDocumentLink
              href="/demo"
              className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Get Started
            </PublicDocumentLink>
          </nav>

          {/* Hamburger (mobile) */}
          <button
            className="flex items-center justify-center p-2 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Scroll progress indicator */}
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--brand-v2)] transition-none"
          style={{ width: `${progress * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <MobileNav
        open={mobileOpen}
        onClose={closeMobile}
        items={NAV_ITEMS}
        pathname={pathname}
      />
    </>
  );
}
