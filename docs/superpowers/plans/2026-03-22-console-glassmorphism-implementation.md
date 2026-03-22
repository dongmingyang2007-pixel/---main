# Console Glassmorphism Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the console from a warm cream theme to a glassmorphism aesthetic with blue-purple accents, while preserving all existing functionality.

**Architecture:** Create a new `glass/` component library (GlassCard, GlassPanel, GlassButton, GlassInput, GlassTopBar, GlassStatusBar, AmbientBackground), then refactor the shell layout (sidebar overlay, unified top bar), and finally restyle each page. The sidebar gains overlay-expand behavior and absorbs the chat conversation list.

**Tech Stack:** Next.js 16 (App Router), TailwindCSS, framer-motion, next-intl, next/font/google, shadcn/ui (Radix)

**Spec:** `docs/superpowers/specs/2026-03-22-console-glassmorphism-redesign.md`

---

## File Map

### New Files (all under `apps/web/`)

| File | Responsibility |
|------|---------------|
| `components/console/glass/GlassCard.tsx` | Standard glass container component |
| `components/console/glass/GlassPanel.tsx` | Structural panel (sidebar, inspector) |
| `components/console/glass/GlassButton.tsx` | 3-variant button (Primary, Secondary, Ghost) |
| `components/console/glass/GlassInput.tsx` | Text input with glass styling |
| `components/console/glass/GlassTopBar.tsx` | Unified top navigation bar (replaces ConsoleTopBar + InlineTopBar + UnifiedHeader) |
| `components/console/glass/GlassStatusBar.tsx` | Bottom status bar |
| `components/console/glass/AmbientBackground.tsx` | Gradient background + blurred ambient blobs |
| `components/console/glass/index.ts` | Barrel export for all glass components |
| `components/console/ChatHeader.tsx` | Chat conversation info + mode switcher (extracted from ChatInterface) |
| `components/console/ChatMessages.tsx` | Chat message list + streaming display (extracted from ChatInterface) |

### Modified Files (all under `apps/web/`)

| File | Change |
|------|--------|
| `styles/globals.css` | Replace `[data-theme="console"]` tokens with glass theme; update shadcn bridge variables |
| `app/[locale]/layout.tsx` | Add Sora + Noto Sans SC fonts via next/font/google |
| `app/[locale]/(console)/layout.tsx` | Replace UnifiedHeader with GlassTopBar; remove MobileTabBar/MobileNav temporarily |
| `components/console/ConsoleShell.tsx` | New layout: AmbientBackground + sidebar + main content (remove InlineTopBar, StatusBar) |
| `components/console/Sidebar.tsx` | Add overlay expand (hover), render conversation list on chat page |
| `components/console/PageTransition.tsx` | Update animation: add blur transition + slide-up + stagger |
| `components/console/ChatInterface.tsx` | Extract ChatHeader + ChatMessages; keep as orchestrator |
| `components/console/ChatInputBar.tsx` | Restyle to glass theme (preserve all logic) |
| `components/console/ChatMessageList.tsx` | Restyle messages: gradient user bubbles, glass AI bubbles |
| `app/[locale]/(console)/app/chat/page.tsx` | Remove PanelLayout + ConversationSidebar; render ChatInterface directly |
| `app/[locale]/(console)/app/page.tsx` | Restyle dashboard with GlassCard; remove project selector card |
| `app/[locale]/(console)/app/assistants/page.tsx` | Restyle to glass card grid |
| `app/[locale]/(console)/app/assistants/[id]/page.tsx` | Restyle hero card + tabs + content to glass |
| `app/[locale]/(console)/app/discover/page.tsx` | Restyle filter rail + model grid to glass |
| `app/[locale]/(console)/app/settings/page.tsx` | Restyle form sections to glass |
| `app/[locale]/(console)/app/memory/page.tsx` | Restyle panels to glass |
| `app/[locale]/(console)/app/devices/page.tsx` | Restyle device page, remove PanelLayout |
| `app/[locale]/(console)/app/assistants/new/page.tsx` | Restyle create assistant page, remove PanelLayout |
| `app/[locale]/(console)/app/discover/models/[...modelId]/page.tsx` | Restyle model detail page |
| `app/[locale]/(console)/app/discover/packs/[id]/page.tsx` | Restyle pack detail page |
| `components/console/Breadcrumb.tsx` | Update text colors to new palette |
| `components/console/ChatModePanel.tsx` | Restyle to glass segmented control |
| `components/console/ModelPickerModal.tsx` | Restyle modal overlay to glass |
| `components/console/CommandPalette.tsx` | Update overlay and input styling to glass |
| `components/console/MobileTabBar.tsx` | Glass background, new accent colors |
| `components/UnifiedMobileNav.tsx` | Glass drawer background |

