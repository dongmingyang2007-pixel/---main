# Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the console from an ML engineering platform into an AI assistant workshop with warm cream visual theme, three-column navigation, wizard creation flow, and progressive disclosure for expert users.

**Architecture:** Frontend-only redesign. All backend API endpoints, database schema, and infrastructure remain unchanged. New CSS design tokens replace the dark theme. Console shell rebuilt with three-column layout (icon bar + collapsible list panel + main content). Routes renamed from ML terminology (projects/datasets/train) to user-friendly language (assistants/knowledge/training). New pages: creation wizard, canvas workbench, chat debug (mock).

**Tech Stack:** Next.js 16 App Router, TypeScript, TailwindCSS + CSS variables, shadcn/ui, Framer Motion, next-intl, DM Sans (via next/font/google)

**Spec:** `docs/superpowers/specs/2026-03-15-console-redesign-design.md`

---

## Chunk 1: Design Foundation (Theme, Typography, Shell Layout)

### Task 1: Replace Console CSS Theme Variables

**Files:**
- Modify: `apps/web/styles/globals.css` (lines 140-173, console theme block)

- [ ] **Step 1: Write visual regression test**

Create a basic test that verifies the console theme loads correctly.

```typescript
// apps/web/tests/console-theme.spec.ts
import { test, expect } from "@playwright/test";

test("console loads with warm cream theme", async ({ page }) => {
  // Navigate to console (will redirect to login if not authed, that's fine for theme check)
  await page.goto("/zh/app/assistants");
  // The root element should have data-theme="console"
  const root = page.locator("[data-theme='console']");
  // Check that CSS variables are set to warm cream values
  const bgBase = await root.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--bg-base").trim()
  );
  expect(bgBase).toBe("#f5f0eb");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx playwright test tests/console-theme.spec.ts --headed`
Expected: FAIL (current --bg-base is #020617)

- [ ] **Step 3: Replace console CSS variables in globals.css**

Find the `[data-theme="console"]` block (around line 140) and replace all variables:

```css
[data-theme="console"] {
  --bg-base: #f5f0eb;
  --bg-surface: #faf7f4;
  --bg-card: #ffffff;
  --bg-raised: #ffffff;
  --border: #e8e0d8;
  --border-light: #ede6de;
  --accent: #c8734a;
  --accent-gradient: linear-gradient(135deg, #c8734a, #e8925a);
  --accent-soft: rgba(200, 115, 74, 0.1);
  --text-primary: #2a2018;
  --text-secondary: #9a8a7a;
  --text-muted: #b0a090;
  --success: #2a8a5a;
  --success-soft: rgba(42, 138, 90, 0.08);
  --warning: #d4923a;
  --warning-soft: rgba(212, 146, 58, 0.1);
  --error: #c44a4a;
  --error-soft: rgba(196, 74, 74, 0.08);

  /* Radii */
  --radius-card: 14px;
  --radius-button: 9px;
  --radius-badge: 6px;
  --radius-input: 10px;

  /* Shadows (warm-toned) */
  --shadow-card: 0 2px 8px rgba(42, 32, 24, 0.04);
  --shadow-raised: 0 4px 16px rgba(42, 32, 24, 0.08);
  --shadow-dialog: 0 8px 32px rgba(42, 32, 24, 0.12);

  /* Typography */
  --font-title: var(--font-dm-sans), "PingFang SC", "Noto Sans SC", sans-serif;
  --font-body: "PingFang SC", "Noto Sans SC", -apple-system, sans-serif;
  --font-mono: var(--font-mono), "JetBrains Mono", monospace;
}
```

Also remove `dark` class from console layout (since we're going light theme).

- [ ] **Step 4: Update globals.css console component classes for light theme**

Update all `.console-*` classes that reference old color variables. Key changes:
- `.console-panel`: change `background: var(--bg-surface)` → `background: var(--bg-card)`, add `box-shadow: var(--shadow-card)`
- `.console-button`: change `background: var(--brand-v2)` → `background: var(--accent)`, update shadow
- `.console-button-danger`: change gradient to use `--error`
- `.console-input`, `.console-select`, `.console-textarea`: update border, background to light values
- All text color references: update from old vars to new `--text-primary`, `--text-secondary`, `--text-muted`

- [ ] **Step 5: Remove dark class from console layout**

In `apps/web/app/[locale]/(console)/layout.tsx`, remove the `useEffect` that adds `dark` class to `document.documentElement`, since console is now light theme.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx playwright test tests/console-theme.spec.ts --headed`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/styles/globals.css apps/web/app/[locale]/(console)/layout.tsx apps/web/tests/console-theme.spec.ts
git commit -m "feat(console): replace dark theme with warm cream light theme"
```

---

### Task 2: Add DM Sans Font

**Files:**
- Modify: `apps/web/app/[locale]/layout.tsx` (font imports, line ~10-25)

- [ ] **Step 1: Add DM Sans import alongside existing fonts**

In `apps/web/app/[locale]/layout.tsx`, add:

```typescript
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
```

- [ ] **Step 2: Mount the font variable on the html element**

In the same file, add `dmSans.variable` to the `<html>` className alongside existing font variables:

```tsx
<html lang={locale} className={`${inter.variable} ${jetBrainsMono.variable} ${dmSans.variable}`}>
```

- [ ] **Step 3: Verify font loads**

Run: `cd apps/web && npm run dev`
Open browser devtools on a console page → check computed styles → `--font-dm-sans` should resolve to the DM Sans font family.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/layout.tsx
git commit -m "feat(console): add DM Sans font for brand typography"
```

---

### Task 3: Build New Console Shell (Three-Column Layout)

**Files:**
- Create: `apps/web/components/console/IconBar.tsx`
- Create: `apps/web/components/console/ListPanel.tsx`
- Create: `apps/web/components/console/ConsoleTopBar.tsx`
- Modify: `apps/web/components/console/ConsoleShell.tsx`
- Modify: `apps/web/styles/globals.css` (add new shell classes)

- [ ] **Step 1: Create IconBar component**

```typescript
// apps/web/components/console/IconBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  key: string;
  href: string;
  icon: React.ReactNode;
  position: "top" | "bottom";
}

// SVG icons defined as components for cleanliness
const icons = {
  assistants: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
    </svg>
  ),
  knowledge: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    </svg>
  ),
  training: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  chat: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
    </svg>
  ),
  devices: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
};

