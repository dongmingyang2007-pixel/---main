# Public Site Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the QIHANG public site with cinematic GSAP scroll-driven storytelling, a frosted-glass navigation system, and the new information architecture (Product / Ecosystem / Demo / Pricing / Support / Updates).

**Architecture:** Replace the hand-written `useStoryScroll` hook with GSAP ScrollTrigger for pin/scrub scene choreography. Rewrite the navigation with frosted-glass header + hamburger mobile overlay. Each page is composed of ScrollTrigger-powered scenes with per-scene timelines. The existing 3D viewer bridge (`useViewerBridge`) is retained and synced to GSAP scroll progress. Mobile degrades to fade-in (no pin).

**Tech Stack:** Next.js 16 (App Router), GSAP + ScrollTrigger, Framer Motion, Tailwind CSS, design tokens (v2), existing viewer bridge

**Spec:** `docs/superpowers/specs/2026-03-13-full-site-ui-upgrade-design.md` — Sections 3, 5, 6, 7

**Foundation plan (completed):** `docs/superpowers/plans/2026-03-13-foundation-design-system.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/gsap-register.ts` | One-time GSAP + ScrollTrigger registration |
| `apps/web/lib/useScrollScene.ts` | Hook: creates a ScrollTrigger for a single scene with pin/scrub |
| `apps/web/components/public/SiteHeader.tsx` | Frosted-glass desktop nav + mobile hamburger trigger |
| `apps/web/components/public/MobileNav.tsx` | Full-screen mobile navigation overlay (Framer Motion AnimatePresence) |
| `apps/web/components/public/SiteFooter.tsx` | 4-column footer with accordion on mobile |
| `apps/web/components/public/ScrollScene.tsx` | Wrapper component: one pinned GSAP scene |
| `apps/web/components/public/HeroScene.tsx` | Homepage hero scene |
| `apps/web/components/public/HighlightsScene.tsx` | Homepage 3 selling-point cards |
| `apps/web/components/public/EcosystemPreview.tsx` | Homepage AI ecosystem split-screen |
| `apps/web/components/public/CraftScene.tsx` | Homepage detail close-ups with parallax |
| `apps/web/components/public/CTAScene.tsx` | Homepage final CTA |
| `apps/web/lib/home-content.ts` | Homepage scene data (separated from other page content) |
| `apps/web/app/(public)/ecosystem/page.tsx` | New Ecosystem page |
| `apps/web/app/(public)/support/page.tsx` | New Support page (replaces docs + contact) |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/app/(public)/layout.tsx` | Replace `PublicSiteChrome` with new `SiteHeader` + `SiteFooter` |
| `apps/web/app/(public)/page.tsx` | Complete homepage rewrite using GSAP scenes |
| `apps/web/app/(public)/product/page.tsx` | Rewrite with GSAP ScrollScene |
| `apps/web/app/(public)/pricing/page.tsx` | Rewrite with new design |
| `apps/web/app/(public)/updates/page.tsx` | Rewrite with new design |
| `apps/web/app/(public)/demo/page.tsx` | Adapt to new tokens + layout (minimal structural change) |
| `apps/web/styles/globals.css` | Add public-v2 component styles for new header, footer, scenes |

### Removed Files

| File | Reason |
|------|--------|
| `apps/web/app/(public)/how-it-works/page.tsx` | Redirect to /product (already configured) |
| `apps/web/app/(public)/docs/page.tsx` | Redirect to /support (already configured) |
| `apps/web/app/(public)/contact/page.tsx` | Redirect to /support (already configured) |

### Retained Files (no changes)

| File | Reason |
|------|--------|
| `apps/web/lib/useViewerBridge.ts` | Viewer communication — works as-is |
| `apps/web/lib/useDeferredIframeSrc.ts` | Lazy iframe loading — works as-is |
| `apps/web/lib/qihang-viewer-contract.ts` | Viewer types + constants — works as-is |
| `apps/web/components/TextReveal.tsx` | Character reveal animation — reusable |
| `apps/web/components/MagneticButton.tsx` | Magnetic button — reusable |
| `apps/web/components/PublicDocumentLink.tsx` | Smart link — reusable |
| `apps/web/components/ImagePlaceholder.tsx` | Image placeholder — reusable |

---

## Chunk 1: GSAP Infrastructure + Navigation

### Task 1: GSAP registration module

**Files:**
- Create: `apps/web/lib/gsap-register.ts`

- [ ] **Step 1: Create GSAP registration file**

Create `apps/web/lib/gsap-register.ts`:

```ts
"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };
```

This file is the single import point for GSAP throughout the public site. It ensures `ScrollTrigger` is registered exactly once.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add lib/gsap-register.ts && git commit -m "feat: add GSAP + ScrollTrigger registration module"
```

---

### Task 2: useScrollScene hook

**Files:**
- Create: `apps/web/lib/useScrollScene.ts`

This hook replaces the hand-written `useStoryScroll` for individual scenes. Each scene gets its own ScrollTrigger with pin/scrub support.

