# QIHANG Full-Site UI & Interaction Upgrade — Design Spec

**Date:** 2026-03-13
**Status:** Draft
**Product:** QIHANG — earphone hardware + AI ecosystem consumer platform

---

## 1. Overview

A large-scale upgrade to both the public site and console of the QIHANG platform. The public site gets a complete visual and structural overhaul befitting a consumer hardware brand. The console switches to a dark, professional workspace for AI training, evaluation, and model management.

### Goals

- Establish a consumer-grade brand presence on the public site (Apple/Sony-tier product storytelling)
- Build a professional, efficient workspace console (VS Code/Figma-tier)
- Unified design token system powering both modes
- Mobile-first public site experience, mobile-compatible console
- Cinematic scroll-driven storytelling with GSAP
- Polished interaction design with Framer Motion

### Approach

**Hybrid: shared foundation + dual-track parallel development**

1. **Shared foundation** (1 task): design tokens + fonts + Tailwind theme + shadcn init + GSAP/Framer integration
2. **Dual track:**
   - Public site track: GSAP scroll engine → homepage narrative → product page → remaining pages
   - Console track: hybrid layout shell → command palette → dashboard → remaining pages
3. **Convergence**: mobile adaptation → animation polish → cross-site consistency check

---

## 2. Design Token System

All colors, spacing, fonts, and radii are managed via CSS custom properties. Public site and console each get their own set of values.

### Architecture

```css
:root { /* Public site light tokens (default) */ }
[data-theme="console"] { /* Console dark tokens */ }
```

Console layout applies `data-theme="console"` on its container, switching the entire token set.

### Public Site Tokens (Light)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#ffffff` | Page background |
| `--bg-surface` | `#f8fafc` | Card/section background |
| `--bg-raised` | `#f1f5f9` | Hover/highlight areas |
| `--border` | `#e2e8f0` | Dividers/borders |
| `--text-primary` | `#0f172a` | Primary text |
| `--text-secondary` | `#475569` | Secondary text |
| `--brand` | `#0f76ff` | Brand blue |
| `--brand-soft` | `#0f76ff15` | Brand blue tint |
| `--success` | `#16a34a` | Success state |
| `--warning` | `#d97706` | Warning state |
| `--error` | `#dc2626` | Error state |

### Console Tokens (Deep Slate)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#020617` | Page background |
| `--bg-surface` | `#0f172a` | Panel/card background |
| `--bg-raised` | `#1e293b` | Hover/selected |
| `--border` | `#334155` | Dividers/borders |
| `--text-primary` | `#f1f5f9` | Primary text |
| `--text-secondary` | `#94a3b8` | Secondary text |
| `--brand` | `#0f76ff` | Brand blue (unchanged) |
| `--brand-soft` | `#0f76ff22` | Brand blue tint |
| `--success` | `#4ade80` | Success state |
| `--warning` | `#fbbf24` | Warning state |
| `--error` | `#f87171` | Error state |

### Spacing & Radii

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;  --space-10: 40px; --space-12: 48px;

--radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 12px;  --radius-full: 9999px;
```

### Font Tokens

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;
--font-size-xs: 0.75rem;    /* 12px */
--font-size-sm: 0.875rem;   /* 14px — console default */
--font-size-base: 1rem;     /* 16px — public site default */
--font-size-lg: 1.125rem;   /* 18px */
--font-size-xl: 1.25rem;    /* 20px */
--font-size-2xl: 1.5rem;    /* 24px */
--font-size-3xl: 1.875rem;  /* 30px */
--font-size-4xl: 2.25rem;   /* 36px */
--font-size-hero: clamp(2.5rem, 5vw, 4.5rem);  /* responsive hero */
```

Font licensing: Inter (SIL OFL 1.1), JetBrains Mono (SIL OFL 1.1) — both free for commercial use.

### Tailwind Integration

Map tokens to Tailwind class names in `tailwind.config.ts`:

```ts
colors: {
  base: 'var(--bg-base)',
  surface: 'var(--bg-surface)',
  raised: 'var(--bg-raised)',
  border: 'var(--border)',
  brand: 'var(--brand)',
  'brand-soft': 'var(--brand-soft)',
  'text-primary': 'var(--text-primary)',
  'text-secondary': 'var(--text-secondary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
}
```

Usage: `bg-surface`, `text-primary`, `border-border` automatically adapts to both themes.

---

## 3. Public Site Architecture

### Information Architecture