const NAV_ITEMS: NavItem[] = [
  { key: "assistants", href: "/app/assistants", icon: icons.assistants, position: "top" },
  { key: "knowledge", href: "/app/knowledge", icon: icons.knowledge, position: "top" },
  { key: "training", href: "/app/training", icon: icons.training, position: "top" },
  { key: "chat", href: "/app/chat", icon: icons.chat, position: "top" },
  { key: "devices", href: "/app/devices", icon: icons.devices, position: "bottom" },
  { key: "settings", href: "/app/settings", icon: icons.settings, position: "bottom" },
];

export function IconBar() {
  const pathname = usePathname();
  const t = useTranslations("console");

  const isActive = (href: string) => {
    const stripped = pathname.replace(/^\/(zh|en)/, "");
    return stripped === href || stripped.startsWith(href + "/");
  };

  const topItems = NAV_ITEMS.filter((i) => i.position === "top");
  const bottomItems = NAV_ITEMS.filter((i) => i.position === "bottom");

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="icon-bar" aria-label="Console navigation">
        <div className="icon-bar-top">
          {topItems.map((item) => (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={`icon-bar-item ${isActive(item.href) ? "is-active" : ""}`}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  aria-label={t(`nav.${item.key}`)}
                >
                  {item.icon}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(`nav.${item.key}`)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="icon-bar-bottom">
          {bottomItems.map((item) => (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={`icon-bar-item ${isActive(item.href) ? "is-active" : ""}`}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  aria-label={t(`nav.${item.key}`)}
                >
                  {item.icon}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(`nav.${item.key}`)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Create ListPanel component**

```typescript
// apps/web/components/console/ListPanel.tsx
"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

interface ListPanelProps {
  children: React.ReactNode;
}

export function ListPanel({ children }: ListPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Persist collapsed state
  useEffect(() => {
    const saved = localStorage.getItem("console-list-panel-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("console-list-panel-collapsed", String(next));
  };

  return (
    <aside
      className={`list-panel ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Context list"
    >
      {!collapsed && (
        <div className="list-panel-content">
          {children}
        </div>
      )}
      <button
        className="list-panel-toggle"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? (
            <polyline points="9 18 15 12 9 6" />
          ) : (
            <polyline points="15 18 9 12 15 6" />
          )}
        </svg>
      </button>
    </aside>
  );
}
```

- [ ] **Step 3: Create ConsoleTopBar component**

```typescript
// apps/web/components/console/ConsoleTopBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isLoggedIn, logout } from "@/lib/auth-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Breadcrumb segment mapping (route segment → i18n key)
const SEGMENT_MAP: Record<string, string> = {
  app: "",
  assistants: "nav.assistants",
  knowledge: "nav.knowledge",
  training: "nav.training",
  chat: "nav.chat",
  devices: "nav.devices",
  settings: "nav.settings",
  new: "breadcrumb.new",
  versions: "breadcrumb.versions",
};

export function ConsoleTopBar() {
  const pathname = usePathname();
  const t = useTranslations("console");

  // Build breadcrumb from pathname
  const stripped = pathname.replace(/^\/(zh|en)/, "");
  const segments = stripped.split("/").filter(Boolean);

  const crumbs = segments
    .map((seg, i) => {
      const href = "/" + segments.slice(0, i + 1).join("/");
      const isUuid = /^[0-9a-f]{8}-/.test(seg);
      const label = isUuid
        ? seg.slice(0, 8) + "…"
        : SEGMENT_MAP[seg]
          ? t(SEGMENT_MAP[seg])
          : seg;
      return { label, href, isLast: i === segments.length - 1 };
    })
    .filter((c) => c.label); // filter out empty (like "app" root)

  return (
    <header className="console-topbar">
      <div className="console-topbar-left">
        <Link href="/app/assistants" className="console-topbar-brand">
          <div className="console-topbar-logo" />
          <span className="console-topbar-brand-text">铭润</span>
        </Link>
        {crumbs.length > 0 && (
          <nav className="console-topbar-breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span key={crumb.href}>
                <span className="console-topbar-sep">/</span>
                {crumb.isLast ? (
                  <span className="console-topbar-crumb is-current">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="console-topbar-crumb">
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>
      <div className="console-topbar-right">
        <kbd className="console-topbar-kbd">⌘K</kbd>
        <Link href={pathname.startsWith("/en") ? pathname.replace("/en", "/zh") : pathname.replace("/zh", "/en")} className="console-topbar-lang">
          {pathname.startsWith("/en") ? "中" : "EN"}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="console-topbar-avatar" aria-label="User menu">
              <span className="console-topbar-avatar-text">U</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">{t("nav.settings")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()}>
              {t("nav.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Update ConsoleShell to use new components**

Rewrite `apps/web/components/console/ConsoleShell.tsx`:

```typescript
// apps/web/components/console/ConsoleShell.tsx
"use client";

import { IconBar } from "./IconBar";
import { ListPanel } from "./ListPanel";
import { ConsoleTopBar } from "./ConsoleTopBar";
import { StatusBar } from "./StatusBar";

interface ConsoleShellProps {
  listContent?: React.ReactNode;
  children: React.ReactNode;
}

export function ConsoleShell({ listContent, children }: ConsoleShellProps) {
  return (
    <div className="console-shell-v2">
      <ConsoleTopBar />
      <div className="console-shell-body-v2">
        <IconBar />
        {listContent && <ListPanel>{listContent}</ListPanel>}
        <main className="console-shell-main">
          {children}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 5: Add CSS for new shell layout**

Add to `apps/web/styles/globals.css`:

```css
/* ── New Console Shell v2 ── */
.console-shell-v2 {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-body);
}

.console-topbar {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 10;
}

.console-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.console-topbar-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
}

.console-topbar-logo {
  width: 26px;
  height: 26px;
  background: var(--accent-gradient);
  border-radius: 7px;
}

.console-topbar-brand-text {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.console-topbar-breadcrumb {
  display: flex;
  align-items: center;
}

.console-topbar-sep {
  color: var(--text-muted);
  margin: 0 6px;
  font-size: 12px;
}

.console-topbar-crumb {
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: none;
}

.console-topbar-crumb.is-current {
  color: var(--text-primary);
  font-weight: 500;
}

.console-topbar-crumb:hover:not(.is-current) {
  color: var(--text-primary);
}

.console-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.console-topbar-kbd {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-base);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-family: var(--font-body);
  cursor: pointer;
}

.console-topbar-lang {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-base);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  text-decoration: none;
  font-weight: 500;
}

.console-topbar-lang:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.console-topbar-avatar {
  width: 28px;
  height: 28px;
  background: var(--border);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
}

.console-topbar-avatar-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.console-shell-body-v2 {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Icon Bar */
.icon-bar {
  width: 52px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px 0;
  flex-shrink: 0;
}

.icon-bar-top,
.icon-bar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.icon-bar-item {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 150ms, background 150ms;
  text-decoration: none;
}

.icon-bar-item:hover {
  color: var(--text-primary);
  background: var(--bg-base);
}

.icon-bar-item.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}

/* List Panel */
.list-panel {
  width: 180px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width 200ms ease-in-out;
}

.list-panel.is-collapsed {
  width: 0;
  border-right: none;
  overflow: hidden;
}

.list-panel-content {
  flex: 1;
  padding: 16px 12px;
  overflow-y: auto;
}

.list-panel-toggle {
  position: absolute;
  top: 50%;
  right: -12px;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  color: var(--text-muted);
  box-shadow: var(--shadow-card);
}

.list-panel-toggle:hover {
  color: var(--text-primary);
}

/* Main Content */
.console-shell-main {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
}

/* Responsive: Tablet */
@media (max-width: 1023px) {
  .list-panel {
    position: absolute;
    left: 52px;
    top: 50px;
    bottom: 24px;
    z-index: 20;
    box-shadow: var(--shadow-raised);
    width: 0;
    border-right: none;
    overflow: hidden;
  }

  .list-panel:not(.is-collapsed) {
    width: 200px;
    border-right: 1px solid var(--border-light);
  }
}

/* Responsive: Mobile */
@media (max-width: 767px) {
  .console-topbar {
    display: none;
  }

  .icon-bar {
    display: none;
  }

  .list-panel {
    display: none;
  }

  .console-shell-main {
    padding: 16px;
  }

  .console-shell-body-v2 {
    padding-bottom: 56px; /* space for mobile tab bar */
  }
}
```

- [ ] **Step 6: Run dev server and verify layout renders**

Run: `cd apps/web && npm run dev`
Check: http://localhost:3000/zh/app/assistants — should show three-column layout with warm cream colors

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/console/IconBar.tsx apps/web/components/console/ListPanel.tsx apps/web/components/console/ConsoleTopBar.tsx apps/web/components/console/ConsoleShell.tsx apps/web/styles/globals.css
git commit -m "feat(console): build new three-column shell layout with warm cream theme"
```

---

### Task 4: Update Console Layout to Use New Shell

**Files:**
- Modify: `apps/web/app/[locale]/(console)/layout.tsx`

- [ ] **Step 1: Rewrite console layout**

Replace the current layout to use the new shell. Remove the old `data-theme` dark mode setup, keep `data-theme="console"` for CSS variable scoping:

```typescript
// apps/web/app/[locale]/(console)/layout.tsx
import { ReactNode } from "react";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { ProjectProvider } from "@/lib/ProjectContext";
import { MobileMenuProvider } from "@/components/MobileMenuProvider";
import { MobileTabBar } from "@/components/console/MobileTabBar";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ProjectProvider>
      <MobileMenuProvider>
        <div data-theme="console">
          <ConsoleShell>
            {children}
          </ConsoleShell>
          <MobileTabBar />
          <CommandPalette />
          <Toaster />
        </div>
      </MobileMenuProvider>
    </ProjectProvider>
  );
}
```

Note: MobileTabBar doesn't exist yet — create a placeholder that renders null for now. We'll implement it in a later task.

- [ ] **Step 2: Create MobileTabBar placeholder**

```typescript
// apps/web/components/console/MobileTabBar.tsx
"use client";

export function MobileTabBar() {
  // Placeholder: full implementation in Task 14 (Chunk 4)
  return null;
}
```

- [ ] **Step 3: Verify console loads without errors**

Run: `cd apps/web && npm run dev`
Navigate to http://localhost:3000/zh/app/assistants
Expected: Three-column layout with icon bar, main content, warm cream theme, no console errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/layout.tsx apps/web/components/console/MobileTabBar.tsx
git commit -m "feat(console): wire new shell layout into console route group"
```

---

### Task 5: Update i18n Message Keys for New Navigation

**Files:**
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Update Chinese console messages**

Add/update nav keys in `apps/web/messages/zh/console.json`:

```json
{
  "nav": {
    "assistants": "我的 AI",
    "knowledge": "知识库",
    "training": "训练中心",
    "chat": "对话调试",
    "devices": "设备",
    "settings": "设置",
    "logout": "退出登录"
  },
  "breadcrumb": {
    "new": "新建",
    "versions": "版本"
  },
  "cmd": {
    "placeholder": "输入命令或搜索…",
    "empty": "未找到结果",
    "navigate": "导航",
    "actions": "操作",
    "newAssistant": "新建 AI 助手",
    "startTraining": "开始训练"
  },
  "statusbar": {
    "apiConnected": "API 已连接",
    "noProject": "未选择项目"
  }
}
```

- [ ] **Step 2: Update English console messages**

Add/update nav keys in `apps/web/messages/en/console.json`:

```json
{
  "nav": {
    "assistants": "My AI",
    "knowledge": "Knowledge",
    "training": "Training",
    "chat": "Chat Debug",
    "devices": "Devices",
    "settings": "Settings",
    "logout": "Log Out"
  },
  "breadcrumb": {
    "new": "New",
    "versions": "Versions"
  },
  "cmd": {
    "placeholder": "Type a command or search…",
    "empty": "No results found",
    "navigate": "Navigate",
    "actions": "Actions",
    "newAssistant": "New AI Assistant",
    "startTraining": "Start Training"
  },
  "statusbar": {
    "apiConnected": "API Connected",
    "noProject": "No project selected"
  }
}
```

- [ ] **Step 3: Update CommandPalette to use new routes and keys**

In `apps/web/components/console/CommandPalette.tsx`, update the navigation items to point to new routes (/app/assistants, /app/knowledge, /app/training, /app/chat) and use new message keys.

- [ ] **Step 4: Verify navigation labels render correctly in both languages**

Run: `cd apps/web && npm run dev`
Toggle between /zh and /en — all nav labels should be correct.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/zh/console.json apps/web/messages/en/console.json apps/web/components/console/CommandPalette.tsx
git commit -m "feat(console): update i18n messages for new navigation structure"
```

---

## Chunk 2: Route Migration & Core Pages

### Task 6: Create New Route Structure

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/assistants/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/assistants/new/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/assistants/[id]/versions/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/knowledge/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/knowledge/[id]/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/training/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/training/[id]/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/chat/page.tsx`
- Modify: `apps/web/proxy.ts` (add route redirects)

- [ ] **Step 1: Create assistants list page**

Port from existing `projects/page.tsx`, rename terminology. Instead of "Create Project" form, show AI assistant cards. Calls `GET /api/v1/projects` (same API, different UI).

```typescript
// apps/web/app/[locale]/(console)/app/assistants/page.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import { PageTransition } from "@/components/console/PageTransition";
import { ConsoleSkeleton } from "@/components/ConsoleSkeleton";

interface Assistant {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export default function AssistantsPage() {
  const t = useTranslations("console-assistants");
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Assistant[]>("/api/v1/projects")
      .then(setAssistants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ConsoleSkeleton />;

  return (
    <PageTransition>
      <div className="console-page-header">
        <h1 className="console-page-title">{t("title")}</h1>
        <p className="console-page-desc">{t("description")}</p>
      </div>

      <div className="assistant-card-grid">
        {assistants.map((a) => (
          <Link
            key={a.id}
            href={`/app/assistants/${a.id}`}
            className="assistant-card"
          >
            <div className="assistant-card-name">{a.name}</div>
            <div className="assistant-card-desc">
              {a.description || t("noDescription")}
            </div>
          </Link>
        ))}

        <Link href="/app/assistants/new" className="assistant-card is-create">
          <span className="assistant-card-plus">+</span>
          <span>{t("createNew")}</span>
        </Link>
      </div>
    </PageTransition>
  );
}
```

- [ ] **Step 2: Create i18n files for new pages**

Create `apps/web/messages/zh/console-assistants.json`:
```json
{
  "title": "我的 AI",
  "description": "创建和管理你的个性化 AI 助手",
  "noDescription": "暂无描述",
  "createNew": "创建新的 AI 助手"
}
```

Create `apps/web/messages/en/console-assistants.json`:
```json
{
  "title": "My AI",
  "description": "Create and manage your personalized AI assistants",
  "noDescription": "No description",
  "createNew": "Create New AI Assistant"
}
```

Create remaining message files:

`apps/web/messages/zh/console-knowledge.json`:
```json
{
  "title": "知识库",
  "description": "管理你的知识资料，可跨 AI 共享",
  "createNew": "新建知识包",
  "noItems": "还没有知识包",
  "upload": "上传资料",
  "indexed": "已索引",
  "indexing": "索引中"
}
```

`apps/web/messages/en/console-knowledge.json`:
```json
{
  "title": "Knowledge",
  "description": "Manage your knowledge packs, shareable across AI assistants",
  "createNew": "New Knowledge Pack",
  "noItems": "No knowledge packs yet",
  "upload": "Upload Files",
  "indexed": "Indexed",
  "indexing": "Indexing"
}
```

`apps/web/messages/zh/console-training.json`:
```json
{
  "title": "训练中心",
  "description": "查看所有训练任务的状态",
  "noJobs": "暂无训练任务",
  "progress": "训练进度",
  "expandDetails": "展开详情",
  "collapseDetails": "收起详情"
}
```

`apps/web/messages/en/console-training.json`:
```json
{
  "title": "Training",
  "description": "View all training job status",
  "noJobs": "No training jobs yet",
  "progress": "Training Progress",
  "expandDetails": "Show Details",
  "collapseDetails": "Hide Details"
}
```

`apps/web/messages/zh/console-chat.json`:
```json
{
  "title": "对话调试",
  "description": "和你的 AI 助手对话测试",
  "emptyHint": "选择一个 AI 助手，开始对话测试",
  "inputPlaceholder": "输入消息…",
  "send": "发送",
  "mockNotice": "当前为模拟响应，接入真实推理后将显示实际结果"
}
```

`apps/web/messages/en/console-chat.json`:
```json
{
  "title": "Chat Debug",
  "description": "Test conversations with your AI assistants",
  "emptyHint": "Select an AI assistant to start testing",
  "inputPlaceholder": "Type a message…",
  "send": "Send",
  "mockNotice": "Responses are simulated. Real inference will be available after backend integration."
}
```

- [ ] **Step 3: Create placeholder pages for remaining new routes**

Create minimal page components for each new route that render a PageTransition with title. These will be fully implemented in later tasks:
- `/app/assistants/new/page.tsx` — "创建向导 (coming in Task 7)"
- `/app/assistants/[id]/page.tsx` — "画布工作台 (coming in Task 8)"
- `/app/assistants/[id]/versions/page.tsx` — "版本历史 (coming in Task 9)"
- `/app/knowledge/page.tsx` — port from datasets page
- `/app/knowledge/[id]/page.tsx` — port from datasets detail
- `/app/training/page.tsx` — port from train page
- `/app/training/[id]/page.tsx` — port from train detail
- `/app/chat/page.tsx` — "对话调试 (coming in Task 10)"

Each placeholder follows this pattern:
```typescript
"use client";
import { PageTransition } from "@/components/console/PageTransition";
import { useTranslations } from "next-intl";

export default function PlaceholderPage() {
  const t = useTranslations("console-assistants");
  return (
    <PageTransition>
      <h1 className="console-page-title">{t("title")}</h1>
    </PageTransition>
  );
}
```

- [ ] **Step 4: Add route redirects in proxy.ts**

In `apps/web/proxy.ts`, add old → new route redirects before the `NextResponse.next()` call:

```typescript
// Route migration redirects
const ROUTE_REDIRECTS: Record<string, string> = {
  "/app/projects": "/app/assistants",
  "/app/datasets": "/app/knowledge",
  "/app/train": "/app/training",
  "/app/models": "/app/assistants",
  "/app/eval": "/app/assistants",
  "/app/billing": "/app/settings",
};

// In the middleware function, after locale stripping:
const strippedPath = pathname.replace(/^\/(zh|en)/, "");
for (const [oldPath, newPath] of Object.entries(ROUTE_REDIRECTS)) {
  if (strippedPath === oldPath || strippedPath.startsWith(oldPath + "/")) {
    const redirectUrl = new URL(
      pathname.replace(oldPath, newPath),
      request.url
    );
    return NextResponse.redirect(redirectUrl, 301);
  }
}

// Also redirect /app to /app/assistants
if (strippedPath === "/app" || strippedPath === "/app/") {
  const locale = pathname.startsWith("/en") ? "/en" : "/zh";
  return NextResponse.redirect(new URL(`${locale}/app/assistants`, request.url), 302);
}
```

- [ ] **Step 5: Add CSS for assistant cards and page header**

Add to `apps/web/styles/globals.css`:

```css
/* Console page header */
.console-page-header {
  margin-bottom: 24px;
}

.console-page-title {
  font-family: var(--font-title);
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.console-page-desc {
  font-size: 13.5px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* Assistant cards */
.assistant-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.assistant-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 18px;
  text-decoration: none;
  box-shadow: var(--shadow-card);
  transition: box-shadow 150ms, transform 150ms;
}

.assistant-card:hover {
  box-shadow: var(--shadow-raised);
  transform: translateY(-1px);
}

.assistant-card.is-create {
  border-style: dashed;
  border-color: var(--border-light);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  background: transparent;
  box-shadow: none;
}

.assistant-card.is-create:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.assistant-card-plus {
  font-size: 24px;
  font-weight: 300;
}

.assistant-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.assistant-card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}
```

- [ ] **Step 6: Verify route redirects work**

Run: `cd apps/web && npm run dev`
- Visit http://localhost:3000/zh/app/projects → should redirect to /zh/app/assistants
- Visit http://localhost:3000/zh/app/datasets → should redirect to /zh/app/knowledge
- Visit http://localhost:3000/zh/app → should redirect to /zh/app/assistants

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/ apps/web/app/[locale]/(console)/app/knowledge/ apps/web/app/[locale]/(console)/app/training/ apps/web/app/[locale]/(console)/app/chat/ apps/web/messages/ apps/web/proxy.ts apps/web/styles/globals.css
git commit -m "feat(console): create new route structure with redirects from old paths"
```

---

### Task 7: Build Creation Wizard

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/assistants/new/page.tsx`
- Create: `apps/web/components/console/wizard/WizardShell.tsx`
- Create: `apps/web/components/console/wizard/StepModel.tsx`
- Create: `apps/web/components/console/wizard/StepKnowledge.tsx`
- Create: `apps/web/components/console/wizard/StepPersonality.tsx`
- Create: `apps/web/components/console/wizard/StepFinish.tsx`

- [ ] **Step 1: Create WizardShell (step navigation + progress)**

A container that manages the current step (1-4) and renders the active step component. Progress bar at top with step indicators. Back/Next/Skip buttons at bottom.

- [ ] **Step 2: Create StepModel**

Three model cards (轻/中/强) with name, description, recommendation tag. Selected state with accent border. Maps to creating a project via `POST /api/v1/projects` with model info stored in description/params.

- [ ] **Step 3: Create StepKnowledge**

File upload area (drag-and-drop) using the existing Uploader component pattern. Calls `POST /api/v1/datasets` to create a dataset, then presign + upload for each file. "Skip" button prominently shown.

- [ ] **Step 4: Create StepPersonality**

Grid of 6 personality template cards (专业顾问, 学习伙伴, 生活助手, 创意搭档, 语言教练, 自定义). Selecting a template fills in a text area. Editable. Tags selector below.

- [ ] **Step 5: Create StepFinish**

Name input, icon/color picker (6 preset colors), summary of choices. "开始训练" button calls `POST /api/v1/train/jobs`. On success, redirect to `/app/assistants/[id]`.

- [ ] **Step 6: Wire wizard page**

```typescript
// apps/web/app/[locale]/(console)/app/assistants/new/page.tsx
"use client";
import { WizardShell } from "@/components/console/wizard/WizardShell";
export default function NewAssistantPage() {
  return <WizardShell />;
}
```

- [ ] **Step 7: Add wizard CSS**

Add styles for `.wizard-*` classes: progress bar, step cards, model cards, personality grid, etc.

- [ ] **Step 8: Test full wizard flow**

Run dev server. Navigate to /app/assistants/new. Step through all 4 steps. Verify API calls succeed and redirect to detail page works.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/new/ apps/web/components/console/wizard/ apps/web/styles/globals.css
git commit -m "feat(console): add 4-step AI assistant creation wizard"
```

---

### Task 8: Build Canvas Workbench

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx` (full rewrite)
- Create: `apps/web/components/console/canvas/CanvasWorkbench.tsx`
- Create: `apps/web/components/console/canvas/ModelCard.tsx`
- Create: `apps/web/components/console/canvas/KnowledgeCard.tsx`
- Create: `apps/web/components/console/canvas/PersonalityCard.tsx`
- Create: `apps/web/components/console/canvas/SkillsCard.tsx`

- [ ] **Step 1: Create CanvasWorkbench layout**

2×2 grid of cards. Top bar with assistant name + status + "试用对话" + "保存并训练" buttons. Each card has a header (label + edit link) and content area.

- [ ] **Step 2: Create ModelCard**

Shows current model name + description. "更换" button opens a model picker modal/inline. Loads from project data.

- [ ] **Step 3: Create KnowledgeCard**

Shows list of files in the dataset. Upload button. File count + size summary. "管理" link to `/app/knowledge/[id]`. Loads from `GET /api/v1/datasets?project_id=X`.

- [ ] **Step 4: Create PersonalityCard**

Shows personality description text + style tags. "编辑" button expands inline editor. Saves to project description field.

- [ ] **Step 5: Create SkillsCard**

Shows skill list. "添加" button. Each skill has name + icon. Stored in frontend state, submitted with training job.

- [ ] **Step 6: Wire canvas page**

```typescript
// apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx
"use client";
import { CanvasWorkbench } from "@/components/console/canvas/CanvasWorkbench";
export default function AssistantDetailPage({ params }: { params: { id: string } }) {
  return <CanvasWorkbench assistantId={params.id} />;
}
```

- [ ] **Step 7: Add canvas CSS**

Styles for `.canvas-*` classes: grid layout, card components, training status bar.

```css
.canvas-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

/* Tablet: keep 2x2 but compact card padding */
@media (max-width: 1023px) {
  .canvas-grid {
    gap: 10px;
  }
  .canvas-card {
    padding: 14px;
  }
  .canvas-card-body {
    font-size: 12px;
  }
}

/* Mobile: single column stack */
@media (max-width: 767px) {
  .canvas-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Add advanced expand toggle to each card**

Each canvas card gets a "展开高级选项" / "收起" toggle. When expanded:
- **ModelCard**: shows model parameter details, inference config JSON
- **KnowledgeCard**: shows data item details table, annotation editing, version snapshot list
- **PersonalityCard**: shows full system prompt editor (textarea with monospace font)
- **SkillsCard**: shows skill parameter config, function definition JSON editor

Implementation: each card component takes an `expanded` boolean state. Toggle button at bottom of card. Advanced content rendered conditionally. Animate height with Framer Motion `AnimatePresence`.

```typescript
// Pattern for each card (e.g., ModelCard.tsx):
const [expanded, setExpanded] = useState(false);

return (
  <div className="canvas-card">
    {/* default view */}
    <AnimatePresence>
      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
          {/* advanced content */}
        </motion.div>
      )}
    </AnimatePresence>
    <button className="canvas-card-expand" onClick={() => setExpanded(!expanded)}>
      {expanded ? t("collapseAdvanced") : t("expandAdvanced")}
    </button>
  </div>
);
```

- [ ] **Step 9: Wire developer mode into canvas cards**

Import `useDeveloperMode()` in each card component. When `isDeveloperMode` is true, show additional info:

```typescript
// In each canvas card:
const { isDeveloperMode } = useDeveloperMode();

// Render conditionally:
{isDeveloperMode && (
  <div className="canvas-card-dev-info">
    <code>project_id: {assistant.id}</code>
    <code>model_id: {model?.id}</code>
    {/* etc. per card type */}
  </div>
)}
```

Specific developer mode additions per card:
- **ModelCard**: `model_id`, model parameters JSON
- **KnowledgeCard**: `dataset_id`, `item_count`, version number, `object_key` per item
- **PersonalityCard**: raw `params_json` display
- **SkillsCard**: function signature JSON, `params_json` tools section
- **Top bar**: `project_id` badge, model alias management (prod/staging/dev buttons)

CSS for dev info:
```css
.canvas-card-dev-info {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--bg-base);
  border-radius: var(--radius-badge);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

- [ ] **Step 10: Test canvas loads with real data**

Navigate to an existing assistant. Verify all 4 cards render with data from API. Toggle developer mode in settings, return to canvas, verify dev info appears. Toggle advanced expand on each card.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/[id]/ apps/web/components/console/canvas/ apps/web/styles/globals.css
git commit -m "feat(console): add canvas workbench with advanced expand and developer mode"
```

---

## Chunk 3: Secondary Pages & Features

### Task 9: Port Knowledge Pages (from Datasets)

**Files:**
- Rewrite: `apps/web/app/[locale]/(console)/app/knowledge/page.tsx`
- Rewrite: `apps/web/app/[locale]/(console)/app/knowledge/[id]/page.tsx`

- [ ] **Step 1: Port datasets list → knowledge list**

Copy logic from `datasets/page.tsx`. Change terminology: "数据集" → "知识包", "类型" → "资料类型". Use new card-based layout instead of DataTable. Same API: `GET /api/v1/datasets`.

- [ ] **Step 2: Port dataset detail → knowledge detail**

Copy logic from `datasets/[id]/page.tsx`. Reuse Uploader component. Change "标注" → "标签", "提交版本" → "保存快照". Same APIs.

- [ ] **Step 3: Add i18n messages**

Create/update `console-knowledge.json` for both locales.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/knowledge/ apps/web/messages/
git commit -m "feat(console): port datasets pages to knowledge with new terminology"
```

---

### Task 10: Port Training Pages

**Files:**
- Rewrite: `apps/web/app/[locale]/(console)/app/training/page.tsx`
- Rewrite: `apps/web/app/[locale]/(console)/app/training/[id]/page.tsx`

- [ ] **Step 1: Port train list → training center**

Copy logic from `train/page.tsx`. Simplify the create form (it's now triggered from the canvas workbench "保存并训练" button). Show training jobs with progress bars instead of bare table rows. Same API: `GET /api/v1/train/jobs`.

- [ ] **Step 2: Port train detail → training detail**

Copy logic from `train/[id]/page.tsx`. Default view: progress bar + status + summary. "展开详情" reveals JobLogViewer + MetricChart. Same SSE streaming. Same API.

- [ ] **Step 3: Add i18n messages**

Update `console-training.json` for both locales.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/training/ apps/web/messages/
git commit -m "feat(console): port training pages with simplified default view"
```

---

### Task 11: Build Chat Debug Page (Mock)

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/chat/page.tsx`
- Create: `apps/web/components/console/ChatInterface.tsx`

- [ ] **Step 1: Create ChatInterface component**

```typescript
// apps/web/components/console/ChatInterface.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MOCK_RESPONSES = [
  "你好！我是你的 AI 助手，很高兴为你服务。有什么我可以帮你的吗？",
  "这是一个很好的问题。让我为你详细解答一下…",
  "根据我的知识库中的信息，我可以告诉你以下内容…",
  "明白了，让我想想最好的方式来回答你。",
  "感谢你的提问！这个话题很有趣，以下是我的看法…",
];

export function ChatInterface() {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = () => {
    if (!input.trim() || isTyping) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    // Mock response with typewriter delay
    const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      setIsTyping(false);
    }, 800 + Math.random() * 1200);
  };

  return (
    <div className="chat-interface">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>{t("emptyHint")}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message is-${msg.role}`}>
            <div className="chat-bubble">{msg.content}</div>
          </div>
        ))}
        {isTyping && (
          <div className="chat-message is-assistant">
            <div className="chat-bubble is-typing">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-bar">
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={t("inputPlaceholder")}
          disabled={isTyping}
        />
        <button
          className="chat-send"
          onClick={sendMessage}
          disabled={!input.trim() || isTyping}
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create chat page**

```typescript
// apps/web/app/[locale]/(console)/app/chat/page.tsx
"use client";
import { useTranslations } from "next-intl";
import { PageTransition } from "@/components/console/PageTransition";
import { ChatInterface } from "@/components/console/ChatInterface";

export default function ChatPage() {
  const t = useTranslations("console-chat");
  return (
    <PageTransition>
      <div className="console-page-header">
        <h1 className="console-page-title">{t("title")}</h1>
        <p className="console-page-desc">{t("description")}</p>
      </div>
      <ChatInterface />
    </PageTransition>
  );
}
```

- [ ] **Step 3: Add chat CSS**

Add to `apps/web/styles/globals.css`:

```css
.chat-interface {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 180px);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13.5px;
}

.chat-message {
  display: flex;
}

.chat-message.is-user {
  justify-content: flex-end;
}

.chat-message.is-assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.6;
}

.chat-message.is-user .chat-bubble {
  background: var(--accent);
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.chat-message.is-assistant .chat-bubble {
  background: var(--bg-base);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.chat-bubble.is-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 18px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: typing-pulse 1.4s ease-in-out infinite;
}

.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing-pulse {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

.chat-input-bar {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13.5px;
  outline: none;
}

.chat-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.chat-send {
  padding: 10px 20px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-button);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.chat-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

i18n messages were already created in Task 6 Step 2 (`console-chat.json` for both locales).

- [ ] **Step 4: Test chat interaction**

Navigate to /app/chat. Type a message. Verify mock response appears with typing indicator.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/chat/ apps/web/components/console/ChatInterface.tsx apps/web/messages/ apps/web/styles/globals.css
git commit -m "feat(console): add chat debug page with mock responses"
```

---

### Task 12: Build Version History Page

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/assistants/[id]/versions/page.tsx`

- [ ] **Step 1: Create versions page**

Port logic from `models/[id]/page.tsx`. Show version list with: version number, training date, status, metrics summary. "当前使用" badge on active version. "回滚" button. Uses `GET /api/v1/models` + `GET /api/v1/models/{id}` APIs.

- [ ] **Step 2: Add version comparison section**

Port from `eval/page.tsx`. Side-by-side comparison of two versions. Uses `POST /api/v1/eval` API (mock).

- [ ] **Step 3: Add i18n and CSS**

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/[id]/versions/ apps/web/messages/ apps/web/styles/globals.css
git commit -m "feat(console): add version history and comparison page"
```

---

### Task 13: Update Settings Page (Developer Mode + Billing Merge)

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/settings/page.tsx`
- Create: `apps/web/lib/developer-mode.ts`

- [ ] **Step 1: Create developer mode context**

```typescript
// apps/web/lib/developer-mode.ts
"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface DevModeContextType {
  isDeveloperMode: boolean;
  toggleDeveloperMode: () => void;
}

const DevModeContext = createContext<DevModeContextType>({
  isDeveloperMode: false,
  toggleDeveloperMode: () => {},
});

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("developer-mode");
    if (saved === "true") setIsDeveloperMode(true);
  }, []);

  const toggleDeveloperMode = () => {
    const next = !isDeveloperMode;
    setIsDeveloperMode(next);
    localStorage.setItem("developer-mode", String(next));
  };

  return (
    <DevModeContext.Provider value={{ isDeveloperMode, toggleDeveloperMode }}>
      {children}
    </DevModeContext.Provider>
  );
}

export const useDeveloperMode = () => useContext(DevModeContext);
```

- [ ] **Step 2: Add DevModeProvider to console layout**

Wrap console layout children with `<DevModeProvider>`.

- [ ] **Step 3: Rewrite settings page**

Sections: Account, Language, Developer Mode toggle, Subscription/Usage (from billing), Logout, Delete Data.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/developer-mode.ts apps/web/app/[locale]/(console)/layout.tsx apps/web/app/[locale]/(console)/app/settings/page.tsx apps/web/messages/
git commit -m "feat(console): add developer mode toggle and merge billing into settings"
```

---

## Chunk 4: Polish & Mobile

### Task 14: Build Mobile Tab Bar

**Files:**
- Rewrite: `apps/web/components/console/MobileTabBar.tsx`

- [ ] **Step 1: Implement MobileTabBar**

Bottom fixed tab bar (56px) visible only on mobile (<768px). 5 tabs: AI, Knowledge, Training, Chat, More (dropdown for Devices/Settings). Reuse icon SVGs from IconBar.

- [ ] **Step 2: Add CSS for mobile tab bar**

```css
.mobile-tab-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  z-index: 50;
}

@media (max-width: 767px) {
  .mobile-tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-around;
  }
}
```

- [ ] **Step 3: Test on mobile viewport**

Open browser devtools, switch to mobile viewport (375px). Verify tab bar appears, icon bar/topbar hidden, navigation works.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/MobileTabBar.tsx apps/web/styles/globals.css
git commit -m "feat(console): add mobile bottom tab bar for responsive navigation"
```

---

### Task 15: Clean Up Old Pages & Components

**Files:**
- Delete: `apps/web/app/[locale]/(console)/app/projects/` (old route)
- Delete: `apps/web/app/[locale]/(console)/app/datasets/` (old route)
- Delete: `apps/web/app/[locale]/(console)/app/train/` (old route)
- Delete: `apps/web/app/[locale]/(console)/app/models/` (old route)
- Delete: `apps/web/app/[locale]/(console)/app/eval/` (old route)
- Delete: `apps/web/app/[locale]/(console)/app/billing/` (merged into settings)
- Delete: `apps/web/components/console/ActivityBar.tsx` (replaced by IconBar)
- Delete: `apps/web/components/console/InlineTopBar.tsx` (replaced by ConsoleTopBar)
- Modify: `apps/web/components/console/PanelLayout.tsx` (keep for potential use, but remove from page imports)

- [ ] **Step 1: Delete old route directories**

Remove old page files. The proxy.ts redirects handle any bookmarked URLs.

- [ ] **Step 2: Delete replaced components**

Remove ActivityBar.tsx and InlineTopBar.tsx. Keep PanelLayout.tsx in case it's useful for advanced views.

- [ ] **Step 3: Remove old CSS classes that are no longer referenced**

Clean up `.activity-bar-*`, `.inline-topbar-*` classes from globals.css.

- [ ] **Step 4: Run full build to verify no broken imports**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no missing module errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(console): remove old pages and components replaced by redesign"
```

---

### Task 16: Update Existing Tests

**Files:**
- Modify: `apps/web/tests/` (update route references in existing E2E tests)

- [ ] **Step 1: Update route references in E2E tests**

Search all test files for old routes (`/app/projects`, `/app/datasets`, `/app/train`, `/app/models`, `/app/eval`) and update to new routes.

- [ ] **Step 2: Run full E2E suite**

Run: `cd apps/web && npx playwright test`
Expected: All tests pass (or identify which need further updates).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/
git commit -m "test(console): update E2E tests for new route structure"
```

---

### Task 17: Final Visual Polish & Verification

- [ ] **Step 1: Walk through every page and verify visual consistency**

Check each page renders correctly with warm cream theme: assistants list, wizard (all 4 steps), canvas workbench, knowledge list/detail, training list/detail, chat, devices, settings.

- [ ] **Step 2: Verify i18n completeness**

Switch between zh and en. Every label should be translated. No missing keys.

- [ ] **Step 3: Verify responsive layouts**

Test at 3 breakpoints: Desktop (1280px), Tablet (900px), Mobile (375px). Navigation should adapt correctly at each.

- [ ] **Step 4: Run final build**

Run: `cd apps/web && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(console): complete console redesign - visual polish and verification"
```