- [ ] **Step 1: Create the hook**

Create `apps/web/lib/useScrollScene.ts`:

```ts
"use client";

import { useEffect, useRef, useCallback } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-register";

export interface ScrollSceneOptions {
  /** Pin the scene while scrubbing (desktop only). Default: true */
  pin?: boolean;
  /** Scrub smoothness: true = 1:1, number = smooth seconds. Default: true */
  scrub?: boolean | number;
  /** Extra scroll distance as multiplier of scene height. Default: 1 (100% extra) */
  scrollPad?: number;
  /** Callback with progress 0→1 on every scroll update */
  onProgress?: (progress: number) => void;
  /** Snap to detent positions (e.g., [0, 0.5, 1]). Optional */
  snap?: number[] | false;
  /** Disable pin on mobile (< 768px). Default: true */
  disablePinOnMobile?: boolean;
}

export function useScrollScene(options: ScrollSceneOptions = {}) {
  const {
    pin = true,
    scrub = true,
    scrollPad = 1,
    onProgress,
    snap = false,
    disablePinOnMobile = true,
  } = options;

  const sceneRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Serialize snap to avoid reference equality issues in deps
  const snapKey = snap ? JSON.stringify(snap) : "false";

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;

    const isMobile = window.innerWidth < 768;
    const shouldPin = pin && !(isMobile && disablePinOnMobile);
    const parsedSnap: number[] | false = snapKey !== "false" ? JSON.parse(snapKey) : false;

    const config: ScrollTrigger.Vars = {
      trigger: el,
      start: "top top",
      end: () => `+=${el.offsetHeight * scrollPad}`,
      pin: shouldPin,
      scrub: scrub,
      onUpdate: (self) => {
        onProgressRef.current?.(self.progress);
      },
    };

    if (parsedSnap && !isMobile) {
      config.snap = {
        snapTo: parsedSnap,
        duration: 0.3,
        ease: "power2.inOut",
      };
    }

    triggerRef.current = ScrollTrigger.create(config);

    return () => {
      triggerRef.current?.kill();
      triggerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, scrub, scrollPad, snapKey, disablePinOnMobile]);

  /** Imperatively get current progress (0–1) */
  const getProgress = useCallback(() => triggerRef.current?.progress ?? 0, []);

  return { sceneRef, getProgress };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add lib/useScrollScene.ts && git commit -m "feat: add useScrollScene hook wrapping GSAP ScrollTrigger"
```

---

### Task 3: ScrollScene wrapper component

**Files:**
- Create: `apps/web/components/public/ScrollScene.tsx`

A declarative wrapper that applies `useScrollScene` to a `<section>`. Scenes use this as their outer container.

- [ ] **Step 1: Create the component**

Create `apps/web/components/public/ScrollScene.tsx`:

```tsx
"use client";

import { type ReactNode } from "react";
import { useScrollScene, type ScrollSceneOptions } from "@/lib/useScrollScene";
import { cn } from "@/lib/utils";

interface ScrollSceneProps extends ScrollSceneOptions {
  children: ReactNode;
  className?: string;
  /** Unique ID for the scene (used as section id) */
  id?: string;
}

export function ScrollScene({
  children,
  className,
  id,
  ...scrollOptions
}: ScrollSceneProps) {
  const { sceneRef } = useScrollScene(scrollOptions);

  return (
    <section
      ref={sceneRef as React.RefObject<HTMLElement>}
      id={id}
      className={cn("relative min-h-screen w-full", className)}
    >
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add components/public/ScrollScene.tsx && git commit -m "feat: add ScrollScene declarative wrapper component"
```

---

### Task 4: SiteHeader with frosted glass + mobile nav

**Files:**
- Create: `apps/web/components/public/SiteHeader.tsx`
- Create: `apps/web/components/public/MobileNav.tsx`
- Modify: `apps/web/styles/globals.css` (append new header styles)

- [ ] **Step 1: Create MobileNav component**

Create `apps/web/components/public/MobileNav.tsx`:

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  items: { href: string; label: string }[];
  pathname: string;
}

