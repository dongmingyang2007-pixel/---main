# Console Glassmorphism Redesign

**Date**: 2026-03-22
**Scope**: Full visual overhaul of all 6 console pages + structural component refactoring
**Approach**: Structural refactoring — new glass primitive components, reorganized component hierarchy, unified animation system
**Hard constraint**: All existing functionality must be preserved without regression

---

## 1. Design System

### 1.1 Color Palette

All tokens are scoped under `[data-theme="console"]` and use the `--console-` prefix for consistency with the existing codebase.

| Token | Value | Usage |
|-------|-------|-------|
| `--console-bg` | `linear-gradient(135deg, #e8f0fe 0%, #ede8f8 50%, #fce8e8 100%)` | Page background |
| `--console-surface` | `rgba(255,255,255,0.55)` | Cards, panels (+ `backdrop-filter: blur(20px)`) |
| `--console-panel` | `rgba(255,255,255,0.4)` | Sidebar, inspector (+ `blur(16px)`) |
| `--console-topbar` | `rgba(255,255,255,0.35)` | Top bar, chat header (+ `blur(16px)`) |
| `--console-border` | `rgba(255,255,255,0.7)` | Card/panel borders |
| `--console-border-subtle` | `rgba(255,255,255,0.5)` | Secondary borders |
| `--console-accent` | `#6366f1` | Primary actions, active states |
| `--console-accent-gradient` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | Buttons, logo, user message bubbles |
| `--console-accent-secondary` | `#3b82f6` | Secondary accent |
| `--console-text-primary` | `#1a1a2e` | Headings, important text |
| `--console-text-secondary` | `#374151` | Body text |
| `--console-text-muted` | `#6b7280` | Labels, descriptions |
| `--console-text-faint` | `#9ca3af` | Timestamps, placeholders |
| `--console-success` | `#10b981` | Active status, positive indicators |
| `--console-warning` | `#f59e0b` | Warnings |
| `--console-error` | `#ef4444` | Errors, danger zone |
| `--console-slot-brain` | `#6366f1` | LLM/Brain model slot |
| `--console-slot-realtime` | `#8b5cf6` | Realtime model slot |
| `--console-slot-asr` | `#3b82f6` | ASR model slot |
| `--console-slot-tts` | `#10b981` | TTS model slot |
| `--console-slot-vision` | `#f59e0b` | Vision model slot |
| `--console-slot-realtime-asr` | `#3b82f6` | Realtime ASR slot |
| `--console-slot-realtime-tts` | `#14b8a6` | Realtime TTS slot |

The shadcn/ui bridge variables (`--primary`, `--ring`, `--destructive`, etc.) currently mapped to the warm orange `#c8734a` must also be updated to use the new indigo accent `#6366f1`.

### 1.2 Ambient Background

The page background uses the gradient defined above plus two soft blurred circles ("ambient blobs") positioned with `position: absolute`, `border-radius: 50%`, and `filter: blur(60-90px)`:
- Blob 1: `rgba(99,102,241,0.08)`, top-right area
- Blob 2: `rgba(139,92,246,0.06)`, bottom-left area

These are placed on the root layout and remain static (no scroll). They provide depth and atmosphere without affecting content layout.

### 1.3 Typography

| Role | Font Family | Weight | Fallback |
|------|-------------|--------|----------|
| Display / Headings | Sora | 600-700 | system-ui, sans-serif |
| Body / UI text | DM Sans | 400-600 | system-ui, sans-serif |
| Code / Model IDs | JetBrains Mono | 400-500 | monospace |
| Chinese (CJK) | Noto Sans SC | 400-700 | system-ui, sans-serif |

All fonts loaded via `next/font/google` in `app/[locale]/layout.tsx`. The current layout loads DM Sans, Inter, and JetBrains Mono. Changes needed:
- **Add** Sora (weights: 600, 700) via `next/font/google`
- **Add** Noto Sans SC (weights: 400, 500, 700 only — subset to avoid the full ~7MB download)
- **Keep** DM Sans (already loaded), JetBrains Mono (already loaded)
- **Remove** Inter (no longer used in the console theme)
- Wire font CSS variables through the layout's `className` or `variable` prop

