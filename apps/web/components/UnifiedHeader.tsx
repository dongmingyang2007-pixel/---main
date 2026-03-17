"use client";

import { useSyncExternalStore } from "react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useScrollNav } from "@/lib/useScrollNav";
import {
  getAuthStateServerSnapshot,
  getAuthStateSnapshot,
  subscribeAuthState,
} from "@/lib/auth-state";
import { logout } from "@/lib/api";
import { useMobileMenu } from "@/components/MobileMenuProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_KEYS = [
  { href: "/product", key: "nav.product" },
  { href: "/ecosystem", key: "nav.ecosystem" },
  { href: "/demo", key: "nav.demo" },
  { href: "/pricing", key: "nav.pricing" },
  { href: "/support", key: "nav.support" },
] as const;

function UserAvatarDropdown({ isConsole }: { isConsole: boolean }) {
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-surface)] transition-colors hover:bg-[var(--border)]"
        aria-label={t("user.settings")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {isConsole ? (
          <DropdownMenuItem asChild>
            <Link href="/">{t("user.backToSite")}</Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href="/app">{t("user.enterConsole")}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/app/settings">{t("user.settings")}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void logout()}
          className="text-red-500 focus:text-red-400"
        >
          {t("user.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UnifiedHeader() {
  const t = useTranslations("common");
  const pathname = usePathname();

  // Determine mode from pathname
  const isConsole = pathname === "/app" || pathname.startsWith("/app/");

  const { openMenu } = useMobileMenu();
  // CRITICAL: call hook unconditionally to satisfy Rules of Hooks.
  // In console mode we simply ignore the returned values.
  const { scrolled, hidden, progress } = useScrollNav();

  const loggedIn = useSyncExternalStore(
    subscribeAuthState,
    getAuthStateSnapshot,
    getAuthStateServerSnapshot,
  );

  const navItems = NAV_KEYS.map((item) => ({
    href: item.href,
    label: t(item.key),
  }));

  return (
    <header
      className={clsx(
        "site-header-v2",
        isConsole && "is-console",
        !isConsole && scrolled && "is-scrolled",
        !isConsole && hidden && "is-hidden",
      )}
    >
      <div className="mx-auto flex h-full max-w-[var(--site-width)] items-center justify-between px-6">
        {/* ── Left: Brand ── */}
        <div className="flex items-center gap-2">
          <PublicDocumentLink href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
            <strong className="text-base font-semibold tracking-tight">
              {t("brand.company")}
            </strong>
          </PublicDocumentLink>
          {isConsole && (
            <span className="ml-1 rounded-[var(--radius-full)] border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
              {t("nav.consoleBadge")}
            </span>
          )}
        </div>

        {/* ── Center: Nav links (public only) ── */}
        {!isConsole && (
          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <PublicDocumentLink
                key={item.href}
                href={item.href}
                className={clsx(
                  "site-nav-link-v2 text-sm transition-colors",
                  pathname === item.href
                    ? "text-[var(--brand-v2)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--brand-v2)]",
                )}
              >
                {item.label}
                {pathname === item.href && (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[var(--brand-v2)]" />
                )}
              </PublicDocumentLink>
            ))}
          </nav>
        )}

        {/* ── Right: Actions ── */}
        <div className="hidden items-center gap-4 md:flex">
          <LanguageSwitcher
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          />
          {loggedIn ? (
            <UserAvatarDropdown isConsole={isConsole} />
          ) : (
            !isConsole && (
              <PublicDocumentLink
                href="/login"
                className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {t("user.login")}
              </PublicDocumentLink>
            )
          )}
        </div>

        {/* ── Mobile hamburger ── */}
        <button
          className="flex items-center justify-center p-2.5 md:hidden"
          onClick={openMenu}
          aria-label={t("nav.openMenu")}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* ── Progress bar (public only) ── */}
      {!isConsole && (
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--brand-v2)] transition-none"
          style={{ width: `${progress * 100}%` }}
          aria-hidden="true"
        />
      )}
    </header>
  );
}
