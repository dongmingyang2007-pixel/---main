# Console UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current light glassmorphic console shell with a dark VS Code-style hybrid workspace featuring an ActivityBar, TopBar with breadcrumbs, resizable three-panel layout, StatusBar, and Command Palette.

**Architecture:** The new ConsoleShell replaces AppShell as the console layout wrapper. It composes ActivityBar (48px icon rail), TopBar (48px breadcrumb bar), PanelLayout (three resizable columns via `react-resizable-panels`), StatusBar (24px), and CommandPalette (Cmd+K overlay using shadcn Command). Each page configures which panels are visible. Existing page content and data-fetching logic is preserved — only the surrounding shell and CSS tokens change.

**Tech Stack:** Next.js App Router, TypeScript, react-resizable-panels, shadcn/ui (Command, Dialog, DropdownMenu, Tooltip), Framer Motion, CSS custom properties (v2 dark tokens already defined in Foundation plan)

---

## Chunk 1: Console Shell Infrastructure

### Task 1: Install react-resizable-panels

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd apps/web && npm install react-resizable-panels
```

- [ ] **Step 2: Verify installation**

```bash
cd apps/web && node -e "require('react-resizable-panels')" && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore: add react-resizable-panels for console panel layout"
```

---

### Task 2: Create ActivityBar component

The ActivityBar is a 48px-wide vertical icon rail on the left side of the console. It shows navigation icons for each section, with bottom actions for settings/help. Icons are simple SVG paths — no icon library needed.

**Files:**
- Create: `apps/web/components/console/ActivityBar.tsx`

**Key behavior:**
- Icon-only nav items with Tooltip on hover (shadcn Tooltip)
- Active state: brand-colored background pill behind icon
- Top section: Dashboard, Projects, Datasets, Train, Models, Eval
- Bottom section: Devices (coming soon), Billing (coming soon), Settings, Help (links to /support)
- Uses `usePathname()` for active detection
- `aria-label` on each icon button
- ARIA `role="navigation"` with `aria-label="Main"`

- [ ] **Step 1: Create the ActivityBar component**

```tsx
// apps/web/components/console/ActivityBar.tsx
"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TOP_ITEMS = [
  { href: "/app", label: "Dashboard", icon: "dashboard" },
  { href: "/app/projects", label: "Projects", icon: "projects" },
  { href: "/app/datasets", label: "Datasets", icon: "datasets" },
  { href: "/app/train", label: "Train", icon: "train" },
  { href: "/app/models", label: "Models", icon: "models" },
  { href: "/app/eval", label: "Eval", icon: "eval" },
];

const BOTTOM_ITEMS = [
  { href: "/app/devices", label: "Devices", icon: "devices", comingSoon: true },
  { href: "/app/billing", label: "Billing", icon: "billing", comingSoon: true },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

// Simple SVG icon paths — keep inline to avoid icon library dependency
function ActivityIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
    projects: "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z",
    datasets: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v12z",
    train: "M15.5 2.5L12 6l3.5 3.5L17 8l2 2-5 5-2-2-1.5 1.5L14 18l6-6-4.5-4.5zM2 18l6-6 4.5 4.5-6 6L2 18z",
    models: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    eval: "M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2 2H5V5h14v14zm0-16H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
    devices: "M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z",
    billing: "M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
    settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
}

