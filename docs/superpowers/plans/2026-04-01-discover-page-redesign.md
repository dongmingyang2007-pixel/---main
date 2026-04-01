# Discover Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the discover page from a flat model-search table into a Hub-style discovery homepage with scene navigation, featured models, categorized model catalog, and memory pack community sections.

**Architecture:** The existing 679-line monolithic `page.tsx` will be split into focused sub-components. Data fetching and URL-state logic stays in the parent page component; each visual section is a separate file receiving props. The existing CSS in `globals.css` gets replaced with new class names for the Hub layout. All i18n keys go through `next-intl` with the existing `useTranslations("console")` pattern.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, vanilla CSS in globals.css, next-intl for i18n, existing `apiGet` for data fetching, Playwright for E2E tests.

**Spec:** `docs/superpowers/specs/2026-04-01-discover-page-redesign.md`

---

## File Structure

```
apps/web/
├── app/[locale]/(console)/app/discover/
│   ├── page.tsx                          # REWRITE — Hub layout shell, data fetching, URL state
│   ├── _components/
│   │   ├── DiscoverSceneNav.tsx           # CREATE — 7 scene navigation cards
│   │   ├── DiscoverFeatured.tsx           # CREATE — Featured model hero cards
│   │   ├── DiscoverCatalogSection.tsx     # CREATE — Single category row (header + horizontal scroll)
│   │   ├── DiscoverModelCard.tsx          # CREATE — Compact model card for catalog
│   │   ├── DiscoverMemoryPacks.tsx        # CREATE — Memory packs community section (empty state)
│   │   ├── DiscoverSearch.tsx             # CREATE — Header with search bar
│   │   └── discover-icons.tsx             # CREATE — All SVG icon components
├── lib/
│   └── discover-labels.ts                # MODIFY — Add pipeline_slot scene label map, add ALLOWED_CARD_TOKENS
├── styles/
│   └── globals.css                       # MODIFY — Replace discover-console-* styles with new Hub styles
├── messages/
│   ├── zh/console.json                   # MODIFY — Add new i18n keys for scenes, featured, memory packs
│   └── en/console.json                   # MODIFY — Add new i18n keys (English)
└── tests/
    └── console-shell.spec.ts             # MODIFY — Update existing discover tests for new DOM structure
```

---

### Task 1: Add i18n Keys and Label Maps

**Files:**
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`
- Modify: `apps/web/lib/discover-labels.ts`

- [ ] **Step 1: Add new Chinese i18n keys**

Open `apps/web/messages/zh/console.json` and add these keys (insert after the existing `discover.category.vision` key):

```json
"discover.sceneNav": "场景导航",
"discover.scene.llm": "文本对话",
"discover.scene.asr": "语音识别",
"discover.scene.tts": "语音合成",
"discover.scene.vision": "视觉理解",
"discover.scene.realtime": "实时对话",
"discover.scene.realtime_asr": "实时语音识别",
"discover.scene.realtime_tts": "实时语音合成",
"discover.featured": "首推模型",
"discover.featuredSubtitle": "平台精选旗舰模型",
"discover.catalog": "模型目录",
"discover.catalogSubtitleHub": "按类别浏览所有可用模型",
"discover.catalogViewAll": "查看全部",
"discover.catalogModelsCount": "{count} 个模型",
"discover.memoryPacks": "记忆包社区",
"discover.memoryPacksSubtitle": "来自用户分享的记忆链路",
"discover.memoryPacksBrowseAll": "浏览全部",
"discover.memoryPacksComingSoon": "记忆包社区即将上线",
"discover.searchPlaceholderHub": "搜索模型、场景、记忆包..."
```

- [ ] **Step 2: Add corresponding English i18n keys**

Open `apps/web/messages/en/console.json` and add these keys at the same position:

```json
"discover.sceneNav": "Scenes",
"discover.scene.llm": "Text Chat",
"discover.scene.asr": "Speech Recognition",
"discover.scene.tts": "Speech Synthesis",
"discover.scene.vision": "Visual Understanding",
"discover.scene.realtime": "Realtime Chat",
"discover.scene.realtime_asr": "Realtime ASR",
"discover.scene.realtime_tts": "Realtime TTS",
"discover.featured": "Featured Models",
"discover.featuredSubtitle": "Platform-curated flagship models",
"discover.catalog": "Model Catalog",
"discover.catalogSubtitleHub": "Browse all available models by category",
"discover.catalogViewAll": "View all",
"discover.catalogModelsCount": "{count} models",
"discover.memoryPacks": "Memory Pack Community",
"discover.memoryPacksSubtitle": "Shared memory chains from users",
"discover.memoryPacksBrowseAll": "Browse all",
"discover.memoryPacksComingSoon": "Memory pack community coming soon",
"discover.searchPlaceholderHub": "Search models, scenes, memory packs..."
```

- [ ] **Step 3: Add pipeline_slot scene map and card token filter to discover-labels.ts**

Open `apps/web/lib/discover-labels.ts`. Add the following **before** the `Provider display label` section (before line 137):

```typescript
/* ------------------------------------------------------------------ */
/*  Pipeline slot → scene label map                                   */
/* ------------------------------------------------------------------ */

const SCENE_MAP: Record<string, string> = {
  llm: "discover.scene.llm",
  asr: "discover.scene.asr",
  tts: "discover.scene.tts",
  vision: "discover.scene.vision",
  realtime: "discover.scene.realtime",
  realtime_asr: "discover.scene.realtime_asr",
  realtime_tts: "discover.scene.realtime_tts",
};

/**
 * Translate a pipeline_slot key to a user-friendly scene name.
 */
export function sceneLabel(
  slot: string,
  t: (key: string) => string,
): string {
  return SCENE_MAP[slot] ? t(SCENE_MAP[slot]) : slot;
}

/* ------------------------------------------------------------------ */
/*  Allowed tokens for discover page model cards                      */
/* ------------------------------------------------------------------ */

/**
 * Tokens allowed on discover page model cards.
 * Technical tokens (streaming, structured_output, cache, ranking) are excluded.
 */
const ALLOWED_CARD_TOKENS = new Set([
  "text",
  "image",
  "audio",
  "video",
  "function_calling",
  "web_search",
  "deep_thinking",
]);

