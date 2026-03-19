# Console Skeleton: Navigation + Layout + Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all developer-facing modules and rebuild the console skeleton with a new 5-item expandable sidebar and consumer Dashboard.

**Architecture:** Delete knowledge/training/models routes and related i18n files. Replace the IconBar (52px icon-only) + ListPanel (180px collapsible) dual-sidebar with a single expandable sidebar (56px → 200px on hover). Rebuild the Dashboard from developer metrics to consumer-friendly assistant overview.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind CSS, next-intl, clsx

**Spec:** `docs/superpowers/specs/2026-03-19-console-consumer-redesign.md`

---

### Task 1: Delete old route directories

**Files:**
- Delete: `apps/web/app/[locale]/(console)/app/knowledge/` (entire directory)
- Delete: `apps/web/app/[locale]/(console)/app/training/` (entire directory)
- Delete: `apps/web/app/[locale]/(console)/app/models/` (entire directory)
- Delete: `apps/web/app/[locale]/(console)/app/assistants/[id]/versions/` (entire directory)

- [ ] **Step 1: Delete knowledge route directory**

```bash
rm -rf apps/web/app/\[locale\]/\(console\)/app/knowledge
```

- [ ] **Step 2: Delete training route directory**

```bash
rm -rf apps/web/app/\[locale\]/\(console\)/app/training
```

- [ ] **Step 3: Delete models route directory**

```bash
rm -rf apps/web/app/\[locale\]/\(console\)/app/models
```

- [ ] **Step 4: Delete assistant versions route**

```bash
rm -rf apps/web/app/\[locale\]/\(console\)/app/assistants/\[id\]/versions
```

- [ ] **Step 5: Delete old i18n message files**

```bash
rm apps/web/messages/zh/console-knowledge.json
rm apps/web/messages/en/console-knowledge.json
rm apps/web/messages/zh/console-training.json
rm apps/web/messages/en/console-training.json
rm apps/web/messages/zh/console-models-v2.json
rm apps/web/messages/en/console-models-v2.json
```

- [ ] **Step 6: Verify build doesn't reference deleted files**

```bash
cd apps/web && npx next build 2>&1 | head -40
```

Expected: Build errors about missing imports in files that reference deleted routes. These will be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: delete knowledge, training, models routes and i18n files"
```

---

### Task 2: Replace IconBar with expandable Sidebar

**Files:**
- Create: `apps/web/components/console/Sidebar.tsx`
- Delete: `apps/web/components/console/IconBar.tsx` (after Sidebar is working)

- [ ] **Step 1: Create Sidebar component**

Create `apps/web/components/console/Sidebar.tsx`:

```tsx
"use client";

import clsx from "clsx";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  key: string;
  Icon: () => JSX.Element;
}

/* ── Icons ── */

function HomeIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2v4m0 12v4m-7.07-15.07l2.83 2.83m8.48 8.48l2.83 2.83m-17.07 0l2.83-2.83m8.48-8.48l2.83-2.83" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function DiscoverIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={10} />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="sidebar-v2" role="navigation" aria-label="Main">
        {/* Logo */}
        <div className="sidebar-v2-logo">
          <div className="sidebar-v2-logo-icon">铭</div>
          <div className="sidebar-v2-logo-text">铭润科技</div>
        </div>

        {/* Nav items */}
        <div className="sidebar-v2-nav">
          {NAV_ITEMS.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  prefetch={false}
                  className={clsx("sidebar-v2-item", isActive(item.href) && "is-active")}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <span className="sidebar-v2-icon">
                    <item.Icon />
                  </span>
                  <span className="sidebar-v2-label">{t(item.key)}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="sidebar-v2-tooltip">
                {t(item.key)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* User area */}
        <div className="sidebar-v2-footer">
          <Link href="/app/settings" prefetch={false} className="sidebar-v2-user">
            <span className="sidebar-v2-icon">
              <SettingsIcon />
            </span>
            <span className="sidebar-v2-label">{t("nav.settings")}</span>
          </Link>
        </div>
      </nav>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/console/Sidebar.tsx && git commit -m "feat: add expandable Sidebar component"
```

---

### Task 3: Add Sidebar CSS

**Files:**
- Modify: `apps/web/styles/globals.css`

- [ ] **Step 1: Add sidebar-v2 CSS**

Add the following CSS to `globals.css` after the existing `.icon-bar` section (around line 5650). Do NOT delete the old `.icon-bar` styles yet — they'll be removed when we delete the IconBar component.

```css
/* ── Expandable Sidebar v2 ── */

.sidebar-v2 {
  width: 56px;
  min-width: 56px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 300ms cubic-bezier(0.22, 1, 0.36, 1),
              min-width 300ms cubic-bezier(0.22, 1, 0.36, 1);
  flex-shrink: 0;
  z-index: 10;
}

.sidebar-v2:hover {
  width: 200px;
  min-width: 200px;
}

/* Hide tooltip when sidebar is expanded */
.sidebar-v2:hover .sidebar-v2-tooltip {
  display: none !important;
}

.sidebar-v2-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 20px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-v2-logo-icon {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: var(--radius-md);
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 700;
}

.sidebar-v2-logo-text {
  font-weight: 700;
  font-size: 15px;
  color: var(--text-primary);
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 200ms ease 100ms, transform 200ms ease 100ms;
}

.sidebar-v2:hover .sidebar-v2-logo-text {
  opacity: 1;
  transform: translateX(0);
}

.sidebar-v2-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.sidebar-v2-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background var(--duration-fast) ease;
  position: relative;
  text-decoration: none;
  color: var(--text-secondary);
}

.sidebar-v2-item:hover {
  background: color-mix(in srgb, var(--text-primary) 5%, transparent);
}

.sidebar-v2-item.is-active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.sidebar-v2-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}

.sidebar-v2-icon {
  width: 24px;
  min-width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-v2-item.is-active .sidebar-v2-icon {
  color: var(--accent);
}

.sidebar-v2-label {
  font-size: 13px;
  font-weight: 500;
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 200ms ease 100ms, transform 200ms ease 100ms;
}

.sidebar-v2-item.is-active .sidebar-v2-label {
  color: var(--accent);
  font-weight: 600;
}

.sidebar-v2:hover .sidebar-v2-label {
  opacity: 1;
  transform: translateX(0);
}

.sidebar-v2-footer {
  padding: 8px;
  border-top: 1px solid var(--border);
  margin: 0 8px;
}

.sidebar-v2-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-decoration: none;
  color: var(--text-secondary);
  transition: background var(--duration-fast) ease;
}

.sidebar-v2-user:hover {
  background: color-mix(in srgb, var(--text-primary) 5%, transparent);
}