### Removed Files

| File | Reason |
|------|--------|
| `components/console/ConsoleTopBar.tsx` | Merged into GlassTopBar |
| `components/console/InlineTopBar.tsx` | Merged into GlassTopBar |
| `components/console/StatusBar.tsx` | Replaced by GlassStatusBar |
| `components/console/PanelLayout.tsx` | No longer used (chat page goes full-width) |
| `app/[locale]/(console)/app/chat/ConversationSidebar.tsx` | Merged into Sidebar overlay |
| `components/console/ConsoleTopBar.tsx` | Dead code (already unused), clean up |

**Note on UnifiedHeader**: `components/UnifiedHeader.tsx` is shared between public site and console. The console layout stops importing it, but the file itself is NOT deleted (used by public pages).

---

## Task 1: CSS Theme Token Migration

**Files:**
- Modify: `apps/web/styles/globals.css` (lines 141-205, the `[data-theme="console"]` block)

- [ ] **Step 1: Read the current theme block**

Read `apps/web/styles/globals.css` lines 141-205 to see all existing CSS variables.

- [ ] **Step 2: Replace the `[data-theme="console"]` color tokens**

Replace the entire variable block inside `[data-theme="console"]` with:

```css
[data-theme="console"] {
  /* ── Glass Background ── */
  --console-bg: linear-gradient(135deg, #e8f0fe 0%, #ede8f8 50%, #fce8e8 100%);
  --console-surface: rgba(255,255,255,0.55);
  --console-panel: rgba(255,255,255,0.4);
  --console-topbar: rgba(255,255,255,0.35);
  --console-card: rgba(255,255,255,0.55);
  --console-border: rgba(255,255,255,0.7);
  --console-border-subtle: rgba(255,255,255,0.5);

  /* ── Accent ── */
  --console-accent: #6366f1;
  --console-accent-secondary: #8b5cf6;
  --console-accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);
  --console-accent-soft: rgba(99,102,241,0.1);

  /* ── Text ── */
  --console-text-primary: #1a1a2e;
  --console-text-secondary: #374151;
  --console-text-muted: #6b7280;
  --console-text-faint: #9ca3af;

  /* ── Semantic ── */
  --console-success: #10b981;
  --console-success-soft: rgba(16,185,129,0.08);
  --console-warning: #f59e0b;
  --console-warning-soft: rgba(245,158,11,0.1);
  --console-error: #ef4444;
  --console-error-soft: rgba(239,68,68,0.08);

  /* ── Model Slot Colors ── */
  --console-slot-brain: #6366f1;
  --console-slot-realtime: #8b5cf6;
  --console-slot-asr: #3b82f6;
  --console-slot-tts: #10b981;
  --console-slot-vision: #f59e0b;
  --console-slot-realtime-asr: #3b82f6;
  --console-slot-realtime-tts: #14b8a6;

  /* ── Radii (console-scoped, does NOT override root --radius-*) ── */
  --console-radius-sm: 8px;
  --console-radius-md: 12px;
  --console-radius-lg: 16px;
  --console-radius-xl: 20px;

  /* ── Shadows ── */
  --console-shadow-card: 0 2px 12px rgba(0,0,0,0.04);
  --console-shadow-raised: 0 4px 24px rgba(0,0,0,0.06);
  --console-shadow-overlay: 0 8px 32px rgba(0,0,0,0.08);
  --console-shadow-primary: 0 2px 8px rgba(99,102,241,0.25);

  /* ── Font Stack ── */
  --font-title: var(--font-sora), var(--font-dm-sans), "Noto Sans SC", "PingFang SC", sans-serif;
  --font-body: var(--font-dm-sans), "Noto Sans SC", "PingFang SC", -apple-system, sans-serif;
  --font-mono: var(--font-mono), "JetBrains Mono", monospace;

  /* ── shadcn/ui Bridge ── */
  --background: #f0ecf8;
  --foreground: var(--console-text-primary);
  --card: var(--console-surface);
  --card-foreground: var(--console-text-primary);
  --popover: rgba(255,255,255,0.9);
  --popover-foreground: var(--console-text-primary);
  --primary: var(--console-accent);
  --primary-foreground: #ffffff;
  --secondary: rgba(255,255,255,0.6);
  --secondary-foreground: var(--console-text-primary);
  --muted-v2: rgba(255,255,255,0.4);
  --muted-foreground: var(--console-text-muted);
  --accent-v2: rgba(255,255,255,0.5);
  --accent-foreground: var(--console-text-primary);
  --destructive: var(--console-error);
  --destructive-foreground: #ffffff;
  --ring: var(--console-accent);
  --input: var(--console-border);
}
```

