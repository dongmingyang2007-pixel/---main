"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/app", navKey: "dashboard" },
  { href: "/app/projects", navKey: "projects" },
  { href: "/app/datasets", navKey: "datasets" },
  { href: "/app/train", navKey: "train" },
  { href: "/app/models", navKey: "models" },
  { href: "/app/eval", navKey: "eval" },
  { href: "/app/settings", navKey: "settings" },
];

interface MobileConsoleNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileConsoleNav({ open, onClose }: MobileConsoleNavProps) {
  const pathname = usePathname();
  const t = useTranslations("console");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-base)]"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t("brand")}
            </span>
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              aria-label={t("topbar.openMenu")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col gap-1 p-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={clsx(
                  "flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors",
                  isActive(item.href)
                    ? "bg-[var(--brand-soft)] text-[var(--brand-v2)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                )}
              >
                <span>{t(`nav.${item.navKey}`)}</span>
                <span className="text-xs opacity-60">{t(`mobile.${item.navKey}.meta`)}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto p-4 border-t border-[var(--border)]">
            <Link
              href="/"
              onClick={onClose}
              className="block text-center text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t("nav.backToSite")}
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