/* Hide sidebar on mobile — MobileTabBar handles it */
@media (max-width: 767px) {
  .sidebar-v2 {
    display: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/styles/globals.css && git commit -m "feat: add expandable sidebar CSS"
```

---

### Task 4: Update ConsoleShell to use Sidebar

**Files:**
- Modify: `apps/web/components/console/ConsoleShell.tsx`

- [ ] **Step 1: Replace IconBar + ListPanel with Sidebar**

Replace the entire contents of `ConsoleShell.tsx`:

```tsx
"use client";

import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { InlineTopBar } from "./InlineTopBar";
import { StatusBar } from "./StatusBar";

interface ConsoleShellProps {
  children: ReactNode;
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <div className="console-shell-v2">
      <div className="console-shell-body-v2">
        <Sidebar />
        <main className="console-shell-main">
          <InlineTopBar />
          <div className="console-shell-content">{children}</div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
```

Note: `layout.tsx` does NOT need changes — `ConsoleShell` is already called as `<ConsoleShell>{children}</ConsoleShell>` without a `listContent` prop. The `listContent` was resolved internally via regex, which is now removed.

- [ ] **Step 2: Delete IconBar.tsx and ConsoleSectionList.tsx**

ConsoleSectionList is no longer imported by ConsoleShell, so delete it now.

```bash
rm apps/web/components/console/ConsoleSectionList.tsx
```

```bash
rm apps/web/components/console/IconBar.tsx
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: replace IconBar + ListPanel with expandable Sidebar in ConsoleShell"
```

---

### Task 5: Update MobileTabBar for new 5 items

**Files:**
- Modify: `apps/web/components/console/MobileTabBar.tsx`

- [ ] **Step 1: Replace nav items**

Update `MAIN_TABS` (line 136) to:

```tsx
const MAIN_TABS = [
  { href: "/app", labelKey: "nav.home" as const, short: "首页", Icon: HomeIcon },
  { href: "/app/chat", labelKey: "nav.chat" as const, short: "对话", Icon: ChatIcon },
  { href: "/app/memory", labelKey: "nav.memory" as const, short: "记忆", Icon: MemoryIcon },
  { href: "/app/devices", labelKey: "nav.devices" as const, short: "设备", Icon: DevicesIcon },
  { href: "/app/discover", labelKey: "nav.discover" as const, short: "发现", Icon: DiscoverIcon },
];
```

Remove `MORE_ITEMS` array entirely. Remove `KnowledgeIcon`, `TrainingIcon`, `MoreIcon` functions. Replace `DevicesIcon` with the headphone SVG version from Sidebar.tsx (the current one is a phone icon). Add `HomeIcon`, `MemoryIcon`, `DiscoverIcon` functions (same SVGs as in Sidebar.tsx). Remove the "更多" dropdown button and its `moreOpen` state/ref/effect — all 5 items are now direct tabs.

- [ ] **Step 2: Simplify MobileTabBar render — remove dropdown**

Replace the dropdown logic. The component should just render 5 direct tab links, no "more" menu.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/MobileTabBar.tsx && git commit -m "feat: update MobileTabBar with new 5-item navigation"
```

---

### Task 6: Clean up secondary references

**Files:**
- Modify: `apps/web/components/console/CommandPalette.tsx`
- Modify: `apps/web/components/console/InlineTopBar.tsx`
- Modify: `apps/web/components/console/ConsoleSectionList.tsx`
- Modify: `apps/web/components/UnifiedMobileNav.tsx`
- Modify: `apps/web/components/AppShell.tsx`

- [ ] **Step 1: Update CommandPalette — remove old nav items and actions, add new ones**

In `CommandPalette.tsx`:
- `NAVIGATION_ITEMS` array: remove items for `/app/knowledge`, `/app/training`, `/app/models`. Add items for `/app` (首页), `/app/memory` (记忆), `/app/discover` (发现)
- `ACTION_ITEMS` array: remove `{ key: "cmd.startTraining", href: "/app/training" }` (references deleted route)

- [ ] **Step 2: Update InlineTopBar — remove old route regex**

In `InlineTopBar.tsx` line 55, update the project selector regex from:
```ts
/^\/app\/(assistants|knowledge|training|chat)(?:\/|$)/
```
to:
```ts
/^\/app\/(assistants|chat)(?:\/|$)/
```

- [ ] **Step 3: Update UnifiedMobileNav**

In `UnifiedMobileNav.tsx`, find `CONSOLE_NAV_ITEMS` and:
- Remove items for `/app/knowledge`, `/app/training`, `/app/models`
- Add items for `/app` (首页), `/app/memory` (记忆), `/app/discover` (发现)

- [ ] **Step 4: Update AppShell**

In `AppShell.tsx`:
- `NAV_KEYS` array: remove `{ href: "/app/knowledge", key: "knowledge" }` and `{ href: "/app/training", key: "training" }`. Add `{ href: "/app/memory", key: "memory" }` and `{ href: "/app/discover", key: "discover" }`. Note: `models` is NOT in this array so no removal needed; `/app` (dashboard) already exists as `{ href: "/app", key: "dashboard" }`.
- `ROUTE_KEYS` array: remove the `knowledge` and `training` match entries. Add `{ match: (p: string) => p.startsWith("/app/memory"), key: "memory" }` and `{ match: (p: string) => p.startsWith("/app/discover"), key: "discover" }`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: clean up references to deleted knowledge/training/models routes"
```

---

### Task 7: Update i18n messages

**Files:**
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Update Chinese console messages**

In `apps/web/messages/zh/console.json`:
- Remove: `"nav.knowledge"`, `"nav.training"`, `"nav.models"`
- Remove: `"breadcrumb.knowledge"`, `"breadcrumb.training"`, `"breadcrumb.models"`
- Remove: dashboard metric keys for datasets/jobs/models if present
- Add: `"nav.home": "首页"`, `"nav.memory": "记忆"`, `"nav.discover": "发现"`
- Add: `"breadcrumb.memory": "记忆"`, `"breadcrumb.discover": "发现"`

- [ ] **Step 2: Update English console messages**

In `apps/web/messages/en/console.json`:
- Same removals as Chinese
- Add: `"nav.home": "Home"`, `"nav.memory": "Memory"`, `"nav.discover": "Discover"`
- Add: `"breadcrumb.memory": "Memory"`, `"breadcrumb.discover": "Discover"`

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/ && git commit -m "feat: update i18n messages for new navigation structure"
```

---

### Task 8: Rebuild Dashboard page

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/page.tsx`

- [ ] **Step 1: Replace old Dashboard with consumer-friendly version**

Replace the entire contents of `page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { PageTransition } from "@/components/console/PageTransition";
import { apiGet } from "@/lib/api";

type Project = { id: string; name: string };

export default function DashboardPage() {
  const t = useTranslations("console");
  const router = useRouter();
  const [assistants, setAssistants] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => setAssistants(data.items || []))
      .catch(() => setAssistants([]))
      .finally(() => setLoading(false));
  }, []);

  const firstAssistant = assistants[0];

  return (
    <PageTransition>
      <div className="dashboard-consumer">
        {/* Welcome */}
        <div className="dashboard-welcome">
          <h1 className="dashboard-welcome-title">{t("dashboard.welcome")}</h1>
          <p className="dashboard-welcome-sub">{t("dashboard.welcomeSub")}</p>
        </div>

        {/* Assistant card */}
        {firstAssistant && (
          <div className="dashboard-assistant-card" onClick={() => router.push(`/app/assistants/${firstAssistant.id}`)}>
            <div className="dashboard-assistant-avatar">
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" />
                <rect width={16} height={12} x={4} y={8} rx={2} />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <div className="dashboard-assistant-info">
              <div className="dashboard-assistant-name">{firstAssistant.name}</div>
              <div className="dashboard-assistant-meta">{t("dashboard.assistantOnline")}</div>
            </div>
            <button
              type="button"
              className="dashboard-chat-btn"
              onClick={(e) => { e.stopPropagation(); router.push("/app/chat"); }}
            >
              {t("dashboard.startChat")}
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="dashboard-stats">
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">{assistants.length}</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.assistants")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">-</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.memories")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">-</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.devices")}</div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
```

- [ ] **Step 2: Add Dashboard CSS**

Add to `globals.css`:

```css
/* ── Consumer Dashboard ── */