- [ ] **Step 3: Update body override**

Replace the `[data-theme="console"] body` block:

```css
[data-theme="console"] body {
  background: var(--console-bg);
  color: var(--console-text-primary);
}
[data-theme="console"] body::before { display: none; }
```

- [ ] **Step 4: Add backdrop-filter fallback**

Add after the theme block:

```css
@supports not (backdrop-filter: blur(1px)) {
  [data-theme="console"] .glass-surface { background: rgba(255,255,255,0.9); }
  [data-theme="console"] .glass-panel { background: rgba(255,255,255,0.85); }
  [data-theme="console"] .glass-topbar { background: rgba(255,255,255,0.92); }
}
```

- [ ] **Step 5: Verify the app still renders**

Run: `cd apps/web && npx next dev`
Expected: Console loads (it will look broken — colors changed but components haven't yet). No build errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/styles/globals.css
git commit -m "feat(console): migrate CSS theme tokens to glassmorphism palette"
```

---

## Task 2: Add Fonts (Sora + Noto Sans SC)

**Files:**
- Modify: `apps/web/app/[locale]/layout.tsx` (lines 1-28, font imports section)

- [ ] **Step 1: Read font loading section**

Read `apps/web/app/[locale]/layout.tsx` lines 1-30.

- [ ] **Step 2: Add Sora and Noto Sans SC imports**

Add alongside the existing font imports:

```tsx
import { DM_Sans, JetBrains_Mono, Sora, Noto_Sans_SC } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-sora",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});
```

- [ ] **Step 3: Wire font variables into the html/body className**

Find where `dmSans.variable`, `inter.variable`, `jetbrainsMono.variable` are combined into a className string. Add `sora.variable` and `notoSansSC.variable` to that string.

- [ ] **Step 4: Verify fonts load**

Run: `cd apps/web && npx next dev`
Open browser DevTools → Network → filter "font". Verify Sora and Noto Sans SC fonts download.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/layout.tsx
git commit -m "feat(console): add Sora and Noto Sans SC font loading"
```

---

## Task 3: Glass Primitive Components

**Files:**
- Create: `apps/web/components/console/glass/GlassCard.tsx`
- Create: `apps/web/components/console/glass/GlassPanel.tsx`
- Create: `apps/web/components/console/glass/GlassButton.tsx`
- Create: `apps/web/components/console/glass/GlassInput.tsx`
- Create: `apps/web/components/console/glass/AmbientBackground.tsx`
- Create: `apps/web/components/console/glass/index.ts`

- [ ] **Step 1: Create GlassCard**

```tsx
// apps/web/components/console/glass/GlassCard.tsx
import { type ReactNode } from "react";
import clsx from "clsx";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function GlassCard({ children, className, hover = false }: GlassCardProps) {
  return (
    <div
      className={clsx("glass-card", hover && "glass-card--hover", className)}
      style={{
        background: "var(--console-surface)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--console-border)",
        borderRadius: "var(--console-radius-lg)",
        padding: "20px",
        boxShadow: "var(--console-shadow-card)",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create GlassPanel**

```tsx
// apps/web/components/console/glass/GlassPanel.tsx
import { type ReactNode } from "react";
import clsx from "clsx";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
}