export function MobileNav({ open, onClose, items, pathname }: MobileNavProps) {
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
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-2"
              aria-label="Close menu"
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

          {/* Bottom CTA
              Note: spec says this should hide when CTA section is in view.
              That behavior requires IntersectionObserver + scroll context
              and will be added in the Convergence plan (mobile polish). */}
          <div className="mt-auto p-8">
            <PublicDocumentLink
              href="/demo"
              className="block w-full rounded-[var(--radius-lg)] bg-[var(--brand-v2)] py-4 text-center text-lg font-semibold text-white"
              onClick={onClose}
            >
              Try Demo
            </PublicDocumentLink>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Create SiteHeader component**

Create `apps/web/components/public/SiteHeader.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import clsx from "clsx";
import { usePathname } from "next/navigation";

import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { MobileNav } from "@/components/public/MobileNav";
import { useScrollNav } from "@/lib/useScrollNav";

const NAV_ITEMS = [
  { href: "/product", label: "Product" },
  { href: "/ecosystem", label: "AI Ecosystem" },
  { href: "/demo", label: "Demo" },
  { href: "/pricing", label: "Pricing" },
  { href: "/support", label: "Support" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { scrolled, hidden, progress } = useScrollNav();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <>
      <header
        className={clsx(
          "site-header-v2",
          scrolled && "is-scrolled",
          hidden && "is-hidden",
        )}
      >
        <div className="mx-auto flex h-full max-w-[var(--site-width)] items-center justify-between px-6">
          {/* Brand */}
          <PublicDocumentLink href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
            <strong className="text-base font-semibold tracking-tight">QIHANG</strong>
          </PublicDocumentLink>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-8 md:flex">
            {NAV_ITEMS.map((item) => (
              <PublicDocumentLink
                key={item.href}
                href={item.href}
                className={clsx(
                  "site-nav-link-v2 text-sm transition-colors",
                  pathname === item.href
                    ? "text-[var(--brand-v2)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {item.label}
                {pathname === item.href && (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[var(--brand-v2)]" />
                )}
              </PublicDocumentLink>
            ))}
            <PublicDocumentLink
              href="/demo"
              className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Get Started
            </PublicDocumentLink>
          </nav>

          {/* Hamburger (mobile) */}
          <button
            className="flex items-center justify-center p-2 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Scroll progress indicator */}
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--brand-v2)] transition-none"
          style={{ width: `${progress * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <MobileNav
        open={mobileOpen}
        onClose={closeMobile}
        items={NAV_ITEMS}
        pathname={pathname}
      />
    </>
  );
}
```

- [ ] **Step 3: Add header CSS to globals.css**

Append to the end of `apps/web/styles/globals.css` (before the ImagePlaceholder section):

```css
/* ── Public site header v2 ───────────────────── */
.site-header-v2 {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  height: 64px;
  transition:
    background-color 0.3s var(--ease-out-v2),
    backdrop-filter 0.3s var(--ease-out-v2),
    transform 0.3s var(--ease-out-v2),
    height 0.3s var(--ease-out-v2);
}
.site-header-v2.is-scrolled {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  height: 56px;
  border-bottom: 1px solid var(--border);
}
.site-header-v2.is-hidden {
  transform: translateY(-100%);
}
.site-nav-link-v2 {
  position: relative;
  padding-bottom: 2px;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd apps/web && git add components/public/SiteHeader.tsx components/public/MobileNav.tsx styles/globals.css && git commit -m "feat: add SiteHeader with frosted glass effect and mobile nav overlay"
```

---

### Task 5: SiteFooter (4-column)

**Files:**
- Create: `apps/web/components/public/SiteFooter.tsx`

- [ ] **Step 1: Create the footer component**

Create `apps/web/components/public/SiteFooter.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/product#specs", label: "Specs" },
      { href: "/product#craftsmanship", label: "Craftsmanship" },
    ],
  },
  {
    title: "AI Ecosystem",
    links: [
      { href: "/ecosystem", label: "Platform" },
      { href: "/demo", label: "Online Demo" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/support", label: "Documentation" },
      { href: "/support#faq", label: "FAQ" },
      { href: "/support#contact", label: "Contact" },
    ],
  },
  {
    title: "About",
    links: [
      { href: "/updates", label: "Updates" },
      { href: "mailto:hello@qihang.ai", label: "Email" },
    ],
  },
];