/**
 * Filter tokens to only those appropriate for consumer-facing cards.
 */
export function filterCardTokens(tokens: string[]): string[] {
  return tokens.filter((token) => ALLOWED_CARD_TOKENS.has(token));
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd /Users/dog/Desktop/铭润 && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds (no TypeScript errors from the new exports).

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/zh/console.json apps/web/messages/en/console.json apps/web/lib/discover-labels.ts
git commit -m "feat(discover): add i18n keys and label helpers for hub redesign"
```

---

### Task 2: Create SVG Icon Components

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/discover-icons.tsx`

- [ ] **Step 1: Create the icon components file**

Create `apps/web/app/[locale]/(console)/app/discover/_components/discover-icons.tsx`:

```tsx
/**
 * Custom SVG icons for the Discover page.
 * No emoji — all icons are original vector art.
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function SearchIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20 16.65 16.65" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function HeartIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function DownloadIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene navigation icons — one per pipeline_slot                    */
/* ------------------------------------------------------------------ */

export function SceneLlmIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M5 7h18M5 12h14M5 17h10M5 22h16" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
      <path d="M22 14l-2 10 3-3 3 3-2-10" fill="white" opacity="0.85" />
    </svg>
  );
}

export function SceneAsrIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="11" y="3" width="6" height="12" rx="3" fill="white" opacity="0.9" />
      <path d="M8 12a6 6 0 0 0 12 0" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
      <line x1="14" y1="18" x2="14" y2="22" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export function SceneTtsIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M4 11v6l6 5V6l-6 5z" fill="white" opacity="0.9" />
      <path d="M15 9a5 5 0 0 1 0 10" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
      <path d="M18 6a9 9 0 0 1 0 16" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

export function SceneVisionIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="5" stroke="white" strokeWidth="1.8" opacity="0.9" />
      <circle cx="14" cy="14" r="2" fill="white" opacity="0.9" />
      <path d="M2 14s5-9 12-9 12 9 12 9-5 9-12 9-12-9-12-9z" stroke="white" strokeWidth="1.5" opacity="0.5" fill="none" />
    </svg>
  );
}

export function SceneRealtimeIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="10" stroke="white" strokeWidth="1.5" opacity="0.5" />
      <circle cx="14" cy="14" r="5" stroke="white" strokeWidth="1.8" opacity="0.8" />
      <circle cx="14" cy="14" r="1.5" fill="white" opacity="0.9" />
    </svg>
  );
}

export function SceneRealtimeAsrIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="11" y="5" width="5" height="10" rx="2.5" fill="white" opacity="0.85" />
      <path d="M9 13a5 5 0 0 0 10 0" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <circle cx="22" cy="8" r="4" stroke="white" strokeWidth="1.5" opacity="0.5" />
      <path d="M20.5 8h3M22 6.5v3" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function SceneRealtimeTtsIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M5 11v6l5 4V7l-5 4z" fill="white" opacity="0.85" />
      <path d="M14 10a4 4 0 0 1 0 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <circle cx="22" cy="8" r="4" stroke="white" strokeWidth="1.5" opacity="0.5" />
      <path d="M20.5 8h3M22 6.5v3" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** Maps pipeline_slot → icon component */
export const SCENE_ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  llm: SceneLlmIcon,
  asr: SceneAsrIcon,
  tts: SceneTtsIcon,
  vision: SceneVisionIcon,
  realtime: SceneRealtimeIcon,
  realtime_asr: SceneRealtimeAsrIcon,
  realtime_tts: SceneRealtimeTtsIcon,
};

/** Maps pipeline_slot → gradient CSS value */
export const SCENE_GRADIENT_MAP: Record<string, string> = {
  llm: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  asr: "linear-gradient(135deg, #3b82f6, #60a5fa)",
  tts: "linear-gradient(135deg, #06b6d4, #22d3ee)",
  vision: "linear-gradient(135deg, #f59e0b, #fbbf24)",
  realtime: "linear-gradient(135deg, #10b981, #34d399)",
  realtime_asr: "linear-gradient(135deg, #8b5cf6, #a78bfa)",
  realtime_tts: "linear-gradient(135deg, #ec4899, #f472b6)",
};

/* ------------------------------------------------------------------ */
/*  Decorative SVG patterns for featured model cards                  */
/* ------------------------------------------------------------------ */

export function DecoCircles() {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={{ position: "absolute", top: 10, right: 10, opacity: 0.12 }}>
      <circle cx="35" cy="35" r="30" stroke="white" strokeWidth="2" />
      <circle cx="35" cy="35" r="18" stroke="white" strokeWidth="1.5" />
      <circle cx="35" cy="35" r="7" fill="white" />
    </svg>
  );
}

export function DecoWave() {
  return (
    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" style={{ position: "absolute", top: 10, right: 10, opacity: 0.12 }}>
      <path d="M8 38C8 20 22 10 38 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 38C8 24 28 14 42 18" stroke="white" strokeWidth="2" />
      <circle cx="8" cy="38" r="3" fill="white" />
    </svg>
  );
}

export function DecoLandscape() {
  return (
    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" style={{ position: "absolute", top: 10, right: 10, opacity: 0.12 }}>
      <rect x="5" y="8" width="40" height="34" rx="4" stroke="white" strokeWidth="2" />
      <circle cx="18" cy="22" r="5" stroke="white" strokeWidth="1.5" />
      <path d="M5 35l12-10 8 6 10-12 10 16" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/_components/discover-icons.tsx
git commit -m "feat(discover): add custom SVG icon components for hub redesign"
```

---

### Task 3: Create Sub-Components (DiscoverSearch, DiscoverSceneNav)

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSearch.tsx`
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSceneNav.tsx`

- [ ] **Step 1: Create DiscoverSearch component**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSearch.tsx`:

```tsx
"use client";

import { SearchIcon } from "./discover-icons";

interface DiscoverSearchProps {
  value: string;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function DiscoverSearch({ value, placeholder, clearLabel, onChange, onClear }: DiscoverSearchProps) {
  return (
    <label className="dhub-search-shell">
      <span className="dhub-search-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        className="dhub-search-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value.trim() ? (
        <button type="button" className="dhub-search-clear" onClick={onClear}>
          {clearLabel}
        </button>
      ) : null}
    </label>
  );
}
```

- [ ] **Step 2: Create DiscoverSceneNav component**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSceneNav.tsx`:

```tsx
"use client";

import { SCENE_ICON_MAP, SCENE_GRADIENT_MAP } from "./discover-icons";
import { sceneLabel } from "@/lib/discover-labels";

interface DiscoverSceneNavProps {
  /** pipeline_slot values that have at least one model in the catalog */
  activeSlots: string[];
  /** Currently selected slot (from URL ?slot=xxx), or null */
  selectedSlot: string | null;
  /** Callback when a scene card is clicked */
  onSelect: (slot: string | null) => void;
  /** i18n translate function scoped to "console" */
  t: (key: string) => string;
  sectionLabel: string;
}

/** Canonical display order for pipeline slots */
const SLOT_ORDER: string[] = [
  "llm",
  "asr",
  "tts",
  "vision",
  "realtime",
  "realtime_asr",
  "realtime_tts",
];

export function DiscoverSceneNav({
  activeSlots,
  selectedSlot,
  onSelect,
  t,
  sectionLabel,
}: DiscoverSceneNavProps) {
  const slotsToShow = SLOT_ORDER.filter((slot) => activeSlots.includes(slot));

  if (slotsToShow.length === 0) {
    return null;
  }

  return (
    <div className="dhub-scenes">
      <div className="dhub-scenes-label">{sectionLabel}</div>
      <div className="dhub-scenes-grid">
        {slotsToShow.map((slot) => {
          const Icon = SCENE_ICON_MAP[slot];
          const gradient = SCENE_GRADIENT_MAP[slot] || "linear-gradient(135deg,#6b7280,#9ca3af)";
          const isSelected = selectedSlot === slot;

          return (
            <button
              key={slot}
              type="button"
              className={`dhub-scene-card${isSelected ? " is-active" : ""}`}
              style={{ background: gradient }}
              onClick={() => onSelect(isSelected ? null : slot)}
            >
              {Icon ? <Icon size={24} /> : null}
              <span className="dhub-scene-card-name">{sceneLabel(slot, t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSearch.tsx apps/web/app/[locale]/(console)/app/discover/_components/DiscoverSceneNav.tsx
git commit -m "feat(discover): add DiscoverSearch and DiscoverSceneNav components"
```

---

### Task 4: Create Sub-Components (DiscoverFeatured, DiscoverModelCard, DiscoverCatalogSection)

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverFeatured.tsx`
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverModelCard.tsx`
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverCatalogSection.tsx`

- [ ] **Step 1: Create DiscoverModelCard component**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverModelCard.tsx`:

```tsx
"use client";

import { Link } from "@/i18n/navigation";
import { getProviderStyle } from "@/lib/model-utils";
import {
  categoryLabel,
  labelForToken,
  providerDisplayLabel,
  filterCardTokens,
} from "@/lib/discover-labels";

interface DiscoverModelCardProps {
  model: {
    canonical_model_id: string;
    display_name: string;
    provider: string;
    provider_display: string;
    description: string;
    official_category_key?: string | null;
    official_category?: string | null;
    input_modalities?: string[];
    output_modalities?: string[];
    supported_tools: string[];
    supported_features: string[];
    is_selectable_in_console?: boolean | null;
  };
  detailHref: string;
  locale: string;
  t: (key: string) => string;
  availableLabel: string;
  browseOnlyLabel: string;
}

function dedupeTokens(values: string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === "string" && v.trim().length > 0))];
}

export function DiscoverModelCard({
  model,
  detailHref,
  locale,
  t,
  availableLabel,
  browseOnlyLabel,
}: DiscoverModelCardProps) {
  const providerStyle = getProviderStyle(model.provider);
  const providerName = providerDisplayLabel(model.provider, model.provider_display, locale, t);
  const isSelectable = model.is_selectable_in_console !== false;

  const allTokens = dedupeTokens([
    ...(model.input_modalities ?? []),
    ...(model.output_modalities ?? []),
    ...(model.supported_tools ?? []),
    ...(model.supported_features ?? []),
  ]);
  const visibleTokens = filterCardTokens(allTokens).slice(0, 5);

  return (
    <Link href={detailHref} className="dhub-model-card">
      <div className="dhub-model-card-head">
        <div
          className="dhub-model-card-logo"
          style={{ background: providerStyle.bg }}
        >
          {providerStyle.label}
        </div>
        <div className="dhub-model-card-meta">
          <strong className="dhub-model-card-name">{model.display_name}</strong>
          <span className="dhub-model-card-provider">{providerName}</span>
        </div>
      </div>
      <p className="dhub-model-card-desc">
        {model.description || model.display_name}
      </p>
      <div className="dhub-model-card-tags">
        {visibleTokens.map((token) => (
          <span key={token} className="dhub-model-card-tag">
            {labelForToken(token, t)}
          </span>
        ))}
        <span className={`dhub-model-card-status${isSelectable ? " is-ready" : ""}`}>
          {isSelectable ? availableLabel : browseOnlyLabel}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create DiscoverFeatured component**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverFeatured.tsx`:

```tsx
"use client";

import { Link } from "@/i18n/navigation";
import { categoryLabel, providerDisplayLabel } from "@/lib/discover-labels";
import { DecoCircles, DecoWave, DecoLandscape } from "./discover-icons";

interface FeaturedModel {
  canonical_model_id: string;
  display_name: string;
  provider: string;
  provider_display: string;
  description: string;
  official_category_key?: string | null;
  official_category?: string | null;
}

interface DiscoverFeaturedProps {
  models: FeaturedModel[];
  locale: string;
  t: (key: string) => string;
  title: string;
  subtitle: string;
  buildDetailHref: (modelId: string) => string;
}

/** Rotating gradient palettes for featured cards */
const FEATURED_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #a855f7)",
  "linear-gradient(135deg, #3b82f6, #60a5fa)",
  "linear-gradient(135deg, #f97316, #ef4444)",
  "linear-gradient(135deg, #10b981, #34d399)",
  "linear-gradient(135deg, #ec4899, #f472b6)",
];

const DECO_COMPONENTS = [DecoCircles, DecoWave, DecoLandscape];

export function DiscoverFeatured({
  models,
  locale,
  t,
  title,
  subtitle,
  buildDetailHref,
}: DiscoverFeaturedProps) {
  if (models.length === 0) {
    return null;
  }

  const displayed = models.slice(0, 3);

  return (
    <section className="dhub-featured">
      <div className="dhub-section-head">
        <div>
          <h2 className="dhub-section-title">{title}</h2>
          <p className="dhub-section-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="dhub-featured-grid">
        {displayed.map((model, index) => {
          const gradient = FEATURED_GRADIENTS[index % FEATURED_GRADIENTS.length];
          const Deco = DECO_COMPONENTS[index % DECO_COMPONENTS.length];
          const catName = categoryLabel(
            model.official_category_key,
            model.official_category,
            locale,
            t,
          );

          return (
            <Link
              key={model.canonical_model_id}
              href={buildDetailHref(model.canonical_model_id)}
              className={`dhub-featured-card${index === 0 ? " dhub-featured-card--hero" : ""}`}
              style={{ background: gradient }}
            >
              <Deco />
              <div className="dhub-featured-card-body">
                <span className="dhub-featured-card-cat">{catName}</span>
                <strong className="dhub-featured-card-name">{model.display_name}</strong>
                <span className="dhub-featured-card-desc">{model.description}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create DiscoverCatalogSection component**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverCatalogSection.tsx`:

```tsx
"use client";

import { ArrowRightIcon } from "./discover-icons";
import { DiscoverModelCard } from "./DiscoverModelCard";

interface CatalogModel {
  canonical_model_id: string;
  display_name: string;
  provider: string;
  provider_display: string;
  description: string;
  official_category_key?: string | null;
  official_category?: string | null;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_tools: string[];
  supported_features: string[];
  is_selectable_in_console?: boolean | null;
}

interface DiscoverCatalogSectionProps {
  categoryKey: string;
  categoryName: string;
  models: CatalogModel[];
  isHighlighted: boolean;
  locale: string;
  t: (key: string) => string;
  countLabel: string;
  viewAllLabel: string;
  availableLabel: string;
  browseOnlyLabel: string;
  buildDetailHref: (modelId: string) => string;
  /** ref callback for scroll-into-view when scene card is clicked */
  sectionRef?: (el: HTMLElement | null) => void;
}

export function DiscoverCatalogSection({
  categoryKey,
  categoryName,
  models,
  isHighlighted,
  locale,
  t,
  countLabel,
  viewAllLabel,
  availableLabel,
  browseOnlyLabel,
  buildDetailHref,
  sectionRef,
}: DiscoverCatalogSectionProps) {
  return (
    <div
      ref={sectionRef}
      className={`dhub-catalog-section${isHighlighted ? " is-highlighted" : ""}`}
      data-category={categoryKey}
    >
      <div className="dhub-catalog-section-head">
        <div className="dhub-catalog-section-title-row">
          <span className="dhub-catalog-section-name">{categoryName}</span>
          <span className="dhub-catalog-section-count">{countLabel}</span>
        </div>
        <span className="dhub-catalog-section-viewall">
          {viewAllLabel} <ArrowRightIcon size={12} />
        </span>
      </div>
      <div className="dhub-catalog-scroll">
        {models.map((model) => (
          <DiscoverModelCard
            key={model.canonical_model_id}
            model={model}
            detailHref={buildDetailHref(model.canonical_model_id)}
            locale={locale}
            t={t}
            availableLabel={availableLabel}
            browseOnlyLabel={browseOnlyLabel}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/_components/DiscoverModelCard.tsx apps/web/app/[locale]/(console)/app/discover/_components/DiscoverFeatured.tsx apps/web/app/[locale]/(console)/app/discover/_components/DiscoverCatalogSection.tsx
git commit -m "feat(discover): add DiscoverModelCard, DiscoverFeatured, DiscoverCatalogSection"
```

---

### Task 5: Create DiscoverMemoryPacks Component

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverMemoryPacks.tsx`

- [ ] **Step 1: Create DiscoverMemoryPacks component (empty state for now)**

Create `apps/web/app/[locale]/(console)/app/discover/_components/DiscoverMemoryPacks.tsx`:

```tsx
"use client";

interface DiscoverMemoryPacksProps {
  title: string;
  subtitle: string;
  comingSoonLabel: string;
  roadmapLabels: string[];
}

export function DiscoverMemoryPacks({
  title,
  subtitle,
  comingSoonLabel,
  roadmapLabels,
}: DiscoverMemoryPacksProps) {
  return (
    <section className="dhub-memory-packs">
      <div className="dhub-section-head">
        <div>
          <h2 className="dhub-section-title">{title}</h2>
          <p className="dhub-section-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="dhub-memory-packs-empty">
        <div className="dhub-memory-packs-empty-copy">
          <strong>{comingSoonLabel}</strong>
        </div>
        <div className="dhub-memory-packs-pills">
          {roadmapLabels.map((label) => (
            <span key={label} className="dhub-memory-packs-pill">{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/_components/DiscoverMemoryPacks.tsx
git commit -m "feat(discover): add DiscoverMemoryPacks empty-state component"
```

---

### Task 6: Rewrite the Main Discover Page

**Files:**
- Rewrite: `apps/web/app/[locale]/(console)/app/discover/page.tsx`

- [ ] **Step 1: Rewrite page.tsx with the new Hub layout**

Replace the entire contents of `apps/web/app/[locale]/(console)/app/discover/page.tsx` with:

```tsx
"use client";

import {
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { apiGet, isApiRequestError } from "@/lib/api";
import {
  categoryLabel,
  providerDisplayLabel,
  groupLabel,
} from "@/lib/discover-labels";
import { DiscoverSearch } from "./_components/DiscoverSearch";
import { DiscoverSceneNav } from "./_components/DiscoverSceneNav";
import { DiscoverFeatured } from "./_components/DiscoverFeatured";
import { DiscoverCatalogSection } from "./_components/DiscoverCatalogSection";
import { DiscoverMemoryPacks } from "./_components/DiscoverMemoryPacks";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface DiscoverTaxonomyItem {
  key: string;
  label: string;
  group_key?: string | null;
  group_label?: string | null;
  group?: string | null;
  order: number;
  count: number;
}

interface DiscoverModel {
  canonical_model_id: string;
  model_id?: string;
  display_name: string;
  provider: string;
  provider_display: string;
  official_group_key?: string | null;
  official_group?: string | null;
  official_category_key?: string | null;
  official_category?: string | null;
  official_order?: number | null;
  description: string;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_tools: string[];
  supported_features: string[];
  official_url?: string | null;
  aliases: string[];
  pipeline_slot?:
    | "llm"
    | "asr"
    | "tts"
    | "vision"
    | "realtime"
    | "realtime_asr"
    | "realtime_tts"
    | null;
  is_selectable_in_console?: boolean | null;
  is_featured?: boolean | null;
}

interface DiscoverResponse {
  taxonomy: DiscoverTaxonomyItem[];
  items: DiscoverModel[];
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const SEARCH_QUERY_KEY = "q";
const SLOT_QUERY_KEY = "slot";

function categoryKeyForModel(item: DiscoverModel): string {
  return item.official_category_key || item.official_category || "unknown";
}

function normalizeDiscoverPayload(raw: unknown): DiscoverResponse {
  if (Array.isArray(raw)) {
    const items = raw.filter(
      (item): item is DiscoverModel => typeof item === "object" && item !== null,
    );
    const taxonomyMap = new Map<string, DiscoverTaxonomyItem>();
    items.forEach((item) => {
      const key = categoryKeyForModel(item);
      const current = taxonomyMap.get(key);
      if (current) {
        current.count += 1;
        return;
      }
      taxonomyMap.set(key, {
        key,
        label: item.official_category || key,
        group_key: item.official_group_key || null,
        group_label: item.official_group || null,
        group: item.official_group || null,
        order: item.official_order || 0,
        count: 1,
      });
    });
    return {
      taxonomy: Array.from(taxonomyMap.values()).sort((a, b) => a.order - b.order),
      items,
    };
  }
  if (typeof raw !== "object" || raw === null) {
    return { taxonomy: [], items: [] };
  }
  const response = raw as Partial<DiscoverResponse>;
  return {
    taxonomy: Array.isArray(response.taxonomy) ? response.taxonomy : [],
    items: Array.isArray(response.items) ? response.items : [],
  };
}

/* ------------------------------------------------------------------ */
/*  Picker context bar (preserved from original)                      */
/* ------------------------------------------------------------------ */

function formatPipelineSlot(
  value: string | null | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  if (!value) return null;
  const slotLabelMap: Record<string, string> = {
    llm: "dashboard.slot.llm",
    asr: "dashboard.slot.asr",
    tts: "dashboard.slot.tts",
    vision: "dashboard.slot.vision",
    realtime: "dashboard.slot.realtime",
    realtime_asr: "dashboard.slot.realtimeAsr",
    realtime_tts: "dashboard.slot.realtimeTts",
  };
  if (slotLabelMap[value]) return t(slotLabelMap[value]);
  return value
    .split("_")
    .map((p) =>
      p === "llm" || p === "asr" || p === "tts"
        ? p.toUpperCase()
        : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

function DiscoverPageContent() {
  const t = useTranslations("console");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /* ---- Picker mode params ---- */
  const pickerMode = searchParams.get("picker") === "1";
  const pickerCategory = searchParams.get("category");
  const currentModelId = searchParams.get("current_model_id");
  const from = searchParams.get("from");

  /* ---- Hub params ---- */
  const querySearch = searchParams.get(SEARCH_QUERY_KEY) || "";
  const selectedSlot = searchParams.get(SLOT_QUERY_KEY) || null;

  /* ---- Data ---- */
  const [payload, setPayload] = useState<DiscoverResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(querySearch);
  const loadingModels = payload === null && errorMessage === null;

  useEffect(() => {
    let cancelled = false;
    apiGet<DiscoverResponse | DiscoverModel[]>("/api/v1/models/catalog?view=discover")
      .then((data) => {
        if (!cancelled) {
          setPayload(normalizeDiscoverPayload(data));
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPayload({ taxonomy: [], items: [] });
          setErrorMessage(
            isApiRequestError(error) ? error.message : t("discover.loadFailed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  /* ---- URL state helpers ---- */
  function replaceQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val) {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    }
    const nextQuery = params.toString();
    const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const currentHref = searchParams.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    if (nextHref !== currentHref) {
      startTransition(() => router.replace(nextHref));
    }
  }

  /* ---- Derived data ---- */
  const baseItems = useMemo(() => {
    let items = [...(payload?.items ?? [])];
    if (pickerMode && pickerCategory) {
      items = items.filter(
        (item) =>
          item.pipeline_slot === pickerCategory &&
          item.is_selectable_in_console !== false,
      );
    }
    return items;
  }, [payload, pickerCategory, pickerMode]);

  const taxonomy = useMemo(() => {
    const counts = new Map<string, number>();
    baseItems.forEach((item) => {
      const key = categoryKeyForModel(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return (payload?.taxonomy ?? [])
      .map((item) => ({ ...item, count: counts.get(item.key) || 0 }))
      .filter((item) => item.count > 0);
  }, [baseItems, payload]);

  /* ---- Search filter ---- */
  const q = deferredSearch.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    return baseItems
      .filter((item) => {
        if (!q) return true;
        const haystack = [
          item.display_name,
          providerDisplayLabel(item.provider, item.provider_display, locale, t),
          item.description,
          item.official_category || "",
          categoryLabel(item.official_category_key, item.official_category, locale, t),
          item.official_group || "",
          groupLabel(item.official_group_key, item.official_group, locale, t),
          ...(item.aliases ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const oA = a.official_order ?? 9999;
        const oB = b.official_order ?? 9999;
        return oA !== oB ? oA - oB : a.display_name.localeCompare(b.display_name);
      });
  }, [baseItems, locale, q, t]);

  /* ---- Featured models ---- */
  const featuredModels = useMemo(() => {
    const featured = filteredModels.filter((m) => m.is_featured === true);
    if (featured.length > 0) return featured.slice(0, 3);
    // Fallback: pick top model per unique category (ordered by official_order)
    const seen = new Set<string>();
    const fallback: DiscoverModel[] = [];
    for (const model of filteredModels) {
      if (model.is_selectable_in_console === false) continue;
      const cat = categoryKeyForModel(model);
      if (seen.has(cat)) continue;
      seen.add(cat);
      fallback.push(model);
      if (fallback.length >= 3) break;
    }
    return fallback;
  }, [filteredModels]);

  /* ---- Group models by category for catalog sections ---- */
  const modelsByCategory = useMemo(() => {
    const map = new Map<string, DiscoverModel[]>();
    for (const model of filteredModels) {
      const key = categoryKeyForModel(model);
      const arr = map.get(key);
      if (arr) {
        arr.push(model);
      } else {
        map.set(key, [model]);
      }
    }
    return map;
  }, [filteredModels]);

  const orderedCategories = useMemo(() => {
    return taxonomy
      .filter((tax) => modelsByCategory.has(tax.key))
      .map((tax) => ({
        key: tax.key,
        label: categoryLabel(tax.key, tax.label, locale, t),
        count: modelsByCategory.get(tax.key)?.length ?? 0,
      }));
  }, [locale, modelsByCategory, t, taxonomy]);

  /* ---- Active pipeline slots (for scene nav) ---- */
  const activeSlots = useMemo(() => {
    const slots = new Set<string>();
    baseItems.forEach((item) => {
      if (item.pipeline_slot) slots.add(item.pipeline_slot);
    });
    return [...slots];
  }, [baseItems]);

  /* ---- Scroll-into-view refs for scene nav ---- */
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  const handleSceneSelect = useCallback(
    (slot: string | null) => {
      replaceQuery({ [SLOT_QUERY_KEY]: slot });
      if (slot) {
        // Find the first category section that has models matching this slot
        const target = baseItems.find((m) => m.pipeline_slot === slot);
        if (target) {
          const catKey = categoryKeyForModel(target);
          const el = sectionRefs.current.get(catKey);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    },
    [baseItems, searchParams, pathname, router],
  );

  /* ---- Build detail href helper ---- */
  const buildDetailHref = useCallback(
    (modelId: string) => {
      const params = new URLSearchParams();
      if (pickerMode) params.set("picker", "1");
      if (pickerCategory) params.set("category", pickerCategory);
      if (currentModelId) params.set("current_model_id", currentModelId);
      if (from) params.set("from", from);
      return `/app/discover/models/${encodeURIComponent(modelId)}${
        params.size ? `?${params.toString()}` : ""
      }`;
    },
    [currentModelId, from, pickerCategory, pickerMode],
  );

  /* ---- Picker labels ---- */
  const pickerSlotLabel = pickerCategory
    ? formatPipelineSlot(pickerCategory, t)
    : null;
  const pickerCategoryLabel = pickerCategory
    ? categoryLabel(pickerCategory, pickerCategory, locale, t)
    : null;

  /* ---- Render ---- */
  return (
    <div className="dhub-page">
      {/* Picker context bar */}
      {pickerMode ? (
        <div
          className="discover-console-context discover-picker-context"
          data-testid="discover-picker-context"
        >
          <div className="discover-console-context-stat">
            <span>{t("discover.pickerSlot")}</span>
            <strong>
              {pickerSlotLabel ||
                pickerCategoryLabel ||
                t("discover.modelsOfficial")}
            </strong>
          </div>
          <div className="discover-console-context-stat">
            <span>{t("discover.pickerModel")}</span>
            <strong>{currentModelId || t("dashboard.modelFallback")}</strong>
          </div>
          {from ? (
            <Link href={from} className="discover-console-context-link">
              {t("discover.pickerReturn")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Header + Search */}
      <header className="dhub-header">
        <div className="dhub-header-title">
          <span className="dhub-header-kicker">DISCOVER</span>
          <h1 className="dhub-header-h1">{t("discover.title")}</h1>
        </div>
        <DiscoverSearch
          value={querySearch}
          placeholder={t("discover.searchPlaceholderHub")}
          clearLabel={t("discover.clearSearch")}
          onChange={(val) => replaceQuery({ [SEARCH_QUERY_KEY]: val || null })}
          onClear={() => replaceQuery({ [SEARCH_QUERY_KEY]: null })}
        />
      </header>

      {/* Scene navigation (hidden in picker mode) */}
      {!pickerMode ? (
        <DiscoverSceneNav
          activeSlots={activeSlots}
          selectedSlot={selectedSlot}
          onSelect={handleSceneSelect}
          t={t}
          sectionLabel={t("discover.sceneNav")}
        />
      ) : null}

      {/* Loading / Error */}
      {loadingModels ? (
        <div className="dhub-surface" aria-hidden="true">
          <div className="dhub-skeleton-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="dhub-skeleton-card" />
            ))}
          </div>
        </div>
      ) : errorMessage ? (
        <div className="dhub-empty">
          <strong>{t("discover.loadFailed")}</strong>
          <span>{errorMessage}</span>
        </div>
      ) : (
        <>
          {/* Featured models */}
          <DiscoverFeatured
            models={featuredModels}
            locale={locale}
            t={t}
            title={t("discover.featured")}
            subtitle={t("discover.featuredSubtitle")}
            buildDetailHref={buildDetailHref}
          />

          {/* Model catalog by category */}
          {filteredModels.length === 0 ? (
            <div className="dhub-empty">
              <strong>{t("discover.noModelsFound")}</strong>
            </div>
          ) : (
            <div className="dhub-catalog">
              {orderedCategories.map((cat) => {
                const models = modelsByCategory.get(cat.key) ?? [];
                // Determine if this section matches the selected slot
                const matchesSlot =
                  selectedSlot !== null &&
                  models.some((m) => m.pipeline_slot === selectedSlot);

                return (
                  <DiscoverCatalogSection
                    key={cat.key}
                    categoryKey={cat.key}
                    categoryName={cat.label}
                    models={models}
                    isHighlighted={matchesSlot}
                    locale={locale}
                    t={t}
                    countLabel={t("discover.catalogModelsCount", {
                      count: cat.count,
                    })}
                    viewAllLabel={t("discover.catalogViewAll")}
                    availableLabel={t("discover.availableNow")}
                    browseOnlyLabel={t("discover.browseOnlyShort")}
                    buildDetailHref={buildDetailHref}
                    sectionRef={(el) => {
                      if (el) {
                        sectionRefs.current.set(cat.key, el);
                      } else {
                        sectionRefs.current.delete(cat.key);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Memory packs community (hidden in picker mode) */}
          {!pickerMode ? (
            <DiscoverMemoryPacks
              title={t("discover.memoryPacks")}
              subtitle={t("discover.memoryPacksSubtitle")}
              comingSoonLabel={t("discover.memoryPacksComingSoon")}
              roadmapLabels={[
                t("discover.packsRoadmap0"),
                t("discover.packsRoadmap1"),
                t("discover.packsRoadmap2"),
              ]}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div className="dhub-page" />}>
      <DiscoverPageContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

Run: `cd /Users/dog/Desktop/铭润 && npx next build --no-lint 2>&1 | tail -10`
Expected: Build succeeds. The page won't look right yet (no CSS) but it should compile.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/discover/page.tsx
git commit -m "feat(discover): rewrite page.tsx with Hub layout and sub-components"
```

---

### Task 7: Write Hub CSS Styles

**Files:**
- Modify: `apps/web/styles/globals.css`

- [ ] **Step 1: Replace discover CSS with Hub styles**

In `apps/web/styles/globals.css`, find the block starting at `.discover-console-page` (around line 16125) and ending before `.model-detail` (around line 16800). Replace that entire block with the following new Hub styles. **Keep** all `.discover-console-context` and `.model-detail-*` styles untouched — only replace the discover page-specific classes.

Insert the following CSS **before** the `.model-detail` section (around line 16800). Remove the old `.discover-console-page` through `.discover-model-skeleton.medium` block (lines ~16125–16798), then insert:

```css
/* ── Discover Hub Page ─────────────────── */
.dhub-page {
  width: min(100%, 1480px);
  margin: 0 auto;
  padding: 12px 8px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dhub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;
}

.dhub-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dhub-header-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.dhub-header-h1 {
  margin: 0;
  font-size: clamp(20px, 2.2vw, 26px);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

/* ── Search ── */
.dhub-search-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  width: min(360px, 40%);
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-base) 88%, white);
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}

.dhub-search-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent);
  background: white;
}

.dhub-search-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}

.dhub-search-input {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.dhub-search-input::placeholder {
  color: var(--text-muted);
}

.dhub-search-clear {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: color-mix(in srgb, var(--accent) 88%, #71462c);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

/* ── Scene Navigation ── */
.dhub-scenes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px;
}

.dhub-scenes-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.dhub-scenes-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}

.dhub-scene-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 12px;
  border: none;
  border-radius: 12px;
  color: white;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.dhub-scene-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
}

.dhub-scene-card.is-active {
  box-shadow: 0 0 0 3px white, 0 0 0 5px color-mix(in srgb, var(--accent) 50%, transparent);
}

.dhub-scene-card-name {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

/* ── Shared section head ── */
.dhub-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.dhub-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
}

.dhub-section-subtitle {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
}

/* ── Featured Models ── */
.dhub-featured {
  padding: 0 4px;
}

.dhub-featured-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 10px;
}

.dhub-featured-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 20px;
  border-radius: 16px;
  color: white;
  text-decoration: none;
  min-height: 130px;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.dhub-featured-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15);
}

.dhub-featured-card--hero {
  padding: 24px;
}

.dhub-featured-card-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dhub-featured-card-cat {
  font-size: 10px;
  opacity: 0.7;
}

.dhub-featured-card-name {
  font-size: 15px;
  font-weight: 800;
}

.dhub-featured-card--hero .dhub-featured-card-name {
  font-size: 18px;
}

.dhub-featured-card-desc {
  font-size: 11px;
  opacity: 0.75;
  margin-top: 2px;
}

/* ── Catalog ── */
.dhub-catalog {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 4px;
}

.dhub-catalog-section {
  transition: opacity 200ms ease;
}

.dhub-catalog-section:not(.is-highlighted) {
  /* No dimming by default; only dim when a slot IS selected */
}

.dhub-page:has(.dhub-catalog-section.is-highlighted)
  .dhub-catalog-section:not(.is-highlighted) {
  opacity: 0.5;
}

.dhub-catalog-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.dhub-catalog-section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dhub-catalog-section-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-primary);
}

.dhub-catalog-section-count {
  font-size: 10px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-base));
  padding: 2px 8px;
  border-radius: 6px;
}

.dhub-catalog-section-viewall {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: color-mix(in srgb, var(--accent) 88%, #71462c);
  font-weight: 600;
  cursor: pointer;
}

.dhub-catalog-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.dhub-catalog-scroll::-webkit-scrollbar {
  display: none;
}

/* ── Model Card (compact) ── */
.dhub-model-card {
  flex: 0 0 auto;
  width: 220px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 8%, var(--border));
  background: color-mix(in srgb, var(--bg-card) 96%, white);
  text-decoration: none;
  color: inherit;
  transition: background 140ms ease, box-shadow 140ms ease, transform 120ms ease;
}

.dhub-model-card:hover {
  background: color-mix(in srgb, var(--accent) 5%, white);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

.dhub-model-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.dhub-model-card-logo {
  width: 26px;
  height: 26px;
  min-width: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 9px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.34);
}

.dhub-model-card-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dhub-model-card-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dhub-model-card-provider {
  font-size: 9px;
  color: var(--text-secondary);
}

.dhub-model-card-desc {
  margin: 0 0 6px;
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dhub-model-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.dhub-model-card-tag {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-base));
  font-size: 9px;
  color: color-mix(in srgb, var(--accent) 88%, #71462c);
  font-weight: 600;
}

.dhub-model-card-status {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-base) 92%, white);
  font-size: 9px;
  color: var(--text-secondary);
  font-weight: 600;
}

.dhub-model-card-status.is-ready {
  background: color-mix(in srgb, var(--success) 10%, white);
  color: color-mix(in srgb, var(--success) 88%, #1f5944);
}

/* ── Memory Packs ── */
.dhub-memory-packs {
  padding: 0 4px;
}

.dhub-memory-packs-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--accent) 10%, var(--border));
  border-radius: 18px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-card) 94%, white),
      color-mix(in srgb, var(--bg-card) 88%, white)
    );
}

.dhub-memory-packs-empty-copy strong {
  color: var(--text-primary);
  font-size: 15px;
}

.dhub-memory-packs-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dhub-memory-packs-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-base) 92%, white);
  border: 1px solid color-mix(in srgb, var(--accent) 8%, var(--border));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

/* ── Shared: empty + skeleton ── */
.dhub-empty {
  display: flex;
  min-height: 140px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.dhub-empty strong {
  color: var(--text-primary);
  font-size: 15px;
}

.dhub-surface {
  border: 1px solid color-mix(in srgb, var(--accent) 10%, var(--border));
  border-radius: 24px;
  background: color-mix(in srgb, var(--bg-card) 96%, white);
  box-shadow: 0 16px 36px rgba(29, 21, 16, 0.05);
  padding: 24px;
}

.dhub-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.dhub-skeleton-card {
  height: 130px;
  border-radius: 14px;
  background: linear-gradient(
    90deg,
    rgba(236, 233, 229, 0.56),
    rgba(255, 255, 255, 0.94),
    rgba(236, 233, 229, 0.56)
  );
  background-size: 200% 100%;
  animation: model-detail-shimmer 1.4s linear infinite;
}

/* ── Responsive ── */
@media (max-width: 900px) {
  .dhub-header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .dhub-search-shell {
    width: 100%;
  }

  .dhub-scenes-grid {
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: auto auto;
  }

  .dhub-featured-grid {
    grid-template-columns: 1fr;
  }

  .dhub-featured-card {
    min-height: 100px;
  }

  .dhub-memory-packs-empty {
    flex-direction: column;
    align-items: flex-start;
  }

  .dhub-skeleton-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .dhub-scenes-grid {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .dhub-scenes-grid::-webkit-scrollbar {
    display: none;
  }

  .dhub-scene-card {
    min-width: 80px;
    flex: 0 0 auto;
  }

  .dhub-model-card {
    width: 180px;
  }
}
```

**Important:** Keep the existing `.discover-console-context`, `.discover-console-context-stat`, `.discover-console-context-link`, and `.discover-picker-context` classes intact — the picker context bar still uses them.

- [ ] **Step 2: Verify the build and check for visual rendering**

Run: `cd /Users/dog/Desktop/铭润 && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/styles/globals.css
git commit -m "feat(discover): add Hub CSS styles, replace old discover-console classes"
```

---

### Task 8: Update Playwright Tests

**Files:**
- Modify: `apps/web/tests/console-shell.spec.ts`

- [ ] **Step 1: Update the existing discover tests to work with new DOM structure**

The existing tests rely on CSS classes from the old design (`.model-card`, `.discover-category-chip`, `.model-card-provider`). Update them to use the new `dhub-*` classes.

In `apps/web/tests/console-shell.spec.ts`, find the test `"discover model details resolve dotted ids and current vision model ids"` (around line 637). Replace `.model-card` with `.dhub-model-card`:

```typescript
test("discover model details resolve dotted ids and current vision model ids", async ({
  page,
}) => {
  await installWorkbenchApiMock(page, { authenticated: true });

  await page.goto("/app/discover");
  await page
    .locator(".dhub-model-card")
    .filter({ hasText: "Qwen3.5-Plus" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/discover\/models\/qwen3\.5-plus$/);
  await expect(
    page.getByRole("heading", { name: "Qwen3.5-Plus" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "使用此模型" })).toHaveCount(
    0,
  );
  await expect(page.locator(".model-detail-status")).toContainText(
    "可在助手页使用",
  );
  await expect(page.getByRole("link", { name: "返回发现" })).toBeVisible();
  await expect(page.getByRole("link", { name: "models" })).toHaveCount(0);

  await page.goto("/app/discover/models/qwen3-vl-plus");
  await expect(
    page.getByRole("heading", { name: "Qwen3-VL-Plus" }),
  ).toBeVisible();
  await expect(page.locator(".model-detail-provider")).toContainText("千问");
});
```

Find the test `"english discover and detail localize official labels"` (around line 668). Update the category chip selector and provider selector:

```typescript
test("english discover and detail localize official labels", async ({
  page,
}) => {
  await page.goto("/en/app/discover");
  // Category section name should show English label
  await expect(
    page
      .locator(".dhub-catalog-section-name")
      .filter({ hasText: "Text Generation" })
      .first(),
  ).toBeVisible();
  // Provider name on card should show English
  await expect(page.locator(".dhub-model-card-provider").first()).toContainText(
    "Qwen",
  );

  await page
    .locator(".dhub-model-card")
    .filter({ hasText: "Qwen3.5-Plus" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/en\/app\/discover\/models\/qwen3\.5-plus$/);
  await expect(
    page.locator(".model-detail-tags .model-card-tag.highlight"),
  ).toContainText("Text Generation");
  await expect(page.locator(".model-detail-provider")).toContainText(
    "Alibaba",
  );
});
```

The error state test (line 696) uses `getByText` which doesn't rely on CSS classes — it should still work as-is.

The picker test (line 2971) uses `[data-testid='discover-picker-context']` which we preserved — it should still work as-is.

- [ ] **Step 2: Run the Playwright tests**

Run: `cd /Users/dog/Desktop/铭润 && npx playwright test tests/console-shell.spec.ts --grep "discover" --reporter=list 2>&1 | tail -20`
Expected: All 4 discover tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/console-shell.spec.ts
git commit -m "test(discover): update discover E2E tests for hub redesign DOM structure"
```

---

### Task 9: Full Build & Test Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /Users/dog/Desktop/铭润 && npx next build --no-lint 2>&1 | tail -10`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run all Playwright tests**

Run: `cd /Users/dog/Desktop/铭润 && npx playwright test tests/console-shell.spec.ts --reporter=list 2>&1 | tail -30`
Expected: All tests pass. No regressions.

- [ ] **Step 3: Manual smoke test**

Start the dev server and verify visually:
Run: `cd /Users/dog/Desktop/铭润 && npx next dev -p 3100`

Check these routes:
1. `http://localhost:3100/app/discover` — Hub layout renders: scenes, featured, catalog sections, memory packs
2. `http://localhost:3100/en/app/discover` — English locale renders correctly
3. `http://localhost:3100/app/discover?picker=1&category=vision` — Picker mode hides scenes and memory packs
4. Click a model card → navigates to detail page successfully

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(discover): address issues found during verification"
```