```
/                   Homepage — immersive scroll narrative (brand story + product highlights + CTA)
/product            Product — earphone hardware details (design, specs, craftsmanship)
/ecosystem          AI Ecosystem — platform capabilities (AI training, personalization, cloud)
/demo               Demo — online experience (3D viewer + round-screen simulator)
/pricing            Pricing — product pricing + plan comparison
/support            Support — merged Docs + Contact (documentation / FAQ / contact)
/updates            Updates — product news / changelog
```

Former "How It Works" content is split between Product and Ecosystem to eliminate overlap.

### Navigation System

**Desktop top nav:**
- Initial state: transparent background, Logo + nav links + "Get Started" CTA button
- After scroll: `backdrop-filter: blur(12px)` frosted glass + height shrink
- Hover: link underline animation, submenu dropdown (Product → Specs/Craft, Support → Docs/Contact)
- Current page: brand-blue underline indicator

**Mobile nav:**
- Hamburger triggers full-screen overlay (slides down, Framer Motion `AnimatePresence`)
- Large links (`text-2xl`), generous touch spacing
- Fixed bottom CTA button ("Buy Now" or "Try Demo"), hides when scrolling to CTA section

### GSAP Scroll Engine

Replaces the current hand-written `useStoryScroll` with GSAP ScrollTrigger:

```
ScrollEngine (core)
├── ScrollTimeline        — GSAP timeline + ScrollTrigger.create()
├── SceneOrchestrator     — manages scene pin / scrub / transitions
├── ParallaxLayer         — parallax layers (background/foreground at different rates)
└── ViewerBridge          — retains existing useViewerBridge, synced to timeline progress
```

**Core mechanics:**
- Each scene uses `ScrollTrigger.create({ pin: true, scrub: true })` for pin and scrub
- In-scene animations bound to timeline progress (0→1): text reveal, element translate, opacity
- Scene transitions use GSAP `snap` for detent feel
- 3D viewer syncs via `onUpdate` callback → `sendPatch` to update view angle/tone

**Performance strategy:**
- `will-change: transform` only applied during active animation
- Mobile fallback: fewer parallax layers, pin disabled (natural scroll + fade-in)
- `ScrollTrigger.matchMedia()` loads different animation configs per breakpoint

### Homepage Scene Choreography

| Scene | Content | Animation |
|-------|---------|-----------|
| Hero | Brand slogan + earphone hero/3D | Text fades up from bottom, product blur-to-sharp |
| Highlights | 3 core selling points | Pin + scrub, cards stagger in |
| AI Ecosystem | Platform capabilities | Split-screen: text left, illustration right, scroll-triggered swap |
| Craft/Material | Detail close-ups | Parallax scroll, slow background fast foreground |
| CTA | Purchase guide + Demo entry | Buttons spring in, gradient background |

### Footer Redesign

- 4-column layout: Product / AI Ecosystem / Support / About
- Bottom: brand logo + copyright + social links
- Mobile: accordion-style collapsible sections

---

## 4. Console Architecture

### Hybrid Layout System

```
┌──────────────────────────────────────────────────┐
│  Breadcrumb Top Bar (h: 48px)                     │
│  Logo · Project Switcher · Breadcrumb · Search · Avatar │
├────┬─────────────┬──────────────┬────────────────┤
│    │             │              │                │
│ A  │  List Panel │ Content Panel│ Inspector Panel│
│ c  │  (280px)    │  (flex-1)    │  (320px)       │
│ t  │  collapsible│  always shown│  collapsible   │
│ i  │             │              │                │
│ v  │             │              │                │
│ i  │             │              │                │
│ t  │             │              │                │
│ y  │             │              │                │
│    │             │              │                │
│ B  │             │              │                │
│ a  │             │              │                │
│ r  │             │              │                │
│48px│             │              │                │
├────┴─────────────┴──────────────┴────────────────┤
│  Status Bar (h: 24px)                             │
│  Connection · Project · Notifications · Version   │
└──────────────────────────────────────────────────┘
```

### Component Decomposition

```
ConsoleLayout
├── TopBar
│   ├── BreadcrumbNav         — auto-generated from route
│   ├── ProjectSwitcher       — upgrades existing useProjectSelection
│   └── UserMenu              — avatar + dropdown
├── ActivityBar               — left icon rail
│   ├── NavItem (icon only)   — Dashboard / Projects / Datasets / Train / Models / Eval
│   └── BottomActions         — Devices (coming soon) / Billing (coming soon) / Settings / Help
├── PanelGroup                — three adjustable columns
│   ├── ListPanel             — resource lists
│   ├── ContentPanel          — main content area
│   └── InspectorPanel        — properties / metadata / quick actions
├── CommandPalette            — Cmd+K (shadcn Command)
├── StatusBar                 — bottom status strip
└── ToastProvider             — global notifications (shadcn Toast)
```