export function GlassPanel({ children, className }: GlassPanelProps) {
  return (
    <div
      className={clsx("glass-panel", className)}
      style={{
        background: "var(--console-panel)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--console-border-subtle)",
        borderRadius: "var(--console-radius-lg)",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create GlassButton**

```tsx
// apps/web/components/console/glass/GlassButton.tsx
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

type GlassButtonVariant = "primary" | "secondary" | "ghost";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassButtonVariant;
  children: ReactNode;
}

const variantStyles: Record<GlassButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--console-accent-gradient)",
    color: "#ffffff",
    border: "none",
    boxShadow: "var(--console-shadow-primary)",
  },
  secondary: {
    background: "rgba(255,255,255,0.6)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "var(--console-text-primary)",
    border: "1px solid rgba(0,0,0,0.08)",
  },
  ghost: {
    background: "transparent",
    color: "var(--console-accent)",
    border: "1px solid rgba(99,102,241,0.3)",
  },
};

export function GlassButton({
  variant = "primary",
  children,
  className,
  style,
  ...props
}: GlassButtonProps) {
  return (
    <button
      className={clsx("glass-button", `glass-button--${variant}`, className)}
      style={{
        borderRadius: "var(--console-radius-md)",
        padding: "9px 20px",
        fontWeight: 600,
        fontSize: "12px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        transition: "filter 100ms",
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Create GlassInput**

```tsx
// apps/web/components/console/glass/GlassInput.tsx
import { type InputHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className, icon, style, ...props }, ref) => (
    <div
      className={clsx("glass-input-wrapper", className)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(255,255,255,0.5)",
        border: "1px solid var(--console-border)",
        borderRadius: "var(--console-radius-md)",
        padding: "10px 14px",
        ...style,
      }}
    >
      {icon}
      <input
        ref={ref}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: "13px",
          color: "var(--console-text-primary)",
        }}
        {...props}
      />
    </div>
  )
);
GlassInput.displayName = "GlassInput";
```

- [ ] **Step 5: Create AmbientBackground**

```tsx
// apps/web/components/console/glass/AmbientBackground.tsx
export function AmbientBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background: "var(--console-bg)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 350,
          height: 350,
          borderRadius: "50%",
          background: "rgba(99,102,241,0.08)",
          filter: "blur(90px)",
          top: "-100px",
          right: "5%",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: "rgba(139,92,246,0.06)",
          filter: "blur(70px)",
          bottom: "-60px",
          left: "15%",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Create barrel export**

```tsx
// apps/web/components/console/glass/index.ts
export { GlassCard } from "./GlassCard";
export { GlassPanel } from "./GlassPanel";
export { GlassButton } from "./GlassButton";
export { GlassInput } from "./GlassInput";
export { AmbientBackground } from "./AmbientBackground";
```