### 1.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--console-radius-sm` | 8px | Badge, tag, small chips |
| `--console-radius-md` | 12px | Button, input, search bar |
| `--console-radius-lg` | 16px | Card, panel, modal |
| `--console-radius-xl` | 20px | Page-level containers |

**Note**: The existing `:root` defines `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px`. The console-scoped tokens use the `--console-` prefix to avoid overriding root tokens. Glass primitive components must reference `--console-radius-*`, not the root `--radius-*` tokens, to prevent cascading side effects on shadcn/ui components.

### 1.5 Spacing

Reuse existing spacing scale (no change):
- `--space-1`: 4px, `--space-2`: 8px, `--space-3`: 12px, `--space-4`: 16px
- `--space-6`: 24px, `--space-8`: 32px, `--space-12`: 48px

### 1.6 Shadows (warm → neutral transition)

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 2px 12px rgba(0,0,0,0.04)` | Cards at rest |
| `--shadow-raised` | `0 4px 24px rgba(0,0,0,0.06)` | Hover state, elevated cards |
| `--shadow-overlay` | `0 8px 32px rgba(0,0,0,0.08)` | Sidebar overlay, modals |
| `--shadow-primary` | `0 2px 8px rgba(99,102,241,0.25)` | Primary buttons |

---

## 2. Glass Primitive Components

New reusable components extracted to replace/extend ConsolePrimitives.

### 2.1 GlassCard

Standard content container.

```
Props: className, children
Styles:
  background: var(--console-surface)
  backdrop-filter: blur(20px)
  border: 1px solid var(--console-border)
  border-radius: var(--console-radius-lg)  // 16px
  padding: 20px
```

### 2.2 GlassPanel

Sidebar, inspector, and structural panels.

```
Props: className, children
Styles:
  background: var(--console-panel)
  backdrop-filter: blur(16px)
  border: 1px solid var(--console-border-subtle)
  border-radius: var(--console-radius-lg)
```

### 2.3 GlassButton

Three variants:

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Primary | `var(--console-accent-gradient)` | white | none |
| Secondary | `rgba(255,255,255,0.6)` + blur(8px) | `--console-text-primary` | `rgba(0,0,0,0.08)` |
| Ghost | transparent | `--console-accent` | `rgba(99,102,241,0.3)` |

All variants: `border-radius: var(--console-radius-md)` (12px), `padding: 9px 20px`, `font-weight: 600`.

Primary variant has `box-shadow: var(--shadow-primary)`.

### 2.4 GlassInput

```
Styles:
  background: rgba(255,255,255,0.5)
  border: 1px solid var(--console-border)
  border-radius: var(--console-radius-md)
  padding: 10px 14px

Focus state:
  border-color: var(--console-accent)
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1)
```

### 2.5 GlassTopBar

Fixed top bar across all console pages.

Replaces both `ConsoleTopBar.tsx` (which already has branding, ⌘K, language toggle, user avatar) and `InlineTopBar.tsx` (mobile-responsive breadcrumb bar). The `UnifiedHeader` in `(console)/layout.tsx` is also replaced — the console layout should render GlassTopBar directly instead.

```
Styles:
  background: var(--console-topbar)
  backdrop-filter: blur(16px)
  border-bottom: 1px solid rgba(255,255,255,0.5)
  height: 48px

Contents (left to right):
  - "铭润" text (14px, bold) + "Console" badge
  - [spacer]
  - ⌘K shortcut indicator
  - Language toggle (EN/中文)
  - User avatar icon
```

### 2.6 GlassStatusBar

Fixed bottom status bar.

```
Styles:
  background: rgba(255,255,255,0.3)
  backdrop-filter: blur(12px)
  border-top: 1px solid rgba(255,255,255,0.4)
  height: 28px

Contents:
  - Left: green dot + current project name
  - Right: version number