### Panel System

**Size constraints:**
- ListPanel: min `200px`, default `280px`, max `400px`
- ContentPanel: `flex: 1`, min `400px`
- InspectorPanel: min `240px`, default `320px`, max `480px`

**Interaction:**
- Drag dividers to resize, double-click to reset
- Keyboard shortcuts: `Cmd+1` toggle List, `Cmd+2` toggle Inspector
- Panel widths persisted to `localStorage`

**Per-page panel configuration:**

| Page | List | Content | Inspector |
|------|------|---------|-----------|
| Dashboard | hidden | full-width dashboard | hidden |
| Datasets | dataset list | dataset detail | sample preview/tags |
| Train | job list | job detail/logs/curves | params/metrics |
| Models | model list | version management | alias/deploy status |
| Eval | eval list | comparison report | sample playback |

### Command Palette (Cmd+K)

Built on shadcn `Command` (cmdk):

**Groups:**
- **Navigate** — jump to any page ("Go to Datasets", "Go to Train #42")
- **Actions** — create dataset, start training, switch project
- **Search** — fuzzy search resource names (dataset, model, job ID)

**Implementation:**
- Global `useEffect` listening for `Cmd+K` / `Ctrl+K`
- Opens Dialog overlay, instant filter on type
- Keyboard up/down + Enter to confirm

### Status Bar

Left: API connection indicator · current project name
Right: unread notification count · version `v0.1`

### shadcn Component Selection

7 components selectively integrated:

| Component | Usage |
|-----------|-------|
| `Command` | Cmd+K command palette |
| `Dialog` | Modal dialogs (confirmation, creation forms) |
| `DropdownMenu` | User menu, context menus |
| `Table` | Dataset/model/training lists |
| `Toast` | Global notifications |
| `Tabs` | Content area tab switching |
| `Tooltip` | Activity Bar icon hints |

---

## 5. Animation System

### Dual Engine

| Engine | Scope | Responsibility |
|--------|-------|----------------|
| **GSAP + ScrollTrigger** | Public site | Scroll-driven: scene pin/scrub, parallax, timeline choreography |
| **Framer Motion** | Console + public shared | Interaction: enter/exit, layout, hover, gestures |

No conflict — GSAP owns the scroll axis, Framer Motion owns user interactions.

### Public Site Animations (GSAP)

**Scene transitions:**
- Crossfade between scenes (previous fades out + next fades in, 10% overlap)
- `snap: { snapTo: 1 / sceneCount, duration: 0.3 }` scene detent

**Text animations:**
- Headlines: per-character fade-in + slight upward shift
- Paragraphs: whole block `opacity: 0, y: 20px` fade-in
- Numbers/metrics: countUp rolling number animation

**Product showcase:**
- 3D viewer angle follows scroll progress via `sendPatch`
- Background color/tone transitions with scroll (pearl → midnight → glacier)

**Parallax layers:**
- Background rate `0.3x`, foreground decorative elements `1.2x`
- Mobile: halved parallax range or disabled

### Console Animations (Framer Motion)

**Layout animations:**
- Panel expand/collapse: `layout` prop auto-interpolates width
- List item add/remove: `AnimatePresence` + `layoutId` smooth transitions

**Enter choreography:**
- Page switch: content area `opacity + y` fade-in (150ms)
- List load: `staggerChildren: 30ms` sequential entry
- Skeleton → data: crossfade switch

**Interaction feedback:**
- Button hover: `scale: 1.02`, active: `scale: 0.98`
- Card hover: `y: -2px` + shadow deepen
- Toast notifications: slide in from right + auto-exit

**Command palette:**
- Background overlay: `opacity 0→0.5` (200ms)
- Panel: `scale: 0.95→1` + `opacity 0→1` (150ms, spring)

### Mobile Degradation

| Feature | Desktop | Mobile | prefers-reduced-motion |
|---------|---------|--------|----------------------|
| Scene pin + scrub | Full | Disabled, scroll fade-in | Instant switch |
| Parallax | Multi-layer | Single/disabled | Disabled |
| Per-char text animation | Full | Whole-block fade | Instant display |
| Console layout animation | Spring | Shortened to 100ms | Instant |
| Hover effects | Full | N/A (touch) | Preserved |

---