- [ ] **Step 7: Verify imports resolve**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors from the new files.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/console/glass/
git commit -m "feat(console): add glass primitive components"
```

---

## Task 4: GlassTopBar + GlassStatusBar

**Files:**
- Create: `apps/web/components/console/glass/GlassTopBar.tsx`
- Create: `apps/web/components/console/glass/GlassStatusBar.tsx`
- Modify: `apps/web/components/console/glass/index.ts`

- [ ] **Step 1: Read ConsoleTopBar.tsx for logic to preserve**

Read `apps/web/components/console/ConsoleTopBar.tsx` (59 lines). Note: branding, ⌘K, language toggle, user avatar dropdown with logout.

- [ ] **Step 2: Read InlineTopBar.tsx for project select logic**

Read `apps/web/components/console/InlineTopBar.tsx` (93 lines). Note: mobile menu button, breadcrumb, project selector dropdown.

- [ ] **Step 3: Read StatusBar.tsx for status logic**

Read `apps/web/components/console/StatusBar.tsx` (28 lines). Note: project name display, version number.

- [ ] **Step 4: Create GlassTopBar**

Combine logic from ConsoleTopBar (branding, ⌘K, language, user menu) + InlineTopBar (mobile menu button). Do NOT include the project selector (moved to sidebar) or breadcrumb (will be rendered by the page itself if needed).

```tsx
// apps/web/components/console/glass/GlassTopBar.tsx
"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { logout } from "@/lib/api";
import { useMobileMenu } from "@/components/MobileMenuProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function GlassTopBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const { openMenu } = useMobileMenu();
  const nextLocale = locale === "zh" ? "en" : "zh";

  return (
    <header
      className="glass-topbar"
      style={{
        position: "fixed",
        top: 0,
        left: 56,
        right: 0,
        height: 48,
        background: "var(--console-topbar)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Mobile menu toggle */}
        <button
          className="inline-topbar-menu"
          onClick={openMenu}
          aria-label="Menu"
          style={{ display: "none" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/app" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ fontSize: 14, color: "var(--console-text-primary)", fontWeight: 700 }}>铭润</span>
        </Link>
        <span
          style={{
            fontSize: 10,
            color: "var(--console-accent)",
            background: "var(--console-accent-soft)",
            padding: "2px 8px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          Console
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          className="console-topbar-kbd"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.04)",
            border: "none",
            fontSize: 10,
            color: "var(--console-text-faint)",
            cursor: "pointer",
          }}
        >
          <kbd>⌘</kbd> K
        </button>
        <Link
          href={pathname}
          locale={nextLocale}
          style={{
            fontSize: 12,
            color: "var(--console-text-muted)",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {locale === "zh" ? "EN" : "中文"}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "var(--console-accent-soft)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 11,
                color: "var(--console-accent)",
                fontWeight: 600,
              }}
            >
              U
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Create GlassStatusBar**

```tsx
// apps/web/components/console/glass/GlassStatusBar.tsx
"use client";

import { useTranslations } from "next-intl";
import { useProjectContext } from "@/lib/ProjectContext";
import { buildProjectDisplayMap } from "@/lib/project-display";

export function GlassStatusBar() {
  const { projectId, projects } = useProjectContext();
  const projectLabels = buildProjectDisplayMap(projects);
  const t = useTranslations("console");

  const currentProject = projects.find((p) => p.id === projectId);
  const displayName = currentProject
    ? projectLabels.get(currentProject.id) || currentProject.name
    : t("statusbar.noProject");

  return (
    <div
      className="glass-statusbar"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 0,
        left: 56,
        right: 0,
        height: 28,
        background: "rgba(255,255,255,0.3)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(255,255,255,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "var(--console-success)",
            display: "inline-block",
          }}
          title={t("statusbar.apiConnected")}
        />
        <span style={{ fontSize: 10, color: "var(--console-text-muted)" }}>
          {displayName}
        </span>
      </div>
      <span style={{ fontSize: 10, color: "var(--console-text-faint)" }}>v0.1</span>
    </div>
  );
}
```

- [ ] **Step 6: Update barrel export**

Add to `apps/web/components/console/glass/index.ts`:

```tsx
export { GlassTopBar } from "./GlassTopBar";
export { GlassStatusBar } from "./GlassStatusBar";
```

- [ ] **Step 7: Verify types**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/console/glass/
git commit -m "feat(console): add GlassTopBar and GlassStatusBar components"
```

---

## Task 5: Console Shell + Layout Refactor

**Files:**
- Modify: `apps/web/components/console/ConsoleShell.tsx`
- Modify: `apps/web/app/[locale]/(console)/layout.tsx`

- [ ] **Step 1: Read current ConsoleShell.tsx**

Read `apps/web/components/console/ConsoleShell.tsx` (25 lines).

- [ ] **Step 2: Read current console layout.tsx**

Read `apps/web/app/[locale]/(console)/layout.tsx` (39 lines).

- [ ] **Step 3: Rewrite ConsoleShell.tsx**

Replace the entire file. The new shell uses AmbientBackground + Sidebar + main content area. GlassTopBar and GlassStatusBar are rendered in the console layout instead.

```tsx
// apps/web/components/console/ConsoleShell.tsx
import { type ReactNode } from "react";
import { AmbientBackground } from "./glass";
import Sidebar from "./Sidebar";

interface ConsoleShellProps {
  children: ReactNode;
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <div className="console-shell-v2" style={{ position: "relative", minHeight: "100vh" }}>
      <AmbientBackground />
      <Sidebar />
      <main
        className="console-shell-main"
        style={{
          position: "relative",
          zIndex: 1,
          marginLeft: 56,
          marginTop: 48,
          marginBottom: 28,
          minHeight: "calc(100vh - 48px - 28px)",
          overflowY: "auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Update console layout.tsx**

Replace `UnifiedHeader` with `GlassTopBar` and `GlassStatusBar`. Remove the old imports.

Read the current file first, then replace `UnifiedHeader` import/usage with:

```tsx
import { GlassTopBar, GlassStatusBar } from "@/components/console/glass";
```

In the JSX, replace `<UnifiedHeader />` with `<GlassTopBar />` and add `<GlassStatusBar />` after `<ConsoleShell>`.

- [ ] **Step 5: Verify console loads**

Run: `cd apps/web && npx next dev`
Navigate to `/app`. The layout should render with: ambient gradient background, glass top bar, sidebar (still old style), glass status bar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/console/ConsoleShell.tsx apps/web/app/[locale]/(console)/layout.tsx
git commit -m "feat(console): refactor shell layout with glass topbar, statusbar, and ambient background"
```

---

## Task 6: Sidebar Overlay Behavior

**Files:**
- Modify: `apps/web/components/console/Sidebar.tsx`
- Modify: `apps/web/styles/globals.css` (sidebar styles section)

- [ ] **Step 1: Read current Sidebar.tsx**

Read `apps/web/components/console/Sidebar.tsx` in full.

- [ ] **Step 2: Read ConversationSidebar.tsx for chat list logic**

Read `apps/web/app/[locale]/(console)/app/chat/ConversationSidebar.tsx` in full. Note the conversation list rendering, search, date grouping, create/delete logic, and the `ConversationSidebarHandle` ref interface.

- [ ] **Step 3: Rewrite Sidebar.tsx with overlay expand**

The sidebar needs:
- Collapsed state (56px): icon-only nav, glass background
- Expanded state (on hover): 260px overlay with full nav + project list (or conversation list on chat page)
- `position: absolute` when expanded, does NOT push content
- Semi-transparent overlay backdrop, click to dismiss
- framer-motion for slide animation

This is the most complex component. Key points:
- Use `useState` for `isExpanded`
- Use `usePathname` to detect `/app/chat` for conversation list context
- Use `onMouseEnter`/`onMouseLeave` for hover trigger
- The conversation list logic from ConversationSidebar needs to be integrated (project context, API calls for conversations, search, date grouping)
- Export a ref handle so the chat page can call `handleConversationActivity` on it

Write the component with the full expanded content for default pages first. The chat-specific conversation list integration will be a sub-step.

- [ ] **Step 4: Add sidebar CSS to globals.css**

Add glass-specific sidebar styles for the collapsed and expanded states. Include the overlay backdrop animation.

- [ ] **Step 5: Test sidebar hover expand/collapse**

Navigate to `/app`. Hover on sidebar: should expand to 260px with overlay. Move mouse away: should collapse. Click overlay backdrop: should collapse. Main content should NOT shift position.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/console/Sidebar.tsx apps/web/styles/globals.css
git commit -m "feat(console): sidebar overlay expand with glass styling"
```

---

## Task 7: Chat Page Layout Refactor

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/chat/page.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`
- Modify: `apps/web/components/console/ChatInputBar.tsx`
- Modify: `apps/web/components/console/ChatMessageList.tsx`

- [ ] **Step 1: Read current chat page.tsx**

Read `apps/web/app/[locale]/(console)/app/chat/page.tsx` (83 lines).

- [ ] **Step 2: Read ChatInterface.tsx**

Read `apps/web/components/console/ChatInterface.tsx` (855 lines). Identify: workspace header, mode panel, message list, input bar, streaming logic, voice controls sections.

- [ ] **Step 3: Simplify chat page.tsx — remove PanelLayout + ConversationSidebar**

The chat page no longer uses PanelLayout or renders ConversationSidebar directly. It renders ChatInterface full-width. Conversation selection is now handled through the sidebar (Task 6). The page still manages `activeConversationId` and `selectedProjectId` state, passing them to ChatInterface.

Remove imports: PanelLayout, ConversationSidebar.
Keep: ChatInterface, PageTransition, useSearchParams, state management.

- [ ] **Step 4: Restyle ChatInterface.tsx**

Update the workspace header to use glass styling (GlassCard-style chat header bar with conversation name + mode switcher). Update the overall container to remove any panel-related layout. Keep ALL business logic (streaming, voice, modes, etc.) unchanged.

- [ ] **Step 5: Restyle ChatInputBar.tsx**

Read `apps/web/components/console/ChatInputBar.tsx`. Update styling to glass theme: glass background input bar, updated colors for tool chips, gradient send button. Keep ALL existing logic (image upload, dictation, tool chip toggles, submit handler).

- [ ] **Step 6: Restyle ChatMessageList.tsx**

Read `apps/web/components/console/ChatMessageList.tsx`. Update message bubble styles:
- User messages: `var(--console-accent-gradient)` background, white text, rounded corners `18px 18px 6px 18px`
- AI messages: glass background, logo avatar, rounded `18px 18px 18px 6px`
- Keep ALL existing logic: AnimatedMessageText, read-aloud, reasoning content, memory extraction.

- [ ] **Step 7: Test chat functionality end-to-end**

Navigate to `/app/chat`:
- Verify messages display with new bubble styles
- Send a text message → verify streaming works
- Switch chat modes → verify mode switcher works
- Open sidebar → verify conversation list appears
- Create new conversation → verify it works
- Test voice input if available

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/chat/ apps/web/components/console/ChatInterface.tsx apps/web/components/console/ChatInputBar.tsx apps/web/components/console/ChatMessageList.tsx
git commit -m "feat(console): restyle chat page with glass theme and full-width layout"
```

---

## Task 8: Dashboard Page Restyle

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/page.tsx`

- [ ] **Step 1: Read current dashboard page.tsx**

Read `apps/web/app/[locale]/(console)/app/page.tsx` in full.

- [ ] **Step 2: Restyle dashboard with Glass components**

Replace ConsolePrimitives usage (ConsoleRailList, ConsoleSectionBlock, ConsoleInspectorPanel, ConsolePageHeader) with GlassCard-based layout. Preserve:
- 3-column grid layout (240px | 1fr | 240px)
- 我的 AI / 发现 tabs
- Left: project list cards
- Center: realtime summary + 7 model slots + stats + action buttons
- Right: recent conversations
- Remove project selector card (top-right)

All data fetching, API calls, and state logic remain unchanged.

- [ ] **Step 3: Test dashboard**

Navigate to `/app`. Verify:
- All 3 columns render with glass cards
- Project selection updates center column
- 7 model slots display with colored dots
- Action buttons work
- Tabs switch correctly
- No project selector card appears

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/page.tsx
git commit -m "feat(console): restyle dashboard with glass components"
```

---

## Task 9: Assistants Pages Restyle

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/assistants/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/assistants/new/page.tsx`

- [ ] **Step 1: Read assistants list page**

Read `apps/web/app/[locale]/(console)/app/assistants/page.tsx`.

- [ ] **Step 2: Restyle assistants list**

Apply glass card grid: dashed "Create New" card + GlassCard for each assistant. Remove PanelLayout wrapper if present. Replace ConsolePrimitives usage with Glass components. Keep metadata parsing, project filtering, loading skeletons.

- [ ] **Step 3: Read assistant detail page**

Read `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`.

- [ ] **Step 4: Restyle assistant detail**

Apply glass hero card + tab navigation + 2-column content. Remove PanelLayout wrapper if present. Replace ConsolePrimitives usage. Keep all functionality: personality edit, model slot changes, knowledge management, start chat.

- [ ] **Step 5: Read and restyle create assistant page**

Read `apps/web/app/[locale]/(console)/app/assistants/new/page.tsx`. Remove PanelLayout wrapper if present. Apply glass styling. Keep all form logic.

- [ ] **Step 6: Test all assistant pages**

Navigate to `/app/assistants` → verify card grid.
Click "Create New" → verify create page.
Click an assistant → verify detail page with hero card, tabs, model slots, knowledge section.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/
git commit -m "feat(console): restyle assistants pages with glass theme"
```

---

## Task 10: Discover Pages Restyle

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/discover/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/discover/models/[...modelId]/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/discover/packs/[id]/page.tsx`

- [ ] **Step 1: Read and restyle discover main page**

Read `apps/web/app/[locale]/(console)/app/discover/page.tsx`. Apply glass filter rail (left) + glass model card grid (right). Replace ConsolePrimitives usage. Keep: search, category filtering, tabs, picker mode, loading skeletons.

- [ ] **Step 2: Read and restyle model detail page**

Read `apps/web/app/[locale]/(console)/app/discover/models/[...modelId]/page.tsx`. Apply glass styling. Keep all functionality.

- [ ] **Step 3: Read and restyle pack detail page**

Read `apps/web/app/[locale]/(console)/app/discover/packs/[id]/page.tsx`. Apply glass styling. Keep all functionality.

- [ ] **Step 4: Test**

Navigate to `/app/discover` → verify search, category filters, model cards.
Click a model → verify detail page renders with glass styling.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/
git commit -m "feat(console): restyle discover pages with glass theme"
```

---

## Task 11: Settings + Memory + Devices Pages Restyle

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/settings/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/memory/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/devices/page.tsx`

- [ ] **Step 1: Read and restyle settings page**

Read `apps/web/app/[locale]/(console)/app/settings/page.tsx`. Apply GlassCard for each section (Account, Language, Developer Mode, Subscription, Danger Zone). Remove PanelLayout wrapper if present. Replace ConsolePrimitives usage with Glass components. Keep all functionality.

- [ ] **Step 2: Read and restyle memory page**

Read `apps/web/app/[locale]/(console)/app/memory/page.tsx`. Apply glass panels for file list and graph preview. Keep upload, indexing, graph visualization.

- [ ] **Step 3: Read and restyle devices page**

Read `apps/web/app/[locale]/(console)/app/devices/page.tsx`. Remove PanelLayout wrapper. Apply glass styling. Keep all existing functionality.

- [ ] **Step 4: Test all three pages**

Navigate to `/app/settings` → verify all sections.
Navigate to `/app/memory` → verify file list and graph.
Navigate to `/app/devices` → verify page renders correctly.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/settings/ apps/web/app/[locale]/(console)/app/memory/ apps/web/app/[locale]/(console)/app/devices/
git commit -m "feat(console): restyle settings, memory, and devices pages with glass theme"
```

---

## Task 12: Update PageTransition Animation

**Files:**
- Modify: `apps/web/components/console/PageTransition.tsx`

- [ ] **Step 1: Read current PageTransition**

Read `apps/web/components/console/PageTransition.tsx` (16 lines).

- [ ] **Step 2: Update animation values**

```tsx
// apps/web/components/console/PageTransition.tsx
"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/PageTransition.tsx
git commit -m "feat(console): update page transition with blur + slide animation"
```

---

## Task 13: Surviving Components Restyle

**Files:**
- Modify: `apps/web/components/console/Breadcrumb.tsx`
- Modify: `apps/web/components/console/ChatModePanel.tsx`
- Modify: `apps/web/components/console/ModelPickerModal.tsx`
- Modify: `apps/web/components/console/CommandPalette.tsx`
- Modify: `apps/web/components/console/MobileTabBar.tsx`
- Modify: `apps/web/components/UnifiedMobileNav.tsx`

- [ ] **Step 1: Read and restyle Breadcrumb.tsx**

Update text colors from warm brown to new palette (`--console-text-faint` for separators, `--console-accent` for active segment).

- [ ] **Step 2: Read and restyle ChatModePanel.tsx**

Update to glass segmented control styling (glass background, accent color for active segment).

- [ ] **Step 3: Read and restyle ModelPickerModal.tsx**

Update modal overlay and card styling to glass theme.

- [ ] **Step 4: Read and restyle CommandPalette.tsx**

Update overlay backdrop and input styling to glass theme.

- [ ] **Step 5: Read and restyle MobileTabBar.tsx**

Update to glass background with new accent colors.

- [ ] **Step 6: Read and restyle UnifiedMobileNav.tsx**

Update drawer background to glass style.

- [ ] **Step 7: Test each component**

Test: ⌘K command palette, breadcrumb navigation, chat mode switcher, model picker in assistant config, mobile tab bar (resize viewport).

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/console/Breadcrumb.tsx apps/web/components/console/ChatModePanel.tsx apps/web/components/console/ModelPickerModal.tsx apps/web/components/console/CommandPalette.tsx apps/web/components/console/MobileTabBar.tsx apps/web/components/UnifiedMobileNav.tsx
git commit -m "feat(console): restyle surviving components to glass theme"
```

---

## Task 14: Cleanup + Remove Old Components

**Files:**
- Delete: `apps/web/components/console/ConsoleTopBar.tsx`
- Delete: `apps/web/components/console/InlineTopBar.tsx`
- Delete: `apps/web/components/console/StatusBar.tsx`
- Delete: `apps/web/components/console/PanelLayout.tsx`
- Delete: `apps/web/app/[locale]/(console)/app/chat/ConversationSidebar.tsx`

- [ ] **Step 1: Search for remaining imports of old components**

Run grep for: `ConsoleTopBar`, `InlineTopBar`, `StatusBar` (as import), `PanelLayout`, `ConversationSidebar` across all `.tsx` files. Fix any remaining imports.

**IMPORTANT**: `PanelLayout` is used by 6 pages (chat, devices, settings, assistants list, assistants new, assistants detail). Tasks 7, 9, and 11 should have already removed these imports. Verify ALL are gone before deleting the file.

- [ ] **Step 2: Delete old files**

```bash
rm apps/web/components/console/ConsoleTopBar.tsx
rm apps/web/components/console/InlineTopBar.tsx
rm apps/web/components/console/StatusBar.tsx
rm apps/web/components/console/PanelLayout.tsx
rm apps/web/app/[locale]/(console)/app/chat/ConversationSidebar.tsx
```

- [ ] **Step 3: Verify build**

Run: `cd apps/web && npx next build`
Expected: Build succeeds with no import errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(console): remove old shell components replaced by glass equivalents"
```

---

## Task 15: Final Verification

**Files:** None (testing only)

- [ ] **Step 1: Run existing test suite**

```bash
cd apps/web && npx playwright test tests/console-shell.spec.ts tests/chat-realtime-voice.spec.ts
```

Fix any failures.

- [ ] **Step 2: Manual functionality checklist**

Walk through every item in Spec Section 8 ("Preserved Functionality Checklist"):
- Navigation: sidebar, breadcrumb, ⌘K, language toggle, status bar
- Dashboard: tabs, project list, model slots, action buttons, recent conversations
- Chat: all 3 modes, send/receive, streaming, voice, image upload, tool chips
- Assistants: list, create, detail, edit personality, change models, knowledge
- Discover: browse, search, filter, model details, picker mode
- Settings: account, language, developer mode, subscription, logout, delete
- Memory: file list, upload, graph

- [ ] **Step 3: Test mobile responsiveness**

Resize browser to 375px width. Verify: MobileTabBar shows, content reflows, sidebar hides.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(console): address post-redesign issues from verification pass"
```