export function SiteFooter() {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = (title: string) =>
    setOpenSection((prev) => (prev === title ? null : title));

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] py-12">
      <div className="mx-auto grid max-w-[var(--site-width)] gap-8 px-6 md:grid-cols-4">
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            {/* Desktop: always open. Mobile: accordion */}
            <button
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--text-primary)] md:cursor-default md:pointer-events-none"
              onClick={() => toggle(col.title)}
              aria-expanded={openSection === col.title}
            >
              {col.title}
              <svg
                className={`h-4 w-4 transition-transform md:hidden ${
                  openSection === col.title ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <ul
              className={`mt-3 flex flex-col gap-2 overflow-hidden transition-[max-height] duration-300 md:max-h-none ${
                openSection === col.title ? "max-h-40" : "max-h-0 md:max-h-none"
              }`}
            >
              {col.links.map((link) => (
                <li key={link.href}>
                  <PublicDocumentLink
                    href={link.href}
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {link.label}
                  </PublicDocumentLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="mx-auto mt-12 flex max-w-[var(--site-width)] flex-col items-center justify-between gap-4 border-t border-[var(--border)] px-6 pt-8 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-v2)]" />
          <strong className="text-sm font-semibold">QIHANG</strong>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          &copy; 2026 QIHANG. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add components/public/SiteFooter.tsx && git commit -m "feat: add SiteFooter with 4-column layout and mobile accordion"
```

---

### Task 6: Update public layout

**Files:**
- Modify: `apps/web/app/(public)/layout.tsx`

Replace `PublicSiteChrome` with the new header/footer components. The old `PublicSiteChrome` file is NOT deleted yet — it will be removed in Task 16 (cleanup) after all pages are migrated.

- [ ] **Step 1: Update the layout**

Replace the entire file `apps/web/app/(public)/layout.tsx` with:

```tsx
import { SiteHeader } from "@/components/public/SiteHeader";
import { SiteFooter } from "@/components/public/SiteFooter";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="pt-16">{children}</main>
      <SiteFooter />
    </>
  );
}
```

The `pt-16` (64px) compensates for the fixed header height.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/layout.tsx && git commit -m "feat: switch public layout to new SiteHeader + SiteFooter"
```

---

## Chunk 2: Homepage

### Task 7: Homepage content data

**Files:**
- Create: `apps/web/lib/home-content.ts`

Separates homepage scene data from the existing `public-story-content.ts`. Each scene maps to the spec's homepage choreography (Section 3).

- [ ] **Step 1: Create homepage content file**

Create `apps/web/lib/home-content.ts`:

```ts
import type { ViewerState } from "@/lib/qihang-viewer-contract";

export interface HomeScene {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  details?: { label: string; body: string }[];
  /** Viewer state patch applied at scene start */
  viewerPatch?: Partial<ViewerState>;
  /** Scene tone for background color transitions */
  tone: "pearl" | "midnight" | "glacier";
}

export const HOME_SCENES: HomeScene[] = [
  {
    id: "hero",
    eyebrow: "QIHANG / Environment AI",
    title: "看见周围，\n理解周围。",
    body: "一枚随身佩戴的 AI 设备——看见你所处的环境，即时给出反馈。无需掏出手机，无需打开应用。",
    tone: "pearl",
    viewerPatch: {
      isOpen: false,
      colorway: "pearl",
      mode: "offline",
    },
  },
  {
    id: "highlights",
    eyebrow: "Why QIHANG",
    title: "三个核心能力。",
    body: "",
    details: [
      { label: "随身佩戴", body: "胸前相机 + 圆盘盒 + 无线耳机，三件一体。" },
      { label: "即时反馈", body: "拍下画面，几秒内通过耳机收到 AI 语音回答。" },
      { label: "隐私可控", body: "你决定何时开始、何时停止，状态灯始终可见。" },
    ],
    tone: "pearl",
    viewerPatch: {
      isOpen: true,
      earbudsOut: true,
      colorway: "pearl",
    },
  },
  {
    id: "ecosystem",
    eyebrow: "AI Ecosystem",
    title: "不只是硬件。",
    body: "从数据采集到模型训练，从个性化调优到云端部署——完整的 AI 工作台，让设备越用越聪明。",
    details: [
      { label: "数据工作台", body: "上传、标注、版本管理，一站完成。" },
      { label: "模型训练", body: "一键启动训练任务，实时查看曲线和日志。" },
      { label: "个性化部署", body: "模型发布到设备，离线也能推理。" },
    ],
    tone: "midnight",
    viewerPatch: {
      isOpen: true,
      mode: "online",
      colorway: "pearl",
      nightOn: false,
    },
  },
  {
    id: "craft",
    eyebrow: "Craftsmanship",
    title: "每一处细节。",
    body: "112° 精密阻尼铰链、磁吸分离相机、触感确定的开合——工业设计为日常使用而生。",
    tone: "glacier",
    viewerPatch: {
      isOpen: true,
      pivotAngleDeg: 88,
      pivotState: "opening",
      colorway: "glacier",
    },
  },
  {
    id: "cta",
    eyebrow: "",
    title: "准备好了？",
    body: "体验在线 Demo，或了解完整产品。",
    tone: "pearl",
    viewerPatch: {
      isOpen: false,
      colorway: "pearl",
    },
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add lib/home-content.ts && git commit -m "feat: add homepage scene content data"
```

---

### Task 8: Homepage scene components

**Files:**
- Create: `apps/web/components/public/HeroScene.tsx`
- Create: `apps/web/components/public/HighlightsScene.tsx`
- Create: `apps/web/components/public/EcosystemPreview.tsx`
- Create: `apps/web/components/public/CraftScene.tsx`
- Create: `apps/web/components/public/CTAScene.tsx`

- [ ] **Step 1: Create HeroScene**

Create `apps/web/components/public/HeroScene.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { TextReveal } from "@/components/TextReveal";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import type { HomeScene } from "@/lib/home-content";

export function HeroScene({ scene }: { scene: HomeScene }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from(el.querySelector(".hero-body"), { opacity: 0, y: 30, duration: 0.8, delay: 0.3 });
    tl.from(el.querySelector(".hero-image"), { opacity: 0, filter: "blur(8px)", duration: 1 }, "<0.2");
    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="mb-4 text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
        {scene.eyebrow}
      </p>
      <h1 className="text-[var(--font-size-hero)] font-bold leading-tight text-[var(--text-primary)]">
        {scene.title.split("\n").map((line, i) => (
          <span key={i} className="block">
            <TextReveal text={line} tag="span" />
          </span>
        ))}
      </h1>
      <p className="hero-body mt-6 max-w-xl text-lg text-[var(--text-secondary)]">
        {scene.body}
      </p>
      <div className="hero-image mt-12 w-full max-w-2xl">
        <ImagePlaceholder label="Earphone Hero Shot / 3D Viewer" aspect="16/9" icon="photo" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create HighlightsScene**

Create `apps/web/components/public/HighlightsScene.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-register";
import type { HomeScene } from "@/lib/home-content";

export function HighlightsScene({ scene }: { scene: HomeScene }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll(".highlight-card");
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: el,
        start: "top 80%",
        end: "center center",
        scrub: false,
        once: true,
      },
    });
    tl.from(cards, {
      opacity: 0,
      y: 40,
      stagger: 0.12,
      duration: 0.6,
      ease: "power2.out",
    });
    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col items-center justify-center px-6">
      <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
        {scene.eyebrow}
      </p>
      <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
        {scene.title}
      </h2>
      <div className="mt-12 grid w-full max-w-4xl gap-6 md:grid-cols-3">
        {scene.details?.map((d) => (
          <div
            key={d.label}
            className="highlight-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{d.label}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{d.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create EcosystemPreview**

Create `apps/web/components/public/EcosystemPreview.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";
import type { HomeScene } from "@/lib/home-content";

export function EcosystemPreview({ scene }: { scene: HomeScene }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: el,
        start: "top 70%",
        once: true,
      },
    });
    tl.from(el.querySelector(".eco-text"), { opacity: 0, x: -30, duration: 0.7 });
    tl.from(el.querySelector(".eco-visual"), { opacity: 0, x: 30, duration: 0.7 }, "<0.15");
    return () => { tl.kill(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-screen items-center justify-center bg-[var(--bg-surface)] px-6"
    >
      <div className="grid w-full max-w-5xl gap-12 md:grid-cols-2">
        <div className="eco-text flex flex-col justify-center">
          <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
            {scene.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
            {scene.title}
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">{scene.body}</p>
          {scene.details && (
            <ul className="mt-8 flex flex-col gap-4">
              {scene.details.map((d) => (
                <li key={d.label} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-v2)]" />
                  <div>
                    <span className="font-medium text-[var(--text-primary)]">{d.label}</span>
                    <span className="ml-2 text-sm text-[var(--text-secondary)]">{d.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-8">
            <MagneticButton href="/ecosystem" className="inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
              Learn More
            </MagneticButton>
          </div>
        </div>
        <div className="eco-visual flex items-center justify-center">
          <ImagePlaceholder label="AI Ecosystem Illustration" aspect="1/1" icon="image" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create CraftScene**

Create `apps/web/components/public/CraftScene.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import type { HomeScene } from "@/lib/home-content";

export function CraftScene({ scene }: { scene: HomeScene }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const bgLayer = el.querySelector(".craft-bg");
    const fgLayer = el.querySelector(".craft-fg");

    if (bgLayer && fgLayer) {
      gsap.to(bgLayer, {
        yPercent: -15,
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
      gsap.to(fgLayer, {
        yPercent: 10,
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
    }

    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: "top 60%", once: true },
    });
    tl.from(el.querySelector(".craft-copy"), { opacity: 0, y: 30, duration: 0.7 });
    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="relative flex min-h-screen items-center overflow-hidden px-6">
      {/* Parallax background */}
      <div className="craft-bg absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-base)] via-[var(--bg-surface)] to-[var(--bg-base)]" />
      </div>

      <div className="mx-auto grid w-full max-w-5xl gap-12 md:grid-cols-2">
        {/* Close-up images */}
        <div className="craft-fg flex flex-col gap-6">
          <ImagePlaceholder label="Hinge Macro Shot" aspect="4/3" icon="photo" />
          <ImagePlaceholder label="Material Detail" aspect="4/3" icon="photo" />
        </div>

        {/* Copy */}
        <div className="craft-copy flex flex-col justify-center">
          <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
            {scene.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
            {scene.title}
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">{scene.body}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create CTAScene**

Create `apps/web/components/public/CTAScene.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { MagneticButton } from "@/components/MagneticButton";
import type { HomeScene } from "@/lib/home-content";

export function CTAScene({ scene }: { scene: HomeScene }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const buttons = el.querySelectorAll(".cta-btn");
    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: "top 70%", once: true },
    });
    tl.from(el.querySelector(".cta-title"), { opacity: 0, y: 20, duration: 0.6 });
    tl.from(buttons, { opacity: 0, y: 20, stagger: 0.1, duration: 0.5 }, "<0.2");
    return () => { tl.kill(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
    >
      <h2 className="cta-title text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
        {scene.title}
      </h2>
      <p className="mt-4 text-lg text-[var(--text-secondary)]">{scene.body}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <MagneticButton
          href="/demo"
          className="cta-btn inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-4 text-base font-semibold text-white"
        >
          Try Demo
        </MagneticButton>
        <MagneticButton
          href="/product"
          className="cta-btn inline-block rounded-[var(--radius-full)] border border-[var(--border)] px-8 py-4 text-base font-semibold text-[var(--text-primary)]"
        >
          View Product
        </MagneticButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd apps/web && git add components/public/HeroScene.tsx components/public/HighlightsScene.tsx components/public/EcosystemPreview.tsx components/public/CraftScene.tsx components/public/CTAScene.tsx && git commit -m "feat: add homepage scene components (Hero, Highlights, Ecosystem, Craft, CTA)"
```

---

### Task 9: Homepage assembly

**Files:**
- Modify: `apps/web/app/(public)/page.tsx`

Wire all homepage scenes together. The page is a server component that renders scene components in order.

- [ ] **Step 1: Rewrite homepage**

Replace the entire file `apps/web/app/(public)/page.tsx` with:

```tsx
import { HeroScene } from "@/components/public/HeroScene";
import { HighlightsScene } from "@/components/public/HighlightsScene";
import { EcosystemPreview } from "@/components/public/EcosystemPreview";
import { CraftScene } from "@/components/public/CraftScene";
import { CTAScene } from "@/components/public/CTAScene";
import { HOME_SCENES } from "@/lib/home-content";

export default function HomePage() {
  const [hero, highlights, ecosystem, craft, cta] = HOME_SCENES;

  return (
    <div>
      <HeroScene scene={hero} />
      <HighlightsScene scene={highlights} />
      <EcosystemPreview scene={ecosystem} />
      <CraftScene scene={craft} />
      <CTAScene scene={cta} />
    </div>
  );
}
```

Note: The old `HomeScrollStory` component is no longer imported. It is retained in the codebase for reference but not used. The viewer integration (iframe + `useViewerBridge`) will be wired into the homepage in the Convergence plan once the 3D viewer synchronization with GSAP is fully tuned. For now, `ImagePlaceholder` components stand in for viewer positions.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/page.tsx && git commit -m "feat: rewrite homepage with GSAP-powered scene composition"
```

---

## Chunk 3: Content Pages

### Task 10: Product page

**Files:**
- Modify: `apps/web/app/(public)/product/page.tsx`

Rewrite using the new design tokens and scroll-triggered animations. Retains the existing product story content from `public-story-content.ts`.

- [ ] **Step 1: Rewrite product page**

Replace the entire file `apps/web/app/(public)/product/page.tsx` with:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";
import { PRODUCT_STORY_SCENES } from "@/lib/public-story-content";

export default function ProductPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll(".product-section");
    sections.forEach((section) => {
      gsap.from(section, {
        opacity: 0,
        y: 40,
        duration: 0.7,
        ease: "power2.out",
        scrollTrigger: {
          trigger: section,
          start: "top 80%",
          once: true,
        },
      });
    });
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Product
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          随身携带的 AI 感知系统。
        </p>
        <div className="mt-8 w-full max-w-2xl">
          <ImagePlaceholder label="Product Hero Shot" aspect="16/9" icon="photo" />
        </div>
      </section>

      {/* Sections from existing story content */}
      {PRODUCT_STORY_SCENES.map((scene) => (
        <section
          key={scene.id}
          className="product-section mx-auto max-w-5xl px-6 py-20"
        >
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
                {scene.eyebrow}
              </p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
                {scene.title}
              </h2>
              <p className="mt-3 text-[var(--text-secondary)]">{scene.summary}</p>
              <ul className="mt-6 flex flex-col gap-3">
                {scene.details.map((d) => (
                  <li key={d.label} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-v2)]" />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">{d.label}</span>
                      <span className="ml-1 text-sm text-[var(--text-secondary)]">— {d.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-center">
              <ImagePlaceholder
                label={scene.assetSlots[0] || "Product Image"}
                aspect="4/3"
                icon="photo"
              />
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">体验产品</h2>
        <div className="mt-6 flex gap-4">
          <MagneticButton href="/demo" className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
            Try Demo
          </MagneticButton>
          <MagneticButton href="/ecosystem" className="rounded-[var(--radius-full)] border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-primary)]">
            AI Ecosystem
          </MagneticButton>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/product/page.tsx && git commit -m "feat: rewrite product page with GSAP scroll reveals and v2 tokens"
```

---

### Task 11: Ecosystem page (new)

**Files:**
- Create: `apps/web/app/(public)/ecosystem/page.tsx`

New page covering AI platform capabilities: data workspace, model training, personalized deployment.

- [ ] **Step 1: Create ecosystem page**

Create `apps/web/app/(public)/ecosystem/page.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { MagneticButton } from "@/components/MagneticButton";

const CAPABILITIES = [
  {
    title: "Data Workspace",
    description: "Upload, annotate, version — manage your training data end-to-end.",
    icon: "image" as const,
  },
  {
    title: "Model Training",
    description: "Launch training jobs with one click. Monitor metrics, logs, and curves in real time.",
    icon: "image" as const,
  },
  {
    title: "Personalized Deployment",
    description: "Publish models to your devices. Works offline with on-device inference.",
    icon: "image" as const,
  },
  {
    title: "Cloud Sync",
    description: "Keep models, data, and settings synchronized across all your devices.",
    icon: "image" as const,
  },
];

export default function EcosystemPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll(".capability-card");
    gsap.from(cards, {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".capabilities-grid"),
        start: "top 80%",
        once: true,
      },
    });
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          AI Ecosystem
        </p>
        <h1 className="mt-4 text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          不只是硬件。
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          完整的 AI 工作台，从数据采集到模型部署，让设备越用越聪明。
        </p>
      </section>

      {/* Capabilities grid */}
      <section className="capabilities-grid mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="capability-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8"
            >
              <ImagePlaceholder label={`${cap.title} Illustration`} aspect="2/1" icon={cap.icon} />
              <h3 className="mt-6 text-xl font-semibold text-[var(--text-primary)]">{cap.title}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow overview */}
      <section className="bg-[var(--bg-surface)] px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            From Data to Deployment
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">
            Upload → Annotate → Train → Deploy → Monitor. A complete pipeline designed for earphone AI.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <MagneticButton href="/demo" className="rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-6 py-3 text-sm font-medium text-white">
              Try Demo
            </MagneticButton>
            <MagneticButton href="/pricing" className="rounded-[var(--radius-full)] border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--text-primary)]">
              View Pricing
            </MagneticButton>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/ecosystem/page.tsx && git commit -m "feat: add Ecosystem page with capability grid"
```

---

### Task 12: Support page (new — replaces docs + contact)

**Files:**
- Create: `apps/web/app/(public)/support/page.tsx`

Merges documentation hub and contact into a single Support page with sections for docs, FAQ, and contact form.

- [ ] **Step 1: Create support page**

Create `apps/web/app/(public)/support/page.tsx`:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { DOCS_PATH_RAIL } from "@/lib/public-story-content";

const FAQ_ITEMS = [
  { q: "QIHANG 支持哪些设备？", a: "目前支持 QIHANG 圆盘盒系列。更多设备适配即将推出。" },
  { q: "数据安全如何保障？", a: "所有数据加密传输和存储，支持离线模式下完全本地处理。" },
  { q: "训练任务需要多久？", a: "取决于数据集规模。典型任务 5-30 分钟，可在控制台实时查看进度。" },
  { q: "如何开始使用？", a: "访问 Demo 页面即可免费体验核心功能，无需注册。" },
];

export default function SupportPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll(".support-section");
    sections.forEach((section) => {
      gsap.from(section, {
        opacity: 0,
        y: 30,
        duration: 0.6,
        ease: "power2.out",
        scrollTrigger: {
          trigger: section,
          start: "top 85%",
          once: true,
        },
      });
    });
  }, []);

  return (
    <div ref={containerRef}>
      {/* Hero */}
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Support
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          文档、常见问题和联系方式。
        </p>
      </section>

      {/* Documentation paths */}
      <section className="support-section mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Documentation</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {DOCS_PATH_RAIL.map((item) => (
            <div
              key={item.title}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            >
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {item.label}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                {item.title}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="support-section bg-[var(--bg-surface)] px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">FAQ</h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q}>
                <h3 className="font-semibold text-[var(--text-primary)]">{item.q}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="support-section mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Contact</h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          有问题或合作意向？发邮件给我们。
        </p>
        <a
          href="mailto:hello@qihang.ai"
          className="mt-6 inline-block rounded-[var(--radius-full)] bg-[var(--brand-v2)] px-8 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          hello@qihang.ai
        </a>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/support/page.tsx && git commit -m "feat: add Support page (docs + FAQ + contact)"
```

---

### Task 13: Pricing page upgrade

**Files:**
- Modify: `apps/web/app/(public)/pricing/page.tsx`

- [ ] **Step 1: Rewrite pricing page**

Replace the entire file `apps/web/app/(public)/pricing/page.tsx` with:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { MagneticButton } from "@/components/MagneticButton";
import { PRICING_COMPARE_RAIL } from "@/lib/public-story-content";

export default function PricingPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll(".pricing-card");
    gsap.from(cards, {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".pricing-grid"),
        start: "top 80%",
        once: true,
      },
    });
  }, []);

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Pricing
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          选择适合你的方案。
        </p>
      </section>

      <section className="pricing-grid mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PRICING_COMPARE_RAIL.map((plan) => (
            <div
              key={plan.title}
              className="pricing-card flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
            >
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {plan.label}
              </p>
              <h3 className="mt-2 text-xl font-bold text-[var(--text-primary)]">{plan.title}</h3>
              <p className="mt-2 flex-1 text-sm text-[var(--text-secondary)]">{plan.body}</p>
              <div className="mt-6">
                <MagneticButton
                  href="/demo"
                  className="block w-full rounded-[var(--radius-md)] bg-[var(--brand-v2)] py-2.5 text-center text-sm font-medium text-white"
                >
                  Get Started
                </MagneticButton>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/pricing/page.tsx && git commit -m "feat: rewrite pricing page with v2 tokens and GSAP reveals"
```

---

### Task 14: Updates page upgrade

**Files:**
- Modify: `apps/web/app/(public)/updates/page.tsx`

- [ ] **Step 1: Rewrite updates page**

Replace the entire file `apps/web/app/(public)/updates/page.tsx` with:

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "@/lib/gsap-register";
import { UPDATE_TIMELINE_RAIL } from "@/lib/public-story-content";

export default function UpdatesPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll(".timeline-item");
    gsap.from(items, {
      opacity: 0,
      x: -20,
      stagger: 0.08,
      duration: 0.5,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el.querySelector(".timeline-list"),
        start: "top 80%",
        once: true,
      },
    });
  }, []);

  return (
    <div ref={containerRef}>
      <section className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[var(--font-size-hero)] font-bold text-[var(--text-primary)]">
          Updates
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--text-secondary)]">
          产品动态与更新日志。
        </p>
      </section>

      <section className="timeline-list mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-col gap-8 border-l-2 border-[var(--border)] pl-8">
          {UPDATE_TIMELINE_RAIL.map((item) => (
            <div key={item.title} className="timeline-item relative">
              {/* Dot on timeline */}
              <span className="absolute -left-[calc(2rem+5px)] top-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-v2)]" />
              <p className="text-xs font-medium tracking-wider text-[var(--text-secondary)] uppercase">
                {item.label}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {item.title}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add app/\(public\)/updates/page.tsx && git commit -m "feat: rewrite updates page with timeline layout and GSAP reveals"
```

---

### Task 15: Demo page adaptation

**Files:**
- Modify: `apps/web/app/(public)/demo/page.tsx`

The demo page is 1274 lines of complex interactive code with viewer integration. We do **minimal** changes: update CSS class references from legacy tokens to v2 tokens where they appear in inline styles or class names. The page structure and logic remain unchanged.

- [ ] **Step 1: Update token references in demo page**

In `apps/web/app/(public)/demo/page.tsx`, perform these targeted replacements:

- Replace `var(--brand)` → `var(--brand-v2)` (in inline styles only, since CSS classes use Tailwind)
- Replace `var(--accent)` → `var(--accent-v2)` if present in inline styles
- Replace any `text-electric` or `bg-electric` Tailwind classes with `text-[var(--brand-v2)]` or `bg-[var(--brand-v2)]`

These are mechanical find-and-replace operations. Do NOT restructure the page layout or change any viewer/inference logic.

If no legacy token references exist in inline styles, this step is a no-op.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit (only if changes were made)**

```bash
cd apps/web && git diff --quiet app/\(public\)/demo/page.tsx || (git add app/\(public\)/demo/page.tsx && git commit -m "chore: update demo page token references to v2")
```

---

### Task 16: Remove old pages + cleanup

**Files:**
- Remove: `apps/web/app/(public)/how-it-works/page.tsx`
- Remove: `apps/web/app/(public)/docs/page.tsx`
- Remove: `apps/web/app/(public)/contact/page.tsx`
- Remove: `apps/web/components/PublicSiteChrome.tsx` (replaced by SiteHeader + SiteFooter)

These routes are now handled by permanent redirects (configured in Foundation plan Task 8). The old page files and the replaced chrome component can be safely deleted.

- [ ] **Step 1: Delete old page files and replaced components**

```bash
cd apps/web && rm -f app/\(public\)/how-it-works/page.tsx app/\(public\)/docs/page.tsx app/\(public\)/contact/page.tsx components/PublicSiteChrome.tsx
```

If the directories are empty after deletion, remove them too:

```bash
cd apps/web && rmdir app/\(public\)/how-it-works app/\(public\)/docs app/\(public\)/contact 2>/dev/null; true
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add -A app/\(public\)/how-it-works/ app/\(public\)/docs/ app/\(public\)/contact/ && git commit -m "chore: remove old how-it-works, docs, contact pages (redirects in place)"
```

---

### Task 17: Final TypeScript verification + smoke test update

**Files:**
- Modify: `apps/web/tests/foundation.spec.ts` (extend with public site tests)

- [ ] **Step 1: Run full TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Extend smoke tests**

Add public site navigation tests to `apps/web/tests/foundation.spec.ts`:

Append after the existing test describe block:

```ts
test.describe("Public site pages", () => {
  const pages = [
    { path: "/", title: "homepage" },
    { path: "/product", title: "product" },
    { path: "/ecosystem", title: "ecosystem" },
    { path: "/demo", title: "demo" },
    { path: "/pricing", title: "pricing" },
    { path: "/support", title: "support" },
    { path: "/updates", title: "updates" },
  ];

  for (const { path, title } of pages) {
    test(`${title} page loads without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      expect(errors).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Commit**

```bash
cd apps/web && git add tests/foundation.spec.ts && git commit -m "test: extend smoke tests with public site page load checks"
```
