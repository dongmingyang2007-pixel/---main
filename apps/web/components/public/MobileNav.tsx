"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  items: { href: string; label: string }[];
  pathname: string;
}

export function MobileNav({ open, onClose, items, pathname }: MobileNavProps) {
  const t = useTranslations("common");
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-base)]"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Close button */}
          <div className="flex justify-end p-6">
            <button
              onClick={onClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-2.5"
              aria-label={t("nav.closeMenu")}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Nav links */}
          <nav className="flex flex-col items-center gap-8 pt-12">
            {items.map((item) => (
              <PublicDocumentLink
                key={item.href}
                href={item.href}
                className={`text-2xl font-medium transition-colors ${
                  pathname === item.href
                    ? "text-[var(--brand-v2)]"
                    : "text-[var(--text-primary)]"
                }`}
                onClick={onClose}
              >
                {item.label}
              </PublicDocumentLink>
            ))}
          </nav>

          {/* Bottom CTA */}
          <div className="mt-auto p-8">
            <PublicDocumentLink
              href="/demo"
              className="block w-full rounded-[var(--radius-lg)] bg-[var(--brand-v2)] py-4 text-center text-lg font-semibold text-white"
              onClick={onClose}
            >
              {t("nav.tryDemo")}
            </PublicDocumentLink>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