.dashboard-consumer {
  padding: 28px 32px;
  max-width: 800px;
}

.dashboard-welcome-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.dashboard-welcome-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 24px;
}

.dashboard-assistant-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  margin-bottom: 20px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow var(--duration-normal) ease;
}

.dashboard-assistant-card:hover {
  box-shadow: var(--shadow-card);
}

.dashboard-assistant-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, white));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.dashboard-assistant-info {
  flex: 1;
}

.dashboard-assistant-name {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

.dashboard-assistant-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.dashboard-chat-btn {
  background: var(--accent);
  color: white;
  padding: 10px 20px;
  border-radius: 24px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast) ease;
  flex-shrink: 0;
}

.dashboard-assistant-card {
  cursor: pointer;
}

.dashboard-chat-btn:hover {
  filter: brightness(0.9);
}

.dashboard-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.dashboard-stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
}

.dashboard-stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}

.dashboard-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
```

- [ ] **Step 3: Add Dashboard i18n keys**

In `apps/web/messages/zh/console.json`, add:
```json
"dashboard.welcome": "欢迎回来",
"dashboard.welcomeSub": "你的助手在等你",
"dashboard.assistantOnline": "在线",
"dashboard.startChat": "开始聊天",
"dashboard.stat.assistants": "助手",
"dashboard.stat.memories": "记忆总数",
"dashboard.stat.devices": "已连接设备"
```

In `apps/web/messages/en/console.json`, add:
```json
"dashboard.welcome": "Welcome back",
"dashboard.welcomeSub": "Your assistant is waiting",
"dashboard.assistantOnline": "Online",
"dashboard.startChat": "Start chatting",
"dashboard.stat.assistants": "Assistants",
"dashboard.stat.memories": "Total memories",
"dashboard.stat.devices": "Connected devices"
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: rebuild Dashboard as consumer-friendly assistant overview"
```

---

### Task 9: Add placeholder routes for new pages

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/memory/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/discover/page.tsx`

