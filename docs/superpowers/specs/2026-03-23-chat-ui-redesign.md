# Chat UI Redesign - Design Spec

**Date:** 2026-03-23
**Scope:** Chat page, realtime voice panel, assistant detail page, home page

## Overview

Redesign the console's chat page layout, realtime voice floating panel, assistant detail page, and home/assistants pages. Keep the existing glassmorphic warm-brown visual style; focus on layout density, whitespace reduction, responsive behavior, and animation polish.

---

## 1. Chat Sidebar

### Layout (top to bottom)

1. **Search bar** — collapsed to icon by default, expands on click to full-width input. Filters conversation list in real-time.
2. **Project selector + New button** — horizontal row: left is a compact capsule-style dropdown for project selection, right is a square `+` icon button for creating new conversations. Both fit on one line.
3. **Conversation list** — scrollable area filling remaining height.

### Conversation item

Each item displays two rows:
- **Row 1:** Small assistant avatar circle (20px) + conversation title (single-line truncated)
- **Row 2:** Last message preview (gray, 12px, truncated) + timestamp right-aligned

### Selected state

Left 3px warm-brown vertical bar (`#C7734A`) + background `rgba(199, 115, 74, 0.08)`. Replaces the current full orange background fill.

### Context menu

Right-click or long-press on a conversation item opens a floating menu with: Rename, Delete, Pin to top.

### Scrollbar

Custom thin scrollbar: 4px width, expands to 6px on hover, warm-brown tone.

### Width and responsive behavior

- **Desktop (>= 768px):** Fixed 260px sidebar
- **Mobile (< 768px):** Sidebar becomes a left-side drawer overlay with semi-transparent backdrop. A hamburger button appears in the top-left of the main area to toggle. Selecting a conversation auto-closes the drawer.

---

## 2. Message Area

### Remove outer card container

The current white semi-transparent card wrapper (`border-radius: 24px`, `padding: 16px`) around the message area is removed. Messages render directly in the right-side space with no intermediate container.

### Padding alignment

All horizontal padding unified to **24px**:
- Message list: left/right 24px (down from ~60px)
- Top header bar: left/right 24px
- Input bar: left/right 24px

### Top header bar

- Left: title + description (smaller gray text)
- Right: chat mode dropdown selector (replaces three inline badges) + message count
- Bottom border: 1px `rgba(199, 115, 74, 0.12)`

### Chat mode selector

Replace the three side-by-side badge buttons with a single dropdown/select. Options: Standard, Omni Realtime, Synthetic Realtime. Saves horizontal space.

### Message bubbles

- **Max width:** 78% of container (up from ~60%)
- **User messages:** Right-aligned, warm-brown gradient bubble, border-radius 18px with bottom-right 4px
- **Assistant messages:** Remove bordered bubble. Replace with left 3px warm-brown vertical bar + white/very-light background card, no border. Assistant logo circle (24px) on the left, shown only on the first message in a consecutive group.
- **Same-role spacing:** 6px between consecutive same-role messages
- **Cross-role spacing:** 20px between role switches
- **Read-aloud button:** Move from below the message to the top-right corner, fades in on hover

### Input bar

Redesign to ChatGPT-style integrated input:
- Multi-line auto-expanding textarea
- Tool buttons (mic, camera, search, deep think, attachment) inside the textarea at the bottom
- Send button on the right side of the textarea, gray when empty, warm-brown gradient + micro-bounce animation when content exists
- No top border line; use a subtle upward box-shadow for separation
- Left/right padding matches message list (24px)

---

## 3. Realtime Voice Floating Panel

### Color scheme

Replace the current cold dark-blue (`#1a1a2e`) with warm dark tones:
- Background: `#1C1410`
- Border: `rgba(232, 146, 90, 0.25)`
- Accent/glow: `#C7734A` to `#E8925A` amber gradient

### Collapsed state (capsule)

Position: fixed bottom-right (24px inset).

Content: status dot + "AI 助手" label + timer + 3-bar mini waveform + expand button (`━`).

- Status dot colors: active = amber breathing pulse, connecting = amber blink, muted = gray
- Mini waveform: 3 thin bars, real-time audio-driven height
- Border-radius: 999px (full pill)

### Expanded state (card)

Expands upward from the capsule position. Width: 360px, border-radius: 20px.

Sections (top to bottom):
1. **Title bar:** Status dot + "AI 助手" + timer + collapse button
2. **Waveform visualization:** 8 vertical bars, amber gradient (`#C7734A` → `#E8925A`), height driven by audio input, `transition: height 80ms ease`, updates every 100ms
3. **Transcript area:** Shows last 2 messages (user speech transcription + assistant status). Older messages scroll up and fade out.
4. **Control buttons:** Three circular buttons (48px) — Microphone, Hang up, Speaker
   - Default button background: `rgba(232, 146, 90, 0.15)`
   - Hang up button: solid `#E8925A`, hover adds glow `box-shadow: 0 0 20px rgba(232, 146, 90, 0.4)`
   - Muted mic: strikethrough icon + darkened background