```

---

## 3. Layout Architecture

### 3.1 Console Shell

```
┌──────────────────────────────────────────────┐
│  GlassTopBar (fixed, z-index: 5)             │
├────┬─────────────────────────────────────────┤
│    │                                         │
│ S  │        Main Content Area                │
│ i  │        (scrollable)                     │
│ d  │                                         │
│ e  │        margin-left: 56px                │
│ b  │        margin-top: 48px                 │
│ a  │        padding: 16-24px                 │
│ r  │                                         │
│    │                                         │
│56px│                                         │
├────┴─────────────────────────────────────────┤
│  GlassStatusBar (fixed, z-index: 5)         │
└──────────────────────────────────────────────┘
```

### 3.2 Sidebar Behavior

**Collapsed state** (default):
- Width: 56px, fixed left
- Background: `rgba(255,255,255,0.45)` + `blur(20px)`
- Content: Logo (铭 in gradient square) + icon-only nav items + settings icon at bottom
- Active nav item: `rgba(99,102,241,0.12)` background

**Expanded state** (hover trigger):
- Width: 260px (280px on chat page)
- `position: absolute` — overlays content, does NOT push main content
- Background: `rgba(255,255,255,0.72)` + `blur(24px)`
- `box-shadow: var(--shadow-overlay)`
- Semi-transparent overlay (`rgba(0,0,0,0.08)`) behind sidebar, click to dismiss
- Animation: slide-out 200ms ease-out
- Content varies by page context (see below)

**Expanded content — default pages**:
- Header: Logo + "铭润科技" + "Personal AI Studio"
- Full nav items with text labels (Home, Chat, Memory, Devices, Discover)
- Divider
- Projects section: title + project list (selectable)
- Settings at bottom

**Expanded content — chat page**:
- Header: Logo + "铭润科技"
- Compact nav icons (horizontal row)
- "New Chat" primary button
- Search conversations input
- Conversation list grouped by date (Today, Yesterday, This Week, Earlier)
- Each conversation: name + preview text, selected state highlighted

### 3.3 Chat Sidebar UX Tradeoff

The current chat page has an always-visible `ConversationSidebar` (resizable panel). The new design merges this into the sidebar overlay, meaning users must hover/click the sidebar to access conversations. **This is an intentional tradeoff**: the full-width chat area provides a more immersive conversation experience (similar to ChatGPT), and conversation switching is a less frequent action than reading/typing messages. The sidebar overlay provides the same functionality (search, create, delete, date grouping) — it just requires one extra interaction to access.

### 3.4 Removing the Project Selector

The standalone project selector card (top-right corner of dashboard) is removed. Project selection is now exclusively handled through the sidebar expanded state, which shows the project list. This applies to all pages.

---

## 4. Page Designs

### 4.1 Dashboard (/app)

**Layout**: Three-column grid (240px | 1fr | 240px)

**Elements preserved** (1:1 from current):
- Breadcrumb: "仪表盘" / "Dashboard"
- Page description text
- "我的 AI / 发现" tab switcher (glass pill style)
- Left column: "所有项目与模型" — project cards with name, chat mode badge, model slot count, first 2 model names
- Center column: "实时概要" — selected project name, chat mode, "进入助手" + "开始聊天" buttons, 3 stat cards (已配置模型槽位 / 实时项目 / 最近对话), all 7 model slots (大脑 / 实时主模型 / 实时听写 / 实时朗读 / 视觉 / 听写 / 朗读)
- Right column: "最近对话" — conversation list with name, project name, timestamp
- Status bar

**Elements removed**:
- Project selector card (top-right) — moved to sidebar

**Visual changes**:
- All panels use GlassCard
- Model slots have colored dot indicators per type
- Stat cards use GlassCard with subtle inner background
- Tab switcher: glass pill with gradient active state

### 4.2 Chat (/app/chat)

**Layout**: Full-width chat area (no split panel)

The current `PanelLayout` with resizable ConversationSidebar + ChatInterface is replaced by a single full-width chat view. Conversation management moves to the sidebar overlay.

**Chat header bar**: GlassTopBar-style bar below the main top bar
- Left: conversation name + message count
- Right: mode switcher (segmented control — Standard / Realtime / Synthetic)

**Message area**: Centered, max-width constrained (60-65% per message)
- User messages: `var(--primary-gradient)` background, white text, right-aligned, `border-radius: 18px 18px 6px 18px`, `box-shadow: 0 4px 16px rgba(99,102,241,0.2)`
- AI messages: GlassCard background, left-aligned with 铭 logo avatar (28px gradient square), `border-radius: 18px 18px 18px 6px`
- Typing indicator: 3 dots with staggered opacity animation
- Reasoning content: collapsible section within AI message (preserved from current)
- Memory extraction indicator: preserved from current
- Read-aloud button: preserved from current
- AnimatedMessageText: preserved from current (character-by-character animation)

**Input area**: Fixed bottom
- Tool chips row above input: Search (auto/on/off), Deep Think (auto/on/off), Auto-Read toggle
- Input bar: GlassCard style, rounded (16px), contains:
  - Attachment button (paperclip icon)
  - Text input
  - Microphone button
  - Send button (gradient, circular)

**Preserved functionality**:
- All three chat modes (standard, omni_realtime, synthetic_realtime)
- SSE streaming with stop generation
- Image upload and processing
- Voice input/output (StandardVoiceControls, RealtimeVoicePanel)
- Message history loading
- Auto-scroll to bottom
- Conversation CRUD (create, delete via sidebar)

### 4.3 Assistants List (/app/assistants)

**Layout**: 4-column card grid

- First card: "Create New" with dashed border (`2px dashed rgba(99,102,241,0.25)`), plus icon, centered text
- Assistant cards: GlassCard with gradient icon avatar, name, model name, description preview
- Metadata parsing preserved: `[model:...]`, `[personality:...]`, `[tags:...]`, `[color:...]` extracted from description

### 4.4 Assistant Detail (/app/assistants/[id])

**Layout**: Hero card + tabs + 2-column content

**Hero card** (GlassCard, full-width):
- Left: gradient icon avatar (72px)
- Center: name + "Active" badge + description + "Start Chat" (primary) + "Settings" (secondary) buttons
- Right: 3 stat mini-cards (Created date, Chats count, Knowledge count)

**Tabs**: Overview / Personality / Knowledge / Models (underline indicator style)

**Overview tab** (2-column grid):
- Left: Personality card — custom label + system prompt text
- Right: Model Pipeline card — capability tags (Text/Listen/Speak/Read) + model slot rows (type dot + slot name + model name + Change action)
- Full-width: Knowledge Base card — file list or empty state with upload CTA

**All current functionality preserved**: edit personality, change models, manage knowledge, navigate to chat

### 4.5 Discover (/app/discover)

**Layout**: 2-column (200px filter rail | 1fr model grid)

**Filter rail** (GlassCard):
- Tabs: All / Packs / Models
- Category list: All Categories, Chat/LLM, Vision, ASR/Speech, TTS/Voice, Realtime, Embedding
- Active category: `rgba(99,102,241,0.08)` background

**Search bar**: GlassInput with search icon, above the grid

**Model grid**: 3-column, GlassCard per model
- Provider logo (24px gradient square with initial) + provider name
- Model display name
- Description (2-line clamp)
- Category/capability tags (colored per type)
- "View Details" link

**Preserved**: search functionality, picker mode for model configuration, loading skeletons, empty states

### 4.6 Settings (/app/settings)

**Layout**: Single column, max-width 640px

Sections (each a GlassCard):
1. **Account**: Email + Display Name (read-only display)
2. **Language**: EN / 中文 toggle buttons (active = gradient)
3. **Developer Mode**: Label + description + toggle switch
4. **Subscription**: Current plan badge (Free) + quota info
5. **Danger Zone**: Red-tinted GlassCard (`rgba(239,68,68,0.04)` bg, red border), Logout + Delete Account buttons

### 4.7 Memory (/app/memory)

**Layout**: 2-column grid

- Left: Knowledge Files — upload button + file list (icon, name, size, index status indicator)
- Right: Memory Graph — expand link + graph visualization preview (nodes + edges)

**Preserved**: file upload, indexing status, memory roots, graph visualization (d3-based)

---

## 5. Animation System

### 5.1 Page Transitions

Replace current fade+scale with richer transitions using framer-motion (already in dependencies):

- **Page enter**: fade in (0→1, 200ms) + slide up (12px→0, 250ms ease-out) + blur (4px→0, 200ms)
- **Page exit**: fade out + slide down (reverse)
- **Staggered children**: Cards and list items enter with 50ms stagger delay

### 5.2 Sidebar Animation

- **Expand**: slide from left (0→260px), 200ms ease-out
- **Overlay**: fade in (0→0.08 opacity), 150ms
- **Collapse**: slide to left, 180ms ease-in

### 5.3 Micro-interactions

- **Card hover**: translate Y -2px + shadow lift, 150ms
- **Button hover**: brightness increase (1→1.05), 100ms
- **Nav item hover**: background fade in, 100ms
- **Toggle switch**: spring animation (framer-motion)
- **Typing indicator**: 3 dots with staggered opacity pulse (0.4→0.8), 600ms infinite, 200ms delay between dots

### 5.4 Chat Message Animations

- **New message appear**: slide up (8px→0) + fade in, 200ms
- **Streaming text**: character-by-character reveal (existing AnimatedMessageText preserved)
- **Send message**: user bubble scales from 0.95→1 + fades in, 150ms

---

## 6. Component Refactoring Plan

### 6.1 New Components to Create

| Component | File | Purpose |
|-----------|------|---------|
| GlassCard | `components/console/glass/GlassCard.tsx` | Standard glass container |
| GlassPanel | `components/console/glass/GlassPanel.tsx` | Structural panels |
| GlassButton | `components/console/glass/GlassButton.tsx` | 3-variant button |
| GlassInput | `components/console/glass/GlassInput.tsx` | Text input |
| GlassTopBar | `components/console/glass/GlassTopBar.tsx` | Top navigation bar |
| GlassStatusBar | `components/console/glass/GlassStatusBar.tsx` | Bottom status bar |
| AmbientBackground | `components/console/glass/AmbientBackground.tsx` | Gradient + blurred blobs |

### 6.2 Components to Refactor

| Current | Change |
|---------|--------|
| `ConsoleShell.tsx` | Replace layout structure; use GlassTopBar, new sidebar overlay logic |
| `Sidebar.tsx` | Add overlay expand mode; on chat page, render conversation list |
| `app/chat/ConversationSidebar.tsx` (page-level, NOT in components/) | Merge into Sidebar expanded state (chat page context); lift relevant logic to shared Sidebar component |
| `ChatInterface.tsx` (855 lines) | Split into: ChatHeader, ChatMessages sub-components; refactor existing ChatInputBar; remove panel layout dependency |
| `ConsolePrimitives.tsx` | Keep as compatibility layer initially; migrate pages to Glass components |
| `InlineTopBar.tsx` | Replace with GlassTopBar |
| `PanelLayout.tsx` | Remove from chat page (no longer split panel) |
| `ConsoleTopBar.tsx` | Merge into GlassTopBar |
| `PageTransition.tsx` | Update animation values (add blur, slide-up, stagger) |
| `StatusBar.tsx` | Replace with GlassStatusBar |

### 6.3 ChatInterface Split

The current 855-line ChatInterface.tsx will be split:

```
ChatInterface.tsx (orchestrator, ~200 lines)
├── ChatHeader.tsx (~80 lines) — mode switcher, conversation info
├── ChatMessages.tsx (~250 lines) — message list rendering, streaming display
├── (existing) ChatInputBar.tsx — REFACTORED, not replaced; update styling to glass, keep all existing logic
│     (already handles: tool chips, image upload, dictation input, submit)
└── (existing) ChatMessageList.tsx — individual message rendering
    (existing) RealtimeVoicePanel.tsx — realtime voice UI
    (existing) StandardVoiceControls.tsx — standard mode voice