export function ActivityBar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        className="activity-bar"
        role="navigation"
        aria-label="Main"
      >
        <div className="activity-bar-top">
          {TOP_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={clsx(
                    "activity-bar-item",
                    isActive(item.href) && "is-active",
                  )}
                  aria-label={item.label}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <ActivityIcon name={item.icon} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="activity-bar-bottom">
          {BOTTOM_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={clsx(
                    "activity-bar-item",
                    isActive(item.href) && "is-active",
                  )}
                  aria-label={item.label}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <ActivityIcon name={item.icon} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
                {item.comingSoon && (
                  <span className="ml-1 text-xs opacity-60">(coming soon)</span>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/ActivityBar.tsx
git commit -m "feat(console): add ActivityBar icon rail component"
```

---

### Task 3: Create TopBar component

The TopBar is a 48px-high bar at the top of the console. It contains: logo/brand link, auto-generated breadcrumb from the current route, ProjectSwitcher dropdown, and UserMenu dropdown.

**Files:**
- Create: `apps/web/components/console/TopBar.tsx`

**Key behavior:**
- Brand link (QIHANG logo dot + text) on the left, links to `/`
- BreadcrumbNav auto-generated from pathname segments: `/app/datasets/abc123` → `Dashboard / Datasets / abc123`
- ProjectSwitcher: shadcn DropdownMenu showing projects from `useProjectContext()`, highlights current selection
- UserMenu: avatar circle + dropdown with "Settings" and "Back to site" links
- All on dark background using v2 tokens

- [ ] **Step 1: Create the TopBar component**

```tsx
// apps/web/components/console/TopBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProjectContext } from "@/lib/ProjectContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SEGMENT_LABELS: Record<string, string> = {
  app: "Dashboard",
  projects: "Projects",
  datasets: "Datasets",
  train: "Train",
  models: "Models",
  eval: "Eval",
  settings: "Settings",
  devices: "Devices",
  billing: "Billing",
};

function BreadcrumbNav() {
  const pathname = usePathname();
  // /app/datasets/abc → ["app", "datasets", "abc"]
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: SEGMENT_LABELS[seg] || seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <div className="topbar-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-[var(--text-secondary)] opacity-40">/</span>
          )}
          {crumb.isLast ? (
            <span className="text-[var(--text-primary)] text-sm font-medium">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="text-[var(--text-secondary)] text-sm hover:text-[var(--text-primary)] transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </div>
  );
}

function ProjectSwitcher() {
  const { projectId, projects, selectProject } = useProjectContext();
  const current = projects.find((p) => p.id === projectId);

  if (!projects.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-project-switcher">
        <span className="truncate text-sm">
          {current?.name || "Select project"}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-50">
          <path d="M3 5l3 3 3-3H3z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => void selectProject(p.id)}
            className={p.id === projectId ? "font-semibold" : ""}
          >
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-avatar" aria-label="User menu">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/app/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/">Back to site</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="topbar-brand">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
          <strong className="text-sm font-semibold tracking-tight">QIHANG</strong>
        </Link>
        <span className="topbar-separator" />
        <ProjectSwitcher />
        <span className="topbar-separator" />
        <BreadcrumbNav />
      </div>
      <div className="topbar-right">
        <UserMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/TopBar.tsx
git commit -m "feat(console): add TopBar with breadcrumbs, project switcher, user menu"
```

---

### Task 4: Create StatusBar component

The StatusBar is a 24px-high bar at the bottom of the console. Left side: API connection indicator + current project name. Right side: notification count + version.

**Files:**
- Create: `apps/web/components/console/StatusBar.tsx`

- [ ] **Step 1: Create the StatusBar component**

```tsx
// apps/web/components/console/StatusBar.tsx
"use client";

import { useProjectContext } from "@/lib/ProjectContext";

export function StatusBar() {
  const { projectId, projects } = useProjectContext();
  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <div className="statusbar-left">
        <span className="statusbar-indicator" title="API Connected" />
        <span className="text-xs text-[var(--text-secondary)]">
          {currentProject?.name || "No project"}
        </span>
      </div>
      <div className="statusbar-right">
        <span className="text-xs text-[var(--text-secondary)]">v0.1</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/console/StatusBar.tsx
git commit -m "feat(console): add StatusBar component"
```

---

### Task 5: Create PanelLayout component

PanelLayout wraps `react-resizable-panels` to provide the three-column layout. Each page passes its own ListPanel/InspectorPanel content or omits them for full-width ContentPanel.

**Files:**
- Create: `apps/web/components/console/PanelLayout.tsx`

**Key behavior:**
- Uses `PanelGroup`, `Panel`, `PanelResizeHandle` from react-resizable-panels
- `listPanel` and `inspectorPanel` are optional React nodes
- When a panel is omitted, its space goes to ContentPanel
- Resize handle styled as a 1px border with hover widening
- Panel widths stored in localStorage via `autoSaveId`
- Keyboard shortcuts for panel toggles (Cmd+1 list, Cmd+2 inspector) — wired in parent

- [ ] **Step 1: Create the PanelLayout component**

```tsx
// apps/web/components/console/PanelLayout.tsx
"use client";

import type { ReactNode } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

interface PanelLayoutProps {
  listPanel?: ReactNode;
  inspectorPanel?: ReactNode;
  children: ReactNode; // ContentPanel content
  storageKey?: string;
}

function ResizeHandle() {
  return (
    <PanelResizeHandle className="panel-resize-handle">
      <div className="panel-resize-handle-bar" />
    </PanelResizeHandle>
  );
}

export function PanelLayout({
  listPanel,
  inspectorPanel,
  children,
  storageKey = "console-panels",
}: PanelLayoutProps) {
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={storageKey}
      className="panel-group"
    >
      {listPanel && (
        <>
          <Panel
            id="list"
            order={1}
            defaultSize={20}
            minSize={15}
            maxSize={30}
            className="panel-list"
            role="complementary"
            aria-label="Resource list"
          >
            <div className="panel-content">{listPanel}</div>
          </Panel>
          <ResizeHandle />
        </>
      )}

      <Panel
        id="content"
        order={2}
        minSize={40}
        className="panel-content-main"
        role="main"
      >
        <div className="panel-content">{children}</div>
      </Panel>

      {inspectorPanel && (
        <>
          <ResizeHandle />
          <Panel
            id="inspector"
            order={3}
            defaultSize={22}
            minSize={18}
            maxSize={35}
            className="panel-inspector"
            role="complementary"
            aria-label="Inspector"
          >
            <div className="panel-content">{inspectorPanel}</div>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/PanelLayout.tsx
git commit -m "feat(console): add PanelLayout with resizable three-panel columns"
```

---

### Task 6: Create ConsoleShell and console CSS

ConsoleShell replaces the current AppShell for the console. It composes ActivityBar, TopBar, PanelLayout, and StatusBar. This task also creates the dark-themed CSS for all console shell components.

**Files:**
- Create: `apps/web/components/console/ConsoleShell.tsx`
- Modify: `apps/web/styles/globals.css` — add new console shell CSS classes

**ConsoleShell structure:**
```
┌──────────────────────────────────────────────────┐
│  TopBar (48px)                                    │
├────┬─────────────────────────────────────────────┤
│ A  │  PanelLayout                                │
│ c  │  (list | content | inspector)               │
│ t  │                                             │
│ .  │                                             │
│ B  │                                             │
│ a  │                                             │
│ r  │                                             │
│48px│                                             │
├────┴─────────────────────────────────────────────┤
│  StatusBar (24px)                                 │
└──────────────────────────────────────────────────┘
```

- [ ] **Step 1: Create the ConsoleShell component**

```tsx
// apps/web/components/console/ConsoleShell.tsx
"use client";

import type { ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="console-shell">
      <TopBar />
      <div className="console-shell-body">
        <ActivityBar />
        <div className="console-shell-workspace">
          {children}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 2: Add console shell CSS to globals.css**

Add these CSS rules in the console section of `globals.css`. All colors reference existing v2 tokens defined in the `[data-theme="console"]` block (from Foundation plan). These styles ONLY apply inside `[data-theme="console"]`.

```css
/* ── Console Shell v2 ──────────────────────────── */

.console-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
  color: var(--text-primary);
}

.console-shell-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.console-shell-workspace {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* ── ActivityBar ──────────────────────────────── */

.activity-bar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 48px;
  flex-shrink: 0;
  padding: 8px 0;
  border-right: 1px solid var(--border);
  background: var(--bg-base);
}

.activity-bar-top,
.activity-bar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.activity-bar-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--text-secondary);
  transition: color var(--duration-fast), background var(--duration-fast);
}

.activity-bar-item:hover {
  color: var(--text-primary);
  background: var(--bg-raised);
}

.activity-bar-item.is-active {
  color: var(--brand-v2);
  background: var(--brand-soft);
}

/* ── TopBar ──────────────────────────────────── */

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.topbar-separator {
  width: 1px;
  height: 16px;
  background: var(--border);
  flex-shrink: 0;
}

.topbar-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.topbar-project-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast);
}

.topbar-project-switcher:hover {
  background: var(--bg-raised);
}

.topbar-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-raised);
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast);
}

.topbar-avatar:hover {
  background: var(--brand-soft);
  color: var(--brand-v2);
}

/* ── StatusBar ───────────────────────────────── */

.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-base);
  flex-shrink: 0;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.statusbar-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-v2);
}

/* ── Panel Layout ────────────────────────────── */

.panel-group {
  height: 100%;
}

.panel-content {
  height: 100%;
  overflow-y: auto;
}

.panel-list {
  border-right: 1px solid var(--border);
  background: var(--bg-surface);
}

.panel-content-main {
  background: var(--bg-base);
}

.panel-inspector {
  border-left: 1px solid var(--border);
  background: var(--bg-surface);
}

.panel-resize-handle {
  position: relative;
  width: 4px;
  cursor: col-resize;
}

.panel-resize-handle-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border);
  transition: width var(--duration-fast), background var(--duration-fast);
}

.panel-resize-handle:hover .panel-resize-handle-bar,
.panel-resize-handle[data-resize-handle-active] .panel-resize-handle-bar {
  width: 3px;
  background: var(--brand-v2);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/ConsoleShell.tsx apps/web/styles/globals.css
git commit -m "feat(console): add ConsoleShell layout wrapper with dark CSS"
```

---

### Task 7: Create CommandPalette component

The CommandPalette is a Cmd+K overlay built on shadcn Command (cmdk). It provides quick navigation and actions.

**Files:**
- Create: `apps/web/components/console/CommandPalette.tsx`

**Key behavior:**
- Global `useEffect` listening for `Cmd+K` / `Ctrl+K`
- Opens in a shadcn Dialog with a Command inside
- Three groups: Navigate, Actions, Search
- Navigate: jump to any console page
- Actions: create dataset, start training, switch project
- Keyboard up/down + Enter to confirm
- Framer Motion entrance animation (scale 0.95→1, opacity 0→1)

- [ ] **Step 1: Create the CommandPalette component**

```tsx
// apps/web/components/console/CommandPalette.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const NAVIGATION_ITEMS = [
  { label: "Dashboard", href: "/app" },
  { label: "Projects", href: "/app/projects" },
  { label: "Datasets", href: "/app/datasets" },
  { label: "Train", href: "/app/train" },
  { label: "Models", href: "/app/models" },
  { label: "Eval", href: "/app/eval" },
  { label: "Settings", href: "/app/settings" },
];

const ACTION_ITEMS = [
  { label: "Create new project", href: "/app/projects" },
  { label: "Create new dataset", href: "/app/datasets" },
  { label: "Start training job", href: "/app/train" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAVIGATION_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              onSelect={() => navigate(item.href)}
            >
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          {ACTION_ITEMS.map((item) => (
            <CommandItem
              key={`action-${item.href}`}
              onSelect={() => navigate(item.href)}
            >
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/CommandPalette.tsx
git commit -m "feat(console): add CommandPalette with Cmd+K navigation"
```

---

### Task 8: Wire ConsoleShell into console layout

Replace the current AppShell in the console layout with the new ConsoleShell. Keep ProjectProvider. Add CommandPalette and ToastProvider.

**Files:**
- Modify: `apps/web/app/(console)/layout.tsx`

- [ ] **Step 1: Update console layout**

Replace the current layout body. The new layout keeps the `useEffect` that sets `data-theme="console"` and `dark` class. It replaces `<AppShell>` with `<ConsoleShell>` and adds `<CommandPalette>`.

```tsx
// apps/web/app/(console)/layout.tsx
"use client";

import { useEffect } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "console");
    root.classList.add("dark");
    return () => {
      root.removeAttribute("data-theme");
      root.classList.remove("dark");
    };
  }, []);

  return (
    <ProjectProvider>
      <ConsoleShell>{children}</ConsoleShell>
      <CommandPalette />
      <Toaster />
    </ProjectProvider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(console)/layout.tsx
git commit -m "feat(console): wire ConsoleShell, CommandPalette, and Toaster into layout"
```

---

## Chunk 2: Page Migrations

Each page needs to be migrated from the old AppShell (which provided its own header/kicker) to the new PanelLayout. The old AppShell rendered the header and `console-surface` wrapper — those go away. Each page now renders directly inside PanelLayout's ContentPanel.

### Task 9: Migrate Dashboard page

Dashboard uses full-width ContentPanel (no ListPanel/InspectorPanel). Wrap existing content in PanelLayout. Remove `console-surface` wrapper dependency — the page renders directly in the content panel.

**Files:**
- Modify: `apps/web/app/(console)/app/page.tsx`

- [ ] **Step 1: Update Dashboard page**

Wrap the page content in `<PanelLayout>` with no side panels. The existing ContentRail and StudioSection components render inside ContentPanel. Add a page header inside the content since AppShell no longer provides one.

```tsx
// Top of file: add PanelLayout import
import { PanelLayout } from "@/components/console/PanelLayout";

// In the return statement, wrap everything in PanelLayout:
return (
  <PanelLayout storageKey="console-dashboard">
    <div className="p-6 space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
          Studio Overview
        </p>
        <h1 className="mt-2 text-2xl font-bold">数据工作台总览</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          先看状态，再决定下一步进入项目、数据集、训练还是模型仓。
        </p>
      </div>
      {/* existing ContentRail and StudioSections */}
    </div>
  </PanelLayout>
);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(console)/app/page.tsx
git commit -m "feat(console): migrate dashboard page to PanelLayout"
```

---

### Task 10: Migrate Projects pages

Both projects list and detail pages use full-width ContentPanel.

**Files:**
- Modify: `apps/web/app/(console)/app/projects/page.tsx`
- Modify: `apps/web/app/(console)/app/projects/[id]/page.tsx`

- [ ] **Step 1: Update projects list page**

Wrap in PanelLayout, add page header, preserve existing form and table logic.

- [ ] **Step 2: Update projects detail page**

Wrap in PanelLayout, add page header, preserve existing detail/grid logic.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(console)/app/projects/
git commit -m "feat(console): migrate projects pages to PanelLayout"
```

---

### Task 11: Migrate Datasets pages

Datasets list page: full-width ContentPanel with create form + table.
Datasets detail page ([id]): ContentPanel with uploader + sample browser.

**Files:**
- Modify: `apps/web/app/(console)/app/datasets/page.tsx`
- Modify: `apps/web/app/(console)/app/datasets/[id]/page.tsx`

- [ ] **Step 1: Update datasets list page**

Wrap in PanelLayout with page header.

- [ ] **Step 2: Update datasets detail page**

Wrap in PanelLayout with page header. The uploader and sample browser go in ContentPanel. Version sidebar info can go in InspectorPanel if present, or stay inline.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(console)/app/datasets/
git commit -m "feat(console): migrate datasets pages to PanelLayout"
```

---

### Task 12: Migrate Train pages

Train list page: full-width ContentPanel with create form + job table.
Train detail page ([id]): ContentPanel with logs/metrics, optional InspectorPanel with params.

**Files:**
- Modify: `apps/web/app/(console)/app/train/page.tsx`
- Modify: `apps/web/app/(console)/app/train/[id]/page.tsx`

- [ ] **Step 1: Update train list page**

Wrap in PanelLayout with page header.

- [ ] **Step 2: Update train detail page**

Wrap in PanelLayout. Main content (logs, metrics, artifacts) in ContentPanel. Job parameters and status info in InspectorPanel.

```tsx
return (
  <PanelLayout
    storageKey="console-train-detail"
    inspectorPanel={
      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">Parameters</p>
          <pre className="mt-2 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
            {JSON.stringify(job.params, null, 2)}
          </pre>
        </div>
        {/* status, artifacts summary */}
      </div>
    }
  >
    <div className="p-6 space-y-6">
      {/* page header, JobLogViewer, MetricChart */}
    </div>
  </PanelLayout>
);
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(console)/app/train/
git commit -m "feat(console): migrate train pages to PanelLayout with inspector"
```

---

### Task 13: Migrate Models pages

Models list page: full-width ContentPanel.
Models detail page ([id]): ContentPanel with version management. InspectorPanel with alias/deploy status.

**Files:**
- Modify: `apps/web/app/(console)/app/models/page.tsx`
- Modify: `apps/web/app/(console)/app/models/[id]/page.tsx`

- [ ] **Step 1: Update models list page**

Wrap in PanelLayout with page header.

- [ ] **Step 2: Update models detail page**

Wrap in PanelLayout. Version table + create version form in ContentPanel. Alias management (prod/staging/dev) in InspectorPanel.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(console)/app/models/
git commit -m "feat(console): migrate models pages to PanelLayout with inspector"
```

---

### Task 14: Migrate Eval page

Eval page uses full-width ContentPanel for the comparison form and results.

**Files:**
- Modify: `apps/web/app/(console)/app/eval/page.tsx`

- [ ] **Step 1: Update eval page**

Wrap in PanelLayout with page header. The comparison form and results table stay in ContentPanel. When eval results are loaded and have sample playback data, render it in InspectorPanel.

- [ ] **Step 2: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(console)/app/eval/page.tsx
git commit -m "feat(console): migrate eval page to PanelLayout"
```

---

### Task 15: Migrate Settings, Devices, and Billing pages

These are simple pages — full-width ContentPanel with no side panels.

**Files:**
- Modify: `apps/web/app/(console)/app/settings/page.tsx`
- Modify: `apps/web/app/(console)/app/devices/page.tsx`
- Modify: `apps/web/app/(console)/app/billing/page.tsx`

- [ ] **Step 1: Update all three pages**

Wrap each in PanelLayout with page header. Preserve existing content.

- [ ] **Step 2: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(console)/app/settings/ apps/web/app/(console)/app/devices/ apps/web/app/(console)/app/billing/
git commit -m "feat(console): migrate settings, devices, billing to PanelLayout"
```

---

## Chunk 3: Console CSS Migration + Polish

### Task 16: Migrate console component CSS to dark tokens

The existing console CSS (`.console-panel`, `.console-input`, `.console-button`, `.console-form-grid`, `.console-key-item`, `.studio-section`, `.content-rail`, etc.) uses light glassmorphic styles with `rgba(255,255,255,...)` backgrounds, `var(--fg)`, `var(--muted)`, and `var(--line)` legacy tokens. These need to be updated to use the v2 dark tokens within `[data-theme="console"]` scope.

**Files:**
- Modify: `apps/web/styles/globals.css`

**Approach:** Add `[data-theme="console"]` overrides for all console component classes. This keeps the light styles intact for any potential reuse and ensures dark mode works correctly.

- [ ] **Step 1: Add dark overrides for console components**

Add these rules after the existing console CSS:

```css
/* ── Console component dark overrides ─────────── */

[data-theme="console"] .console-panel,
[data-theme="console"] .demo-panel {
  border-color: var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: none;
  backdrop-filter: none;
}

[data-theme="console"] .console-panel::before {
  display: none;
}

[data-theme="console"] .studio-section {
  border-color: var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: none;
  backdrop-filter: none;
}

[data-theme="console"] .studio-section::before {
  display: none;
}

[data-theme="console"] .studio-section-title {
  color: var(--text-primary);
}

[data-theme="console"] .studio-section-description {
  color: var(--text-secondary);
}

[data-theme="console"] .console-input,
[data-theme="console"] .console-select,
[data-theme="console"] .console-textarea {
  border-color: var(--border);
  background: var(--bg-raised);
  color: var(--text-primary);
}

[data-theme="console"] .console-input::placeholder,
[data-theme="console"] .console-select::placeholder,
[data-theme="console"] .console-textarea::placeholder {
  color: var(--text-secondary);
}

[data-theme="console"] .console-input:focus,
[data-theme="console"] .console-select:focus,
[data-theme="console"] .console-textarea:focus {
  border-color: var(--brand-v2);
  outline: none;
}

[data-theme="console"] .console-button {
  background: var(--brand-v2);
  color: #ffffff;
  box-shadow: none;
}

[data-theme="console"] .console-button-secondary {
  border-color: var(--border);
  background: transparent;
  color: var(--text-primary);
}

[data-theme="console"] .console-button-danger {
  background: var(--error);
  color: #ffffff;
}

[data-theme="console"] .console-key-item {
  border-color: var(--border);
  background: var(--bg-raised);
}

[data-theme="console"] .console-key-label {
  color: var(--text-secondary);
}

[data-theme="console"] .console-key-value {
  color: var(--text-primary);
}

[data-theme="console"] .console-kicker {
  color: var(--text-secondary);
}

[data-theme="console"] .console-title {
  color: var(--text-primary);
}

[data-theme="console"] .console-description {
  color: var(--text-secondary);
}

[data-theme="console"] .console-empty {
  color: var(--text-secondary);
}

[data-theme="console"] .console-table-surface {
  border-color: var(--border);
  background: var(--bg-surface);
}

[data-theme="console"] .console-table-surface thead tr {
  background: var(--bg-raised);
}

[data-theme="console"] .console-table-surface th {
  color: var(--text-secondary);
  border-color: var(--border);
}

[data-theme="console"] .console-table-surface td {
  border-color: var(--border);
}

[data-theme="console"] .content-rail.is-metrics .content-rail-track {
  border-color: var(--border);
  background: var(--bg-surface);
  box-shadow: none;
  backdrop-filter: none;
}

[data-theme="console"] .content-rail-item:not(:last-child) {
  border-color: var(--border);
}

[data-theme="console"] .content-rail-item-label {
  color: var(--text-secondary);
}

[data-theme="console"] .content-rail-item-meta {
  color: var(--text-secondary);
}

[data-theme="console"] .content-rail-item h3 {
  color: var(--text-primary);
}

[data-theme="console"] .content-rail-item p {
  color: var(--text-secondary);
}

[data-theme="console"] .content-rail-track {
  border-color: var(--border);
}

[data-theme="console"] .console-note-item {
  color: var(--text-secondary);
  border-color: var(--border);
}
```

- [ ] **Step 2: Verify dark mode rendering**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors. Visually: all console panels, inputs, buttons, tables, and text should use dark tokens.

- [ ] **Step 3: Commit**

```bash
git add apps/web/styles/globals.css
git commit -m "feat(console): add dark theme CSS overrides for all console components"
```

---

### Task 17: Add Framer Motion console animations

Add subtle Framer Motion animations for console page transitions and panel interactions.

**Files:**
- Create: `apps/web/components/console/PageTransition.tsx`
- Modify: console pages (wrap content in PageTransition)

- [ ] **Step 1: Create PageTransition wrapper**

```tsx
// apps/web/components/console/PageTransition.tsx
"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Add PageTransition to each console page**

In each page component's return, wrap the PanelLayout children in `<PageTransition>`:

```tsx
<PanelLayout>
  <PageTransition>
    <div className="p-6 space-y-6">
      {/* existing content */}
    </div>
  </PageTransition>
</PanelLayout>
```

Apply to: Dashboard, Projects (list + detail), Datasets (list + detail), Train (list + detail), Models (list + detail), Eval, Settings, Devices, Billing — 14 pages total.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/PageTransition.tsx apps/web/app/\(console\)/
git commit -m "feat(console): add Framer Motion page transitions"
```

---

### Task 18: Mobile responsive console

For `< lg` screens: ActivityBar hidden, replaced by a hamburger menu in TopBar. Three-panel layout collapses to single-column ContentPanel only. For `< md` screens: TopBar simplified, StatusBar hidden.

**Files:**
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/components/console/TopBar.tsx` (add hamburger button for mobile)
- Create: `apps/web/components/console/MobileConsoleNav.tsx` (slide-out nav drawer)

- [ ] **Step 1: Add responsive CSS**

```css
/* ── Console mobile ──────────────────────────── */

@media (max-width: 1023px) {
  .activity-bar {
    display: none;
  }
  .panel-list,
  .panel-inspector,
  .panel-resize-handle {
    display: none;
  }
  .topbar-hamburger {
    display: flex;
  }
}

@media (min-width: 1024px) {
  .topbar-hamburger {
    display: none;
  }
}

@media (max-width: 767px) {
  .statusbar {
    display: none;
  }
  .topbar-breadcrumb {
    display: none;
  }
  .topbar-separator:not(:first-of-type) {
    display: none;
  }
}
```

- [ ] **Step 2: Create MobileConsoleNav**

A full-screen dark overlay nav triggered by the hamburger button. Same navigation items as ActivityBar but with labels. Uses Framer Motion AnimatePresence for enter/exit.

- [ ] **Step 3: Add hamburger to TopBar**

Add a `topbar-hamburger` button in the TopBar that toggles MobileConsoleNav.

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/console/MobileConsoleNav.tsx apps/web/components/console/TopBar.tsx apps/web/styles/globals.css
git commit -m "feat(console): add mobile responsive layout with hamburger nav"
```

---

### Task 19: Update StatusBadge for dark tokens

StatusBadge currently uses legacy color tokens (`var(--warning)`, `var(--danger)`, etc.). Update to use v2 tokens.

**Files:**
- Modify: `apps/web/components/StatusBadge.tsx`

- [ ] **Step 1: Update color map**

```tsx
const colorMap: Record<JobStatus, { tone: string; label: string }> = {
  pending: { tone: "bg-[rgba(251,191,36,0.12)] text-[var(--warning-v2)]", label: "待执行" },
  running: { tone: "bg-[rgba(15,118,255,0.12)] text-[var(--brand-v2)]", label: "运行中" },
  succeeded: { tone: "bg-[rgba(74,222,128,0.12)] text-[var(--success-v2)]", label: "已完成" },
  failed: { tone: "bg-[rgba(248,113,113,0.12)] text-[var(--error)]", label: "失败" },
  canceled: { tone: "bg-[var(--bg-raised)] text-[var(--text-secondary)]", label: "已取消" },
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/StatusBadge.tsx
git commit -m "feat(console): update StatusBadge to v2 dark tokens"
```

---

### Task 20: Console Playwright smoke tests

Write Playwright tests verifying the console shell renders correctly.

**Files:**
- Create: `apps/web/tests/console-shell.spec.ts`

**Test cases:**
1. Console page loads with dark theme attributes (`data-theme="console"`, `class="dark"`)
2. ActivityBar is visible on desktop, hidden on mobile
3. TopBar renders with breadcrumbs
4. Cmd+K opens command palette
5. StatusBar visible on desktop, hidden on mobile
6. Navigation via ActivityBar works

- [ ] **Step 1: Write test file**

```ts
// apps/web/tests/console-shell.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Console Shell", () => {
  test("applies dark theme", async ({ page }) => {
    await page.goto("/app");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "console");
    await expect(html).toHaveClass(/dark/);
  });

  test("ActivityBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".activity-bar")).toBeVisible();
  });

  test("ActivityBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".activity-bar")).not.toBeVisible();
  });

  test("Cmd+K opens command palette", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("Meta+k");
    await expect(page.locator("[role='dialog']")).toBeVisible();
  });

  test("navigation works via ActivityBar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await page.click(".activity-bar-item[aria-label='Datasets']");
    await expect(page).toHaveURL(/\/app\/datasets/);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/console-shell.spec.ts
git commit -m "test(console): add Playwright smoke tests for console shell"
```
