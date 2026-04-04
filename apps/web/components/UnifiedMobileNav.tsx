"use client";

import { useEffect, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { DISCOVER_ENABLED } from "@/lib/feature-flags";
import {
  getAuthStateServerSnapshot,
  getAuthStateSnapshot,
  subscribeAuthState,
} from "@/lib/auth-state";
import { logout } from "@/lib/api";
import { useMobileMenu } from "@/components/MobileMenuProvider";

interface UnifiedMobileNavProps {
  mode: "public" | "console";
}

const PUBLIC_NAV_KEYS = [
  { href: "/product", key: "nav.product" },
  { href: "/ecosystem", key: "nav.ecosystem" },
  { href: "/demo", key: "nav.demo" },
  { href: "/pricing", key: "nav.pricing" },
  { href: "/support", key: "nav.support" },
] as const;

const CONSOLE_NAV_ITEMS = [
  { href: "/app", navKey: "home" },
  { href: "/app/assistants", navKey: "assistants" },
  { href: "/app/chat", navKey: "chat" },
  { href: "/app/memory", navKey: "memory" },
  { href: "/app/devices", navKey: "devices" },
  ...(DISCOVER_ENABLED ? [{ href: "/app/discover", navKey: "discover" }] : []),
  { href: "/app/settings", navKey: "settings" },
] as const;

export function UnifiedMobileNav({ mode }: UnifiedMobileNavProps) {
  const { open, closeMenu } = useMobileMenu();
  const pathname = usePathname();
  const tCommon = useTranslations("common");
  const tConsole = useTranslations("console");
  const loggedIn = useSyncExternalStore(
    subscribeAuthState,
    getAuthStateSnapshot,
    getAuthStateServerSnapshot,
  );

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isConsoleActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  const handleLogout = async () => {
    closeMenu();
    await logout();
  };

  const brandName =
    mode === "console" ? tConsole("brand") : tCommon("brand.company");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col bg-white/85 backdrop-blur-xl"
          style={{ WebkitBackdropFilter: "blur(20px)" }}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black/[0.06]">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {brandName}
            </span>
            <button
              onClick={closeMenu}
              className="p-2 text-[var(--console-text-muted,var(--text-secondary))] hover:text-[var(--text-primary)]"
              aria-label={tCommon("nav.closeMenu")}
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

          {/* Nav Items */}
          {mode === "public" ? (
            <nav className="flex flex-col gap-1 p-4">
              {PUBLIC_NAV_KEYS.map((item) => (
                <PublicDocumentLink
                  key={item.href}
                  href={item.href}
                  onClick={closeMenu}
                  className={clsx(
                    "flex items-center rounded-lg px-4 py-3 text-sm transition-colors",
                    pathname === item.href
                      ? "bg-[var(--console-accent-soft,var(--brand-soft))] text-[var(--console-accent,var(--brand-v2))] font-medium"
                      : "text-[var(--console-text-muted,var(--text-secondary))] hover:bg-black/[0.03] hover:text-[var(--text-primary)]",
                  )}
                >
                  {tCommon(item.key)}
                </PublicDocumentLink>
              ))}
            </nav>
          ) : (
            <nav className="flex flex-col gap-1 p-4">
              {CONSOLE_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMenu}
                  className={clsx(
                    "flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors",
                    isConsoleActive(item.href)
                      ? "bg-[var(--console-accent-soft,var(--brand-soft))] text-[var(--console-accent,var(--brand-v2))] font-medium"
                      : "text-[var(--console-text-muted,var(--text-secondary))] hover:bg-black/[0.03] hover:text-[var(--text-primary)]",
                  )}
                >
                  <span>{tConsole(`nav.${item.navKey}`)}</span>
                  <span className="text-xs opacity-60">
                    {tConsole(`mobile.${item.navKey}.meta`)}
                  </span>
                </Link>
              ))}
            </nav>
          )}

          {/* Auth Section */}
          <div className="px-4 pb-2">
            <div className="border-t border-black/[0.06] pt-4 flex flex-col gap-1">
              {loggedIn ? (
                <>
                  <Link
                    href="/app/settings"
                    onClick={closeMenu}
                    className="flex items-center rounded-lg px-4 py-3 text-sm text-[var(--console-text-muted,var(--text-secondary))] hover:bg-black/[0.03] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {tCommon("user.settings")}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center rounded-lg px-4 py-3 text-sm text-[var(--console-text-muted,var(--text-secondary))] hover:bg-black/[0.03] hover:text-[var(--text-primary)] transition-colors text-left"
                  >
                    {tCommon("user.logout")}
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="flex items-center rounded-lg px-4 py-3 text-sm text-[var(--console-text-muted,var(--text-secondary))] hover:bg-black/[0.03] hover:text-[var(--text-primary)] transition-colors"
                >
                  {tCommon("user.login")}
                </Link>
              )}
            </div>
          </div>

          {/* Footer */}
          {mode === "console" && (
            <div className="mt-auto p-4 border-t border-black/[0.06]">
              <Link
                href="/"
                onClick={closeMenu}
                className="block text-center text-sm text-[var(--console-text-muted,var(--text-secondary))] hover:text-[var(--text-primary)]"
              >
                {tCommon("user.backToSite")}
              </Link>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