## 6. Mobile Strategy

### Breakpoints

Configured as Tailwind screen breakpoints in `tailwind.config.ts` (mobile-first, `min-width` media queries):

| Breakpoint | Value | Target |
|------------|-------|--------|
| `sm` | `640px` | Phone landscape |
| `md` | `768px` | Tablet portrait |
| `lg` | `1024px` | Tablet landscape / small laptop |
| `xl` | `1280px` | Standard desktop |
| `2xl` | `1536px` | Large desktop |

Usage: `md:grid-cols-2`, `lg:flex`. Stylesheets are written mobile-first — base styles target phones, breakpoint modifiers enhance upward.

### Public Site Mobile

**Navigation:**
- `< md`: hamburger → full-screen overlay (slides down, AnimatePresence)
- Large links (`text-2xl`), generous touch spacing
- Fixed bottom floating CTA, hides when CTA section is in view

**Homepage scroll narrative:**
- `< md`: GSAP pin disabled, natural scroll + Intersection Observer fade-in
- Scenes stack vertically, each `100svh` (using `svh` for Safari compatibility)
- 3D viewer retained but shrunk to `60vw`, fixed at scene top
- Parallax disabled to reduce GPU load

**Product page:**
- Image gallery: horizontal swipe with indicator dots
- Spec table: vertically stacked cards (grid on desktop)

**Touch gestures:**
- Product images: swipe to change angle
- Demo 3D viewer: pinch-to-zoom and drag-rotate

### Console Mobile

Desktop-primary, mobile-compatible:

**`< lg` (tablet and below):**
- Activity Bar hidden, replaced by top hamburger menu
- Three columns → single column: only ContentPanel shown
- ListPanel and InspectorPanel become slide-out drawers (left/right)
- Command Palette retained (full-screen mode)

**`< md` (phone):**
- Top bar simplified: Logo + hamburger + project name (truncated)
- List and detail as separate views with navigation-style switching
- Status bar hidden
- Tables horizontally scrollable

### Touch Adaptation

```css
/* Minimum 44x44px touch targets (Apple HIG) */
.touch-target { min-height: 44px; min-width: 44px; }

/* Disable hover effects on touch devices */
@media (hover: none) {
  .hover-effect { transform: none; box-shadow: none; }
}
```

---

## 7. Image Placeholder System

Brand image assets (logo, ads, earphone close-ups) are not yet available. A new `ImagePlaceholder` component is used for image slots throughout:

```tsx
<ImagePlaceholder label="Brand Logo" aspect="3/1" icon="logo" />
<ImagePlaceholder label="Earphone Front Close-up" aspect="16/9" icon="photo" />
```

Props:
- `label`: describes what asset is needed
- `aspect`: aspect ratio (e.g., `"16/9"`, `"1/1"`, `"3/1"`)
- `icon`: placeholder icon type — `image` | `logo` | `photo` | `video`

Renders as a dashed brand-blue border area with icon + label. Adapts to light/dark theme automatically.

**Note:** The existing `AssetPlaceholder` component (`apps/web/components/AssetPlaceholder.tsx`) is a separate content card component with `eyebrow/title/summary/specs` props. It is retained for product feature descriptions. `ImagePlaceholder` is specifically for missing image assets.

**Replacement:** Search globally for `ImagePlaceholder` to find all image positions. Replace with `<Image>` or `<img>` when assets are ready.

---

## 8. Technology Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + CSS custom properties |
| UI Components | shadcn/ui (selective: 7 components) |
| Scroll Animation | GSAP + ScrollTrigger |
| Interaction Animation | Framer Motion |
| Fonts | Inter (sans), JetBrains Mono (mono) |
| State Management | React Context + @tanstack/react-query |
| Forms | react-hook-form + zod |
| 3D Viewer | Existing iframe + postMessage (useViewerBridge) |

---

