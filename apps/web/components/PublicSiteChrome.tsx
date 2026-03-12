"use client";

import clsx from "clsx";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { useScrollNav } from "@/lib/useScrollNav";

const NAV_ITEMS = [
  { href: "/product", label: "产品" },
  { href: "/how-it-works", label: "工作原理" },
  { href: "/demo", label: "Demo" },
  { href: "/pricing", label: "定价" },
  { href: "/contact", label: "联系" },
];

function SmartLink({
  href,
  children,
  className,
  active = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  const ariaCurrent: "page" | undefined = active ? "page" : undefined;
  const sharedProps = {
    className: clsx(className),
    "aria-current": ariaCurrent,
  };

  return (
    <PublicDocumentLink href={href} {...sharedProps}>
      {children}
    </PublicDocumentLink>
  );
}

export function PublicSiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { scrolled, hidden, progress } = useScrollNav();

  return (
    <div className="site-shell">
      <div className="site-container">
        <header
          className={clsx(
            "site-header",
            scrolled && "is-scrolled",
            hidden && "is-hidden",
          )}
        >
          <div className="site-nav">
            <SmartLink href="/" className="site-brand-mark" active={pathname === "/"}>
              <span className="site-brand-dot" />
              <span>
                <strong className="display-face text-[1.05rem]">QIHANG</strong>
                <span className="ml-2 text-sm text-[var(--muted)]">环境 AI</span>
              </span>
            </SmartLink>
            <nav className="site-nav-links">
              {NAV_ITEMS.map((item) => (
                <SmartLink
                  key={item.href}
                  href={item.href}
                  active={pathname === item.href}
                  className="site-nav-link"
                >
                  {item.label}
                </SmartLink>
              ))}
              <SmartLink href="/login" className="site-nav-cta">
                控制台
              </SmartLink>
            </nav>
          </div>

          {/* Scroll progress indicator */}
          <div
            className="site-nav-progress"
            style={{ "--nav-progress": progress } as React.CSSProperties}
            aria-hidden="true"
          />
        </header>

        <main className="site-main">{children}</main>

        <footer className="site-footer" data-reveal="fade">
          <div className="site-footer-panel">
            <div>© 2026 QIHANG</div>
            <div>离线优先的环境 AI 工作台</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