### Synthetic realtime extras

When in synthetic realtime mode, an additional row appears below the controls: image/video attachment thumbnails bar.

### Animations

- **Expand/collapse:** `transform: scale` + `opacity`, 300ms, `cubic-bezier(0.34, 1.56, 0.64, 1)` spring curve
- **Panel entrance:** `translateY(20px)` fade-in spring from bottom-right
- **Status dot breathing:** `@keyframes pulse` 2s loop, `opacity 0.4 → 1` + `scale 0.85 → 1.15`
- **Waveform bars:** `transition: height 80ms ease`, updated every 100ms from audio data
- **Hang up glow:** `box-shadow` transition on hover, 200ms ease

---

## 4. Assistant Detail Page

### Layout change: 3-column → 2-column

Replace `280px | 1fr | 220px` with `minmax(280px, 1fr) | minmax(320px, 1.5fr)`.

Responsive: < 768px stacks to single column.

### Hero header (compact)

Single horizontal bar containing:
- Avatar + Name + Active badge
- Description text
- Action buttons (Start Chat, Settings, Delete) right-aligned
- Stats inline below description: `对话 1 · 知识 2 · 创建于 2026-03-22` — small gray text, dot-separated

Removes the separate right-column Activity and Created cards entirely.

### Left column: Personality + Knowledge

Personality card on top, Knowledge card below, separated by a thin divider (no gap). Both share one container.

- **Personality:** section header with Edit link, description text, tags
- **Knowledge:** section header with Manage link, file list with filename + size

### Right column: Model Configuration

Keeps the mode tab switcher (Standard / Omni / Synthetic) and model slot rows. Rows made more compact — remove extra vertical padding and helper text empty lines.

---

## 5. Home Page + My AI Merge

### Remove `/app/assistants` list route

The standalone assistants list page at `/app/assistants` is removed. Its functionality merges into the home page `/app`. The detail page `/app/assistants/[id]` remains.

### New home page layout

Vertical flow, no multi-column split:

1. **Page header:** "我的 AI 助手" title + description + "创建新助手" button (top-right)

2. **Assistant card grid:** `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`, gap 16px.
   - Each card: avatar + name + primary model name + model slot count + conversation count + bottom action row (Start Chat, Settings)
   - Hover: `translateY(-2px)` + shadow deepens
   - Last card: dashed-border "Create New" card with `+` icon, links to `/app/assistants/new`

3. **Recent conversations section:** Below the card grid. Compact list rows: conversation title + assistant name + relative timestamp + delete button. Max 5 items shown.

### Navigation adjustment

- Sidebar Home icon → merged home page
- First-time console entry → merged home page
- Sidebar expanded state project list still links to `/app/assistants/[id]` detail pages

---

## 6. Shared Design Tokens

All changes use existing CSS variable system. Key values:

| Token | Value |
|-------|-------|
| Primary accent | `#C7734A` |
| Accent gradient | `linear-gradient(135deg, #C7734A, #E8925A)` |
| Voice panel bg | `#1C1410` |
| Voice panel border | `rgba(232, 146, 90, 0.25)` |
| Voice glow | `0 0 20px rgba(232, 146, 90, 0.4)` |
| Active indicator bar | 3px solid `#C7734A` |
| Selection bg | `rgba(199, 115, 74, 0.08)` |
| Divider | `rgba(199, 115, 74, 0.12)` |
| Glass surface | `rgba(255, 255, 255, 0.72)` with `backdrop-filter: blur(18px)` |

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `apps/web/app/[locale]/(console)/app/page.tsx` | Rewrite: merge assistants list, new card grid layout |
| `apps/web/app/[locale]/(console)/app/chat/page.tsx` | Sidebar restructure, remove outer card wrapper |
| `apps/web/app/[locale]/(console)/app/assistants/page.tsx` | Remove or redirect to `/app` |
| `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx` | 2-column layout, compact hero, inline stats |
| `apps/web/components/console/ChatInterface.tsx` | Mode selector dropdown, message padding, input bar redesign |
| `apps/web/components/console/ChatInputBar.tsx` | Integrated textarea with inline tool buttons |
| `apps/web/components/console/ChatMessageList.tsx` | Bubble max-width, assistant left-bar style, spacing |
| `apps/web/components/console/ChatModePanel.tsx` | Convert to dropdown selector |
| `apps/web/components/console/RealtimeVoicePanel.tsx` | Full rewrite: collapsible card, warm colors, animations |
| `apps/web/components/console/StandardVoiceControls.tsx` | Style alignment with new voice panel theme |
| `apps/web/components/console/Sidebar.tsx` | Update nav: remove assistants list link, adjust home target |
| `apps/web/styles/globals.css` | New/updated CSS classes for all redesigned components |
| `apps/web/messages/zh/console-chat.json` | Add new i18n keys (search placeholder, context menu labels) |
| `apps/web/messages/en/console-chat.json` | Add new i18n keys |