## 9. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dual mode | Light public + dark console | Consumer brand warmth vs professional workspace |
| Console palette | Deep Slate (#020617→#475569) | Natural affinity with brand blue, tech depth feel |
| Console layout | Hybrid workspace | VS Code efficiency + Linear aesthetics |
| Component lib | Selective shadcn (7 components) | High-quality complex components, custom simple ones |
| Public rewrite | Full engine + visual overhaul | Consumer hardware brand demands cinematic quality |
| Fonts | Inter + JetBrains Mono + system CJK | Brand polish + zero CJK webfont cost |
| Animation | GSAP (scroll) + Framer (interaction) | Each engine in its strength zone |
| Page structure | New IA with Product/Ecosystem split | Clearer narrative for hardware + AI ecosystem |
| Mobile | Mobile-first public, mobile-compatible console | Consumer users largely on mobile |

---

## 10. Migration Strategy

### URL Redirects

Old routes that are removed or renamed get permanent redirects via Next.js `next.config.ts`:

| Old Route | New Route | Reason |
|-----------|-----------|--------|
| `/how-it-works` | `/product` | Content merged into Product |
| `/docs` | `/support` | Merged into Support |
| `/contact` | `/support#contact` | Merged into Support |

Implementation: `redirects()` in `next.config.ts` returning `{ source, destination, permanent: true }`.

### CSS Token Migration

The current codebase uses legacy tokens (`--bg`, `--bg-soft`, `--fg`, `--muted`, `--line`, `--glass`, etc.) and legacy Tailwind colors (`ink`, `surf`, `electric`, `mint`). Migration approach:

1. **Foundation task**: Define new tokens in `:root` and `[data-theme="console"]` alongside legacy tokens (no removal yet)
2. **Per-page migration**: As each page is rebuilt, switch from legacy to new tokens
3. **Cleanup task**: After all pages are migrated, remove legacy tokens and old Tailwind color names
4. **No compatibility aliases**: Since every page is being rebuilt anyway, there is no need for an alias layer

### Existing Component Migration

The current `AssetPlaceholder` component (`apps/web/components/AssetPlaceholder.tsx`) has a different purpose — it's a content card placeholder with `eyebrow/title/summary/specs` props for product feature descriptions. This component will be retained and used where content placeholders are needed.

The new **image** placeholder component will be named `ImagePlaceholder` to avoid conflict:

```tsx
<ImagePlaceholder label="Brand Logo" aspect="3/1" icon="logo" />
```

### New Route Group Structure

All new public pages live under the existing `(public)` route group and share the public site layout (`PublicSiteChrome`):

```
apps/web/app/(public)/
├── page.tsx                    ← / (homepage, rewritten)
├── product/page.tsx            ← /product (new)
├── ecosystem/page.tsx          ← /ecosystem (new)
├── demo/page.tsx               ← /demo (existing, upgraded)
├── pricing/page.tsx            ← /pricing (existing, upgraded)
├── support/page.tsx            ← /support (new, replaces docs + contact)
└── updates/page.tsx            ← /updates (existing, upgraded)
```

Console pages remain under `(console)` with the new `ConsoleLayout`.

---

## 11. shadcn Integration

### Installation

Use the shadcn CLI to scaffold components:

```bash
npx shadcn@latest init
npx shadcn@latest add command dialog dropdown-menu table toast tabs tooltip
```

### Theme Compatibility

shadcn uses its own CSS variable system (`--background`, `--foreground`, `--primary`, etc.) with `class="dark"` on `<html>` for dark mode. Our approach:

- **Console**: Apply `class="dark"` on the console layout's `<html>` element (via Next.js layout). This makes shadcn components auto-switch. Additionally apply `data-theme="console"` on the same element for our custom tokens.
- **Public site**: No `dark` class (default light). shadcn components pick up light theme automatically.
- **Token mapping**: Map shadcn's CSS variables to our token values in `globals.css` so both systems stay in sync:

```css
:root {
  --background: var(--bg-base);
  --foreground: var(--text-primary);
  --primary: var(--brand);
  --muted: var(--bg-raised);
  --muted-foreground: var(--text-secondary);
  --border: var(--border);
  /* ... etc */
}
```

This way, shadcn components automatically use our design tokens.

### Resizable Panels

The three-panel console layout uses `react-resizable-panels` (by bvaughn, ~8KB gzipped). This library provides `PanelGroup`, `Panel`, and `PanelResizeHandle` — a proven approach used by VS Code web and many React workspace UIs.

---

## 12. Font Loading

Use `next/font/google` for automatic optimization (self-hosting, `font-display: swap`, preload):

```tsx
// app/layout.tsx
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = localFont({
  src: '../fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-mono',
  display: 'swap',
});
```

- Inter: via `next/font/google` (auto self-hosted, ~100KB subset)
- JetBrains Mono: self-hosted variable font (single .woff2, ~50KB) for reliability
- Chinese: falls back to system fonts (PingFang SC / Microsoft YaHei) — no webfont needed
- `font-display: swap` ensures text is visible immediately

---

## 13. Motion Tokens

Standardized timing and easing values to prevent inconsistency:

```css
/* Duration tokens */
--duration-fast: 100ms;     /* micro-interactions: button press */
--duration-normal: 200ms;   /* standard transitions: fade, slide */
--duration-slow: 350ms;     /* emphasis transitions: page enter, panel resize */
--duration-scroll: 0.3s;    /* GSAP snap duration */

/* Easing tokens */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);          /* decelerate — entering elements */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);      /* symmetric — layout shifts */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* overshoot — playful bounces */
--ease-linear: linear;                                /* scroll-linked animations */
```

Framer Motion equivalents:

```ts
export const motionConfig = {
  fast: { duration: 0.1 },
  normal: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  slow: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  spring: { type: 'spring', stiffness: 400, damping: 25 },
} as const;
```

---

## 14. Console States

### Empty States

Each console page has a designed empty state when no resources exist:

| Page | Empty State |
|------|-------------|
| Dashboard | Welcome message + quick-start cards (Create Dataset, Start Training, View Demo) |
| Datasets | Illustration + "No datasets yet" + "Create your first dataset" CTA button |
| Train | Illustration + "No training jobs" + "Start training" CTA (disabled if no datasets) |
| Models | Illustration + "No models yet" + hint text "Complete a training job to see models here" |
| Eval | Illustration + "No evaluations" + "Run evaluation" CTA (disabled if < 2 models) |

All empty states use `ImagePlaceholder` for illustrations until final assets are ready.

### Error States

- **API unreachable**: Status bar indicator turns red + toast notification "API connection lost, retrying..." + content area shows last cached data with a subtle banner
- **Request failure**: Inline error message in the relevant panel with "Retry" button. No full-page error unless the layout itself fails to load.
- **Training job failure**: Job status badge turns red, log panel auto-scrolls to error, Inspector shows error details

### Loading States

- **Initial page load**: Skeleton screens (existing `ConsoleSkeleton` / `ConsoleTableSkeleton` components) with crossfade to real data via Framer Motion `AnimatePresence`
- **Data refresh**: Subtle spinner in the top bar (not full skeleton — avoids layout flash)
- **Long operations**: Progress indicator in status bar + toast on completion

---

## 15. Accessibility

### Keyboard Navigation

- **Console panel system**: Tab order flows TopBar → ActivityBar → ListPanel → ContentPanel → InspectorPanel → StatusBar
- **Panel focus trap**: Cmd+K opens command palette with focus trapped inside; Escape returns focus to previous element
- **Activity Bar**: Arrow up/down to navigate items, Enter to select
- **Panel resize**: Focus on divider handle, Arrow left/right to resize in 10px increments

### ARIA Roles

```tsx
<nav role="navigation" aria-label="Main">          {/* ActivityBar */}
<div role="complementary" aria-label="Resource list"> {/* ListPanel */}
<main role="main">                                   {/* ContentPanel */}
<aside role="complementary" aria-label="Inspector">  {/* InspectorPanel */}
<div role="status" aria-live="polite">               {/* StatusBar */}
<div role="dialog" aria-modal="true">                {/* CommandPalette */}
```

### Color Contrast

Console secondary text `#94a3b8` on base `#020617` = contrast ratio **8.5:1** (exceeds WCAG AAA 7:1).
Console secondary text `#94a3b8` on surface `#0f172a` = contrast ratio **6.4:1** (exceeds WCAG AA 4.5:1).
Public site secondary text `#475569` on base `#ffffff` = contrast ratio **7.1:1** (exceeds WCAG AAA 7:1).

### Focus Indicators

- Custom focus ring: `outline: 2px solid var(--brand); outline-offset: 2px`
- Visible on keyboard navigation (`:focus-visible`), hidden on mouse click

---

## 16. GSAP Licensing & Bundle Budget

### Licensing

GSAP core + ScrollTrigger are free under the standard GSAP license for public-facing websites. No paid plugins (ScrollSmoother, SplitText, etc.) are required. Per-character text splitting will be implemented with manual `<span>` wrapping, avoiding the paid SplitText plugin.

### Bundle Budget

| Package | Gzipped Size |
|---------|-------------|
| GSAP core | ~25 KB |
| ScrollTrigger plugin | ~8 KB |
| Framer Motion | ~42 KB |
| react-resizable-panels | ~8 KB |
| cmdk (via shadcn Command) | ~6 KB |
| **Total new JS** | **~89 KB** |

GSAP and ScrollTrigger are only loaded on public site pages (code-split via dynamic import). Framer Motion is shared. This keeps the console bundle lean and the public site budget reasonable for a cinematic experience.
