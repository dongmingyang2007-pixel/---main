"use client";

import { useState, useCallback } from "react";
import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HomeIcon, ChatIcon, MemoryIcon, DevicesIcon, DiscoverIcon } from "./NavIcons";

interface NavItem {
  href: string;
  key: string;
  Icon: () => JSX.Element;
}

/* ── Icons ── */

function SettingsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ── Nav items ── */

const NAV_ITEMS: NavItem[] = [
  { href: "/app", key: "nav.home", Icon: HomeIcon },
  { href: "/app/chat", key: "nav.chat", Icon: ChatIcon },
  { href: "/app/memory", key: "nav.memory", Icon: MemoryIcon },
  { href: "/app/devices", key: "nav.devices", Icon: DevicesIcon },
  { href: "/app/discover", key: "nav.discover", Icon: DiscoverIcon },
];

/* ── Component ── */

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("console");
  const { projects } = useProjectContext();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const displayMap = buildProjectDisplayMap(projects);

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  };

  const handleExpand = useCallback(() => {
    if (isClosing) return;
    setIsVisible(true);
    setIsExpanded(true);
    // Trigger entering → open animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsExpanded(true);
      });
    });
  }, [isClosing]);

  const handleCollapse = useCallback(() => {
    setIsClosing(true);
    // Wait for closing animation to finish, then unmount
    setTimeout(() => {
      setIsExpanded(false);
      setIsVisible(false);
      setIsClosing(false);
    }, 200);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      {/* Collapsed sidebar -- always visible */}
      <nav
        className={clsx("glass-sidebar", "glass-sidebar--collapsed")}
        role="navigation"
        aria-label="Main"
        onMouseEnter={handleExpand}
      >
        {/* Logo */}
        <div className="glass-sidebar-logo">铭</div>

        {/* Nav items */}
        <div className="glass-sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  prefetch={false}
                  className={clsx("glass-sidebar-nav-item", isActive(item.href) && "is-active")}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <span className="glass-sidebar-icon">
                    <item.Icon />
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(item.key)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Settings */}
        <div className="glass-sidebar-footer">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/app/settings"
                prefetch={false}
                className={clsx("glass-sidebar-nav-item", isActive("/app/settings") && "is-active")}
                aria-current={isActive("/app/settings") ? "page" : undefined}
              >
                <span className="glass-sidebar-icon">
                  <SettingsIcon />
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t("nav.settings")}
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>

      {/* Expanded overlay sidebar — always mounted when visible, animated */}
      {isVisible && (
        <>
          {/* Backdrop overlay */}
          <div
            className={clsx("glass-sidebar-overlay", isClosing && "glass-sidebar-overlay--closing")}
            onClick={handleCollapse}
            aria-hidden="true"
          />

          {/* Expanded sidebar */}
          <nav
            className={clsx(
              "glass-sidebar",
              "glass-sidebar--expanded",
              isClosing && "glass-sidebar--closing",
              !isClosing && !isExpanded && "glass-sidebar--entering"
            )}
            role="navigation"
            aria-label="Main expanded"
            onMouseLeave={handleCollapse}
          >
            {/* Header */}
            <div className="glass-sidebar-header">
              <div className="glass-sidebar-logo">铭</div>
              <div className="glass-sidebar-header-text">
                <div className="glass-sidebar-brand">铭润科技</div>
                <div className="glass-sidebar-subtitle">Personal AI Studio</div>
              </div>
            </div>

            {/* Full nav items */}
            <div className="glass-sidebar-nav-full">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={clsx("glass-sidebar-nav-item-full", isActive(item.href) && "is-active")}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  onClick={handleCollapse}
                >
                  <span className="glass-sidebar-icon">
                    <item.Icon />
                  </span>
                  <span className="glass-sidebar-label">{t(item.key)}</span>
                </Link>
              ))}
            </div>

            {/* Divider */}
            <div className="glass-sidebar-divider" />

            {/* Projects section */}
            <div className="glass-sidebar-projects">
              <div className="glass-sidebar-projects-title">
                Projects
                {projects.length > 0 && (
                  <span className="glass-sidebar-projects-count">{projects.length}</span>
                )}
              </div>
              <div className="glass-sidebar-projects-list">
                {projects.length === 0 ? (
                  <div className="glass-sidebar-projects-empty">No projects yet</div>
                ) : (
                  projects.map((project) => (
                    <div key={project.id} className="glass-sidebar-project-item">
                      <span className="glass-sidebar-project-icon">
                        <FolderIcon />
                      </span>
                      <span className="glass-sidebar-project-name">
                        {displayMap.get(project.id) ?? project.name}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="glass-sidebar-footer-full">
              <Link
                href="/app/settings"
                prefetch={false}
                className={clsx("glass-sidebar-nav-item-full", isActive("/app/settings") && "is-active")}
                aria-current={isActive("/app/settings") ? "page" : undefined}
                onClick={handleCollapse}
              >
                <span className="glass-sidebar-icon">
                  <SettingsIcon />
                </span>
                <span className="glass-sidebar-label">{t("nav.settings")}</span>
              </Link>
            </div>
          </nav>
        </>
      )}
    </TooltipProvider>
  );
}