- [ ] **Step 1: Create memory page placeholder**

```tsx
import { PageTransition } from "@/components/console/PageTransition";

export default function MemoryPage() {
  return (
    <PageTransition>
      <div className="p-6">
        <h1 className="text-xl font-bold">记忆</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">记忆图谱和管理功能将在 Plan 2 中实现。</p>
      </div>
    </PageTransition>
  );
}
```

- [ ] **Step 2: Create discover page placeholder**

```tsx
import { PageTransition } from "@/components/console/PageTransition";

export default function DiscoverPage() {
  return (
    <PageTransition>
      <div className="p-6">
        <h1 className="text-xl font-bold">发现</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">记忆包和模型市场将在 Plan 3 中实现。</p>
      </div>
    </PageTransition>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add placeholder routes for memory and discover pages"
```

---

### Task 10: Clean up old CSS and verify build

**Files:**
- Modify: `apps/web/styles/globals.css`

- [ ] **Step 1: Remove old icon-bar CSS**

In `globals.css`, remove the `.icon-bar`, `.icon-bar-top`, `.icon-bar-bottom`, `.icon-bar-item` classes (around lines 5607-5650).

- [ ] **Step 2: Remove old list-panel CSS**

Remove `.list-panel`, `.list-panel.is-collapsed`, `.list-panel-content`, `.list-panel-toggle` classes (around lines 5654-5698).

- [ ] **Step 3: Remove orphaned mobile CSS rules**

Search for any `.icon-bar` or `.list-panel` references in mobile media queries (around lines 5975-6012) and remove them.

- [ ] **Step 4: Delete ListPanel.tsx**

```bash
rm apps/web/components/console/ListPanel.tsx
```

Note: ConsoleSectionList.tsx was already deleted in Task 4.

- [ ] **Step 5: Run build to verify**

```bash
cd apps/web && npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: remove old icon-bar and list-panel CSS, delete unused components"
```

---

### Task 11: Update tests

**Files:**
- Modify: `apps/web/tests/foundation.spec.ts`
- Modify: `apps/web/tests/smoke.spec.ts`
- Modify: `apps/web/tests/console-shell.spec.ts`

- [ ] **Step 1: Update tests to remove references to deleted routes**

In all test files, remove or update tests that:
- Navigate to `/app/knowledge`, `/app/training`, `/app/models`
- Assert the existence of knowledge/training/models nav items
- Test ListPanel collapse behavior (if specific to old layout)

Add basic tests for:
- Sidebar renders with 5 nav items
- Dashboard page loads
- Navigation to `/app/memory` and `/app/discover` doesn't 404

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npx playwright test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: update tests for new navigation structure"
```