```

All state management and API integration logic stays in ChatInterface.tsx (the orchestrator). Sub-components receive props.

**Note**: `ChatInputBar.tsx` already exists and handles tool chips, image upload/capture, dictation, and submit. It is restyled in place, not replaced with a new component.

---

## 7. CSS Architecture

### 7.1 Theme Token Migration

Replace `[data-theme="console"]` tokens in `globals.css`:

```css
[data-theme="console"] {
  /* Background */
  --console-bg: linear-gradient(135deg, #e8f0fe 0%, #ede8f8 50%, #fce8e8 100%);
  --console-surface: rgba(255,255,255,0.55);
  --console-panel: rgba(255,255,255,0.4);
  --console-card: rgba(255,255,255,0.55);
  --console-border: rgba(255,255,255,0.7);

  /* Text */
  --console-text-primary: #1a1a2e;
  --console-text-secondary: #374151;
  --console-text-muted: #6b7280;
  --console-text-faint: #9ca3af;

  /* Accent */
  --console-accent: #6366f1;
  --console-accent-secondary: #8b5cf6;
  --console-accent-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);

  /* Semantic */
  --console-success: #10b981;
  --console-warning: #f59e0b;
  --console-error: #ef4444;

  /* Radii */
  --console-radius-sm: 8px;
  --console-radius-md: 12px;
  --console-radius-lg: 16px;
  --console-radius-xl: 20px;

  /* Shadows */
  --console-shadow-card: 0 2px 12px rgba(0,0,0,0.04);
  --console-shadow-raised: 0 4px 24px rgba(0,0,0,0.06);
  --console-shadow-overlay: 0 8px 32px rgba(0,0,0,0.08);
}
```

### 7.2 Backdrop Filter Fallback

For browsers without `backdrop-filter` support:
```css
@supports not (backdrop-filter: blur(1px)) {
  .glass-surface { background: rgba(255,255,255,0.9); }
  .glass-panel { background: rgba(255,255,255,0.85); }
}
```

---

## 8. Preserved Functionality Checklist

Every item below MUST work identically after the redesign:

### Navigation & Layout
- [ ] Sidebar navigation to all 6 pages
- [ ] Breadcrumb navigation
- [ ] Top bar: ⌘K command palette, language toggle, user menu
- [ ] Status bar: project name, version
- [ ] Mobile responsive: MobileTabBar, MobileNav

### Dashboard
- [ ] 我的 AI / 发现 tab switcher
- [ ] Project list with mode, slot count, model names
- [ ] Project selection (clicking a project updates center column)
- [ ] Realtime summary: stats, all 7 model slots
- [ ] 进入助手 / 开始聊天 buttons
- [ ] Recent conversations list

### Chat
- [ ] Three chat modes: standard, omni_realtime, synthetic_realtime
- [ ] Conversation CRUD (create, delete, rename)
- [ ] Message sending and receiving
- [ ] SSE streaming with stop generation
- [ ] AnimatedMessageText (character animation)
- [ ] Reasoning content display (collapsible)
- [ ] Memory extraction indicator
- [ ] Image upload and processing
- [ ] Voice input (StandardVoiceControls)
- [ ] Realtime voice (RealtimeVoicePanel)
- [ ] Read-aloud with audio caching
- [ ] Tool chips (Search, Deep Think, Auto-Read)
- [ ] Live external input from voice dictation
- [ ] Auto-scroll to bottom
- [ ] Conversation search

### Assistants
- [ ] Assistant list with card grid
- [ ] Create new assistant
- [ ] Assistant detail: personality, model config, knowledge
- [ ] Edit personality
- [ ] Change model slots
- [ ] Upload/manage knowledge files
- [ ] Start chat from assistant

### Discover
- [ ] Model catalog browsing
- [ ] Category filtering (All, Packs, Models tabs + category list)
- [ ] Search functionality
- [ ] Model detail pages
- [ ] Picker mode for model selection in configuration

### Settings
- [ ] Account info display
- [ ] Language switching (EN/中文)
- [ ] Developer mode toggle
- [ ] Subscription info
- [ ] Logout
- [ ] Delete account

### Memory
- [ ] Knowledge file list
- [ ] File upload
- [ ] Index status indicators
- [ ] Memory graph visualization
- [ ] Memory roots management

### i18n
- [ ] All existing translation keys in console.json and console-chat.json still used
- [ ] New UI text added to both en/ and zh/ message files

---

## 9. Scope Boundaries

### 9.1 Dark Mode

Dark mode is **out of scope** for this phase. The entire design is light-mode only. A dark glassmorphism variant may be added in a future iteration.

### 9.2 Mobile Navigation

`MobileTabBar.tsx` and `UnifiedMobileNav.tsx` must be restyled to match the glassmorphism theme. They should use the same glass background, blue-purple accent color, and updated typography. The mobile layout behavior (bottom tab bar, hamburger menu drawer) remains the same — only visual styling changes.

### 9.3 Surviving Components

The following existing components are NOT being rewritten but MUST be restyled to match the glass theme:
- `CommandPalette.tsx` — update overlay and input styling to glass
- `Breadcrumb.tsx` — update text colors to new palette
- `ChatModePanel.tsx` — update to glass segmented control
- `ModelPickerModal.tsx` — update modal/overlay to glass style
- `MobileTabBar.tsx` — glass background, new accent colors
- `UnifiedMobileNav.tsx` — glass drawer background

Components that remain untouched (no visual changes needed):
- `RealtimeVoicePanel.tsx` — already self-contained, restyle only colors
- `StandardVoiceControls.tsx` — minimal UI, restyle colors only

### 9.4 PanelLayout Usage

`PanelLayout.tsx` (react-resizable-panels) is currently used only by the chat page. After this redesign, it is no longer used by any page and can be removed. If future pages need resizable panels, it can be re-added.

### 9.5 Dashboard Page Implementation

The current dashboard uses `ConsoleRailList`, `ConsoleSectionBlock`, `ConsoleInspectorPanel`, and `ConsolePageHeader` from `ConsolePrimitives.tsx`. The dashboard page will be rewritten to use the new Glass components directly (GlassCard for each column panel). `ConsolePrimitives.tsx` is kept temporarily for any other pages that may reference it, but the dashboard no longer depends on it.

### 9.6 Accessibility

Glass surfaces with low-opacity backgrounds can create contrast issues. During Phase 4 (Polish), verify:
- Text contrast on glass surfaces meets WCAG AA 4.5:1 for normal text
- Especially `--console-text-muted` (#6b7280) on glass over the pastel gradient
- If contrast fails, increase glass surface opacity or darken muted text

### 9.7 Performance

Multiple stacked `backdrop-filter: blur()` layers can cause frame drops. Guidelines:
- Maximum 3 simultaneous blur layers visible at once (topbar + sidebar + one card layer)
- On mobile, reduce blur radius to 8-12px (vs 16-20px on desktop)
- Apply `will-change: transform` to animated elements (sidebar slide, card hover, page transitions)
- The `@supports` fallback (Section 7.2) removes blur entirely for unsupported browsers

---

## 10. Migration Strategy

### Phase 1: Foundation
1. Add Sora and Noto Sans SC to layout via `next/font/google` (DM Sans and JetBrains Mono already loaded)
2. Create Glass primitive components (`components/console/glass/`)
3. Update CSS theme tokens in `globals.css`
4. Add AmbientBackground component

### Phase 2: Shell & Navigation
5. Refactor ConsoleShell to new layout (GlassTopBar + sidebar + GlassStatusBar)
6. Implement sidebar overlay expand behavior
7. Merge ConversationSidebar (`app/chat/ConversationSidebar.tsx`) into sidebar (chat page context)
8. Remove InlineTopBar, ConsoleTopBar, and UnifiedHeader from console; replace with GlassTopBar
9. Update PageTransition animations

### Phase 3: Pages
10. Dashboard — apply Glass components, remove project selector card
11. Chat — split ChatInterface, apply full-width layout, glass message styling
12. Assistants list — glass card grid
13. Assistant detail — glass hero card + tabs + content
14. Discover — glass filter rail + model grid
15. Settings — glass form sections
16. Memory — glass panels

### Phase 3.5: Surviving Components
17. Restyle CommandPalette, Breadcrumb, ChatModePanel, ModelPickerModal to glass theme
18. Restyle MobileTabBar and UnifiedMobileNav to glass theme
19. Update shadcn/ui bridge variables (--primary, --ring, etc.) to new indigo accent

### Phase 4: Polish
20. Verify all functionality from checklist (Section 8)
21. Test mobile responsiveness
22. Test backdrop-filter fallback
23. Verify text contrast on glass surfaces (WCAG AA 4.5:1)
24. Run existing test suite (chat-realtime-voice.spec.ts, console-shell.spec.ts)
25. Performance audit: check for stacked blur layers, add will-change hints
26. Remove PanelLayout.tsx (no longer used)
