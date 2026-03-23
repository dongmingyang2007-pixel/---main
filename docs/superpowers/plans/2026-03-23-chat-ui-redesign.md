# Chat UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat page sidebar, message area, voice panel, assistant detail page, and home page to reduce whitespace, improve information density, and add polish animations — while keeping the existing glassmorphic warm-brown style.

**Architecture:** Pure frontend changes across React components and CSS. No backend/API changes.

**Task dependencies:**
- **Tasks 1-2** (CSS + i18n) must complete first — all other tasks depend on them
- **Tasks 3-8** can run in parallel after Tasks 1-2 (they modify different files)
- **Task 9** (home page merge) should run after Task 8 (assistant detail) since they share context
- **Task 10** (navigation + verification) runs last

**Tech Stack:** Next.js App Router, React 18, CSS (globals.css), next-intl i18n

**Spec:** `docs/superpowers/specs/2026-03-23-chat-ui-redesign.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/web/styles/globals.css` | All CSS classes for redesigned components |
| `apps/web/app/[locale]/(console)/app/chat/page.tsx` (628 lines) | Chat sidebar: search, project selector, conversation list, responsive drawer |
| `apps/web/components/console/ChatInterface.tsx` (868 lines) | Chat layout wrapper, header bar, mode selector integration |
| `apps/web/components/console/ChatInputBar.tsx` (251 lines) | Textarea input with inline tool buttons |
| `apps/web/components/console/ChatMessageList.tsx` (809 lines) | Message bubbles, spacing, read-aloud positioning |
| `apps/web/components/console/ChatModePanel.tsx` (56 lines) | Mode dropdown selector |
| `apps/web/components/console/RealtimeVoicePanel.tsx` (390 lines) | Collapsible voice card with warm colors and animations |
| `apps/web/components/console/StandardVoiceControls.tsx` (110 lines) | Inline voice controls styling |
| `apps/web/app/[locale]/(console)/app/page.tsx` (493 lines) | Merged home page with assistant card grid |
| `apps/web/app/[locale]/(console)/app/assistants/page.tsx` (229 lines) | Redirect to `/app` |
| `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx` (1,292 lines) | 2-column layout, compact hero |
| `apps/web/components/console/Sidebar.tsx` (310 lines) | Nav link adjustments |
| `apps/web/components/console/MobileTabBar.tsx` (44 lines) | Verify nav links |
| `apps/web/messages/{en,zh}/console-chat.json` | New i18n keys for chat |
| `apps/web/messages/{en,zh}/console.json` | New i18n keys for home page |

---

### Task 1: CSS Foundation — New and Updated Styles

**Files:**
- Modify: `apps/web/styles/globals.css`

This task adds all new CSS classes and updates existing ones. Must complete before other tasks.

- [ ] **Step 1: Add voice panel CSS variables and keyframe animations**

In `globals.css`, find the existing `:root` or CSS variable block. Add these new tokens and keyframes at the end of the existing console theme section:

```css
/* ── Voice Panel Warm Theme ── */
--voice-bg: #1C1410;
--voice-border: rgba(232, 146, 90, 0.25);
--voice-accent: #E8925A;
--voice-accent-deep: #C7734A;
--voice-glow: 0 0 20px rgba(232, 146, 90, 0.4);
--voice-muted: #64748b;
--voice-error: #DC6B4A;

@keyframes rt-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}
@keyframes rt-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

- [ ] **Step 2: Update chat sidebar CSS classes**

Find the existing `.chat-sidebar` related classes. Replace the sidebar item styles with:

```css
/* ── Chat Sidebar Redesign ── */
.chat-sidebar { width: 260px; }

.chat-sidebar-search {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.6);
  font-size: 13px; color: var(--console-text-secondary);
  transition: border-color 200ms ease;
}
.chat-sidebar-search:focus-within {
  border-color: var(--accent, #C7734A);
}
.chat-sidebar-search-icon {
  width: 16px; height: 16px; opacity: 0.5; flex-shrink: 0; cursor: pointer;
}
.chat-sidebar-search input {
  border: none; background: transparent; outline: none;
  flex: 1; font-size: 13px; color: var(--console-text-primary);
  min-width: 0;
}

.chat-sidebar-header-row {
  display: flex; gap: 8px; align-items: center;
}
.chat-sidebar-header-row select {
  flex: 1; min-width: 0;
  padding: 8px 10px; border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.10);
  background: rgba(255, 255, 255, 0.85);
  font-size: 13px; font-weight: 600;
}
.chat-sidebar-new-btn {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #C7734A, #E8925A);
  color: #fff; font-size: 18px; font-weight: 700;
  transition: opacity 150ms ease;
}
.chat-sidebar-new-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.chat-sidebar-item {
  position: relative; display: grid; gap: 4px;
  padding: 10px 12px 10px 15px;
  border-radius: 12px; border: none;
  background: transparent; text-align: left; cursor: pointer;
  transition: background 150ms ease;
}
.chat-sidebar-item:hover { background: rgba(15, 23, 42, 0.03); }
.chat-sidebar-item.is-active {
  background: rgba(199, 115, 74, 0.08);
}
.chat-sidebar-item.is-active::before {
  content: ''; position: absolute; left: 0; top: 8px; bottom: 8px;
  width: 3px; border-radius: 2px; background: #C7734A;
}
.chat-sidebar-item-row1 {
  display: flex; align-items: center; gap: 8px;
}
.chat-sidebar-item-avatar {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #C7734A, #E8925A);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff; font-weight: 700;
}
.chat-sidebar-item-title {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 600;
  color: var(--console-text-primary); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.chat-sidebar-item-row2 {
  display: flex; align-items: center; gap: 6px; padding-left: 28px;
}
.chat-sidebar-item-preview {
  flex: 1; min-width: 0; font-size: 12px;
  color: var(--console-text-muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.chat-sidebar-item-time {
  flex-shrink: 0; font-size: 11px; color: var(--console-text-muted);
}

/* Sidebar context menu */
.chat-sidebar-context-menu {
  position: fixed; z-index: 1000; min-width: 140px;
  padding: 4px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(12px);
}
.chat-sidebar-context-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px; border: none;
  background: transparent; width: 100%; text-align: left;
  font-size: 13px; color: var(--console-text-primary); cursor: pointer;
}
.chat-sidebar-context-item:hover { background: rgba(15, 23, 42, 0.05); }
.chat-sidebar-context-item.is-danger { color: #ef4444; }
.chat-sidebar-context-item.is-danger:hover { background: rgba(239, 68, 68, 0.08); }

/* Sidebar custom scrollbar */
.chat-sidebar-list::-webkit-scrollbar { width: 4px; }
.chat-sidebar-list::-webkit-scrollbar:hover { width: 6px; }
.chat-sidebar-list::-webkit-scrollbar-thumb {
  background: rgba(199, 115, 74, 0.25); border-radius: 4px;
}
.chat-sidebar-list::-webkit-scrollbar-track { background: transparent; }

/* Responsive drawer */
.chat-sidebar-drawer-backdrop {
  display: none; position: fixed; inset: 0; z-index: 900;
  background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(2px);
}
.chat-sidebar-hamburger {
  display: none; width: 36px; height: 36px;
  align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.72); cursor: pointer;
}
@media (max-width: 767px) {
  .chat-page { grid-template-columns: 1fr !important; }
  .chat-sidebar {
    position: fixed; left: 0; top: 0; bottom: 0; z-index: 950;
    transform: translateX(-100%);
    transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    width: 280px !important;
  }
  .chat-sidebar.is-open { transform: translateX(0); }
  .chat-sidebar-drawer-backdrop.is-open { display: block; }
  .chat-sidebar-hamburger { display: flex; }
}
```

- [ ] **Step 3: Update message area CSS**

Find the existing `.chat-message`, `.chat-bubble`, `.chat-input-bar` classes. Update:

```css
/* ── Message Area Whitespace Fix ── */
.chat-messages {
  padding: 16px 24px;
}
.chat-message { margin-bottom: 6px; }
.chat-message.is-user + .chat-message.is-assistant,
.chat-message.is-assistant + .chat-message.is-user {
  margin-top: 20px;
}
.chat-bubble { max-width: 78%; }
.chat-message.is-assistant .chat-bubble {
  background: rgba(255, 255, 255, 0.85);
  border: none;
  border-left: 3px solid #C7734A;
  border-radius: 2px 16px 16px 2px;
}
.chat-message.is-user .chat-bubble {
  border-radius: 18px 18px 4px 18px;
}

/* Message wrapper for hover actions */
.chat-message-wrapper { position: relative; }
.chat-message-hover-actions {
  position: absolute; top: 4px; right: 4px;
  opacity: 0; transition: opacity 150ms ease;
}
.chat-message-wrapper:hover .chat-message-hover-actions { opacity: 1; }

/* ── Input Bar Redesign ── */
.chat-input-bar {
  padding: 12px 24px 16px;
  border-top: none;
  box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.04);
}
.chat-input-container {
  display: flex; flex-direction: column;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 16px; background: rgba(255, 255, 255, 0.9);
  transition: border-color 200ms ease, box-shadow 200ms ease;
  overflow: hidden;
}
.chat-input-container:focus-within {
  border-color: var(--accent, #C7734A);
  box-shadow: 0 0 0 2px rgba(199, 115, 74, 0.12);
}
.chat-input-textarea {
  border: none; background: transparent; outline: none; resize: none;
  padding: 12px 14px 8px; font-size: 14px; line-height: 1.5;
  color: var(--console-text-primary);
  max-height: 160px; min-height: 42px;
}
.chat-input-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px 8px;
}
.chat-input-send {
  margin-left: auto; width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: none; cursor: pointer;
  background: rgba(15, 23, 42, 0.06); color: var(--console-text-muted);
  transition: background 200ms ease, transform 150ms ease;
}
.chat-input-send.has-content {
  background: linear-gradient(135deg, #C7734A, #E8925A);
  color: #fff;
}
.chat-input-send.has-content:active { transform: scale(0.92); }

/* ── Chat Mode Dropdown ── */
.chat-mode-dropdown {
  padding: 6px 10px; border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(255, 255, 255, 0.8);
  font-size: 12px; font-weight: 600;
  color: var(--console-text-primary);
  cursor: pointer;
}
```

- [ ] **Step 4: Add voice panel CSS**

Find the existing `.rt-*` classes section. Replace with new warm-theme classes:

```css
/* ── Realtime Voice Panel — Warm Theme ── */
.rt-float { position: fixed; bottom: 24px; right: 24px; z-index: 800; }

.rt-capsule {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 999px;
  background: var(--voice-bg, #1C1410);
  border: 1px solid var(--voice-border);
  color: #fff; cursor: default;
  animation: rt-entrance 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes rt-entrance {
  from { opacity: 0; transform: translateY(20px) scale(0.9); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.rt-status-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.rt-status-dot.is-listening {
  background: var(--voice-accent); animation: rt-pulse 2s ease-in-out infinite;
}
.rt-status-dot.is-speaking { background: var(--voice-accent-deep); }
.rt-status-dot.is-connecting { background: var(--voice-accent); animation: rt-blink 1s ease-in-out infinite; }
.rt-status-dot.is-muted { background: var(--voice-muted); }
.rt-status-dot.is-error { background: var(--voice-error); }

.rt-capsule-label { font-size: 13px; font-weight: 600; }
.rt-capsule-timer { font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.rt-capsule-expand {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(255, 255, 255, 0.1); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; transition: background 150ms ease;
}
.rt-capsule-expand:hover { background: rgba(255, 255, 255, 0.2); }

/* Waveform */
.rt-waveform { display: flex; align-items: center; gap: 2px; height: 20px; }
.rt-waveform-bar {
  width: 3px; border-radius: 2px; min-height: 4px;
  background: linear-gradient(to top, var(--voice-accent-deep), var(--voice-accent));
  transition: height 80ms ease;
}
.rt-waveform.is-large { height: 48px; gap: 4px; justify-content: center; padding: 12px 0; }
.rt-waveform.is-large .rt-waveform-bar { width: 5px; min-height: 6px; }

/* Expanded card */
.rt-card {
  position: absolute; bottom: 0; right: 0; width: 360px;
  border-radius: 20px; overflow: hidden;
  background: var(--voice-bg);
  border: 1px solid var(--voice-border);
  color: #fff;
  transform-origin: bottom right;
  animation: rt-card-in 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes rt-card-in {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}
.rt-card-header {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 16px 12px;
}
.rt-card-title { flex: 1; font-size: 14px; font-weight: 600; }
.rt-card-timer { font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.rt-card-collapse {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(255, 255, 255, 0.1); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 150ms ease;
}
.rt-card-collapse:hover { background: rgba(255, 255, 255, 0.2); }

.rt-card-transcript {
  padding: 0 16px; max-height: 80px; overflow-y: auto;
  font-size: 13px; line-height: 1.5;
}
.rt-card-transcript-line { padding: 2px 0; opacity: 0.8; }
.rt-card-transcript-line.is-user { color: var(--voice-accent); }
.rt-card-transcript-line.is-status { font-style: italic; opacity: 0.5; }

.rt-card-controls {
  display: flex; align-items: center; justify-content: center;
  gap: 20px; padding: 16px;
}
.rt-card-control-btn {
  width: 48px; height: 48px; border-radius: 50%; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(232, 146, 90, 0.15); color: #fff;
  cursor: pointer; transition: background 200ms ease;
}
.rt-card-control-btn:hover { background: rgba(232, 146, 90, 0.25); }
.rt-card-control-btn.is-muted { background: rgba(100, 116, 139, 0.3); }
.rt-card-hangup {
  width: 48px; height: 48px; border-radius: 50%; border: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--voice-accent); color: #fff; cursor: pointer;
  transition: box-shadow 200ms ease, transform 150ms ease;
}
.rt-card-hangup:hover { box-shadow: var(--voice-glow); }
.rt-card-hangup:active { transform: scale(0.92); }

.rt-card-media {
  display: flex; gap: 8px; padding: 0 16px 12px;
  overflow-x: auto;
}
```

- [ ] **Step 5: Add assistant detail and home page CSS**

```css
/* ── Assistant Detail 2-Column ── */
.assistant-detail-grid-2col {
  display: grid; grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.5fr);
  gap: 16px;
}
@media (max-width: 767px) {
  .assistant-detail-grid-2col { grid-template-columns: 1fr; }
}
.assistant-detail-hero-compact {
  display: flex; align-items: flex-start; gap: 16px;
  flex-wrap: wrap; padding: 20px;
}
.assistant-detail-hero-info { flex: 1; min-width: 200px; }
.assistant-detail-hero-stats {
  font-size: 12px; color: var(--console-text-muted);
  margin-top: 6px;
}
.assistant-detail-hero-actions {
  display: flex; gap: 8px; flex-shrink: 0;
}
.assistant-detail-combined-card {
  border-radius: 16px; overflow: hidden;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(18px);
}
.assistant-detail-combined-divider {
  height: 1px; background: rgba(15, 23, 42, 0.06); margin: 0 16px;
}

/* ── Home Page Card Grid ── */
.home-assistant-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.home-assistant-card {
  padding: 20px; border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(18px);
  transition: transform 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}
.home-assistant-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.1);
}
.home-assistant-card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.home-assistant-card-avatar {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #C7734A, #E8925A);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.home-assistant-card-name { font-size: 15px; font-weight: 700; color: var(--console-text-primary); }
.home-assistant-card-model { font-size: 12px; color: var(--console-text-muted); }
.home-assistant-card-stats {
  display: flex; gap: 12px; font-size: 12px; color: var(--console-text-muted); margin-bottom: 14px;
}
.home-assistant-card-actions { display: flex; gap: 8px; }

.home-create-card {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 10px;
  padding: 20px; border-radius: 16px; min-height: 160px;
  border: 2px dashed rgba(15, 23, 42, 0.12);
  background: transparent; color: var(--console-text-muted);
  font-size: 14px; cursor: pointer;
  transition: border-color 200ms ease, color 200ms ease;
}
.home-create-card:hover {
  border-color: var(--accent, #C7734A); color: var(--accent, #C7734A);
}
.home-create-card-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(15, 23, 42, 0.04);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
}

.home-recent-section { margin-top: 24px; }
.home-recent-heading {
  font-size: 15px; font-weight: 700;
  color: var(--console-text-primary); margin-bottom: 12px;
}
.home-recent-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  transition: background 150ms ease;
}
.home-recent-item:hover { background: rgba(15, 23, 42, 0.03); }
.home-recent-title-text {
  flex: 1; min-width: 0; font-size: 13px;
  color: var(--console-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.home-recent-project { font-size: 12px; color: var(--console-text-muted); }
.home-recent-time { font-size: 11px; color: var(--console-text-muted); flex-shrink: 0; }
```

- [ ] **Step 6: Commit CSS foundation**

```bash
git add apps/web/styles/globals.css
git commit -m "style: add CSS foundation for chat UI redesign"
```

---

### Task 2: i18n — Add New Translation Keys

**Files:**
- Modify: `apps/web/messages/zh/console-chat.json`
- Modify: `apps/web/messages/en/console-chat.json`
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Add chat i18n keys**

In `console-chat.json` (both zh and en), add these keys:

**English:**
```json
"searchPlaceholder": "Search conversations...",
"deleteConversation": "Delete",
"confirmDelete": "Are you sure you want to delete this conversation?",
"drawerOpen": "Open sidebar",
"noPreview": "No messages yet"
```

**Chinese:**
```json
"searchPlaceholder": "搜索对话...",
"deleteConversation": "删除",
"confirmDelete": "确定要删除这条对话吗？",
"drawerOpen": "打开侧边栏",
"noPreview": "暂无消息"
```

- [ ] **Step 2: Add home page i18n keys**

In `console.json` (both zh and en), add these keys:

**English:**
```json
"home.title": "My AI Assistants",
"home.description": "Create and manage your personalized AI assistants",
"home.createNew": "Create New",
"home.createCardLabel": "Create New AI Assistant",
"home.modelSlots": "{count} model slots",
"home.conversations": "{count} conversations",
"home.startChat": "Start Chat",
"home.settings": "Settings",
"home.recentTitle": "Recent Conversations",
"home.noAssistants": "No assistants yet. Create one to get started.",
"home.noRecent": "No recent conversations."
```

**Chinese:**
```json
"home.title": "我的 AI 助手",
"home.description": "创建和管理你的个性化 AI 助手",
"home.createNew": "创建新助手",
"home.createCardLabel": "创建新的 AI 助手",
"home.modelSlots": "{count} 个模型槽位",
"home.conversations": "{count} 次对话",
"home.startChat": "开始聊天",
"home.settings": "设置",
"home.recentTitle": "最近对话",
"home.noAssistants": "还没有助手，创建一个开始吧。",
"home.noRecent": "暂无最近对话。"
```

- [ ] **Step 3: Commit i18n changes**

```bash
git add apps/web/messages/
git commit -m "i18n: add translation keys for chat UI redesign"
```

---

### Task 3: Chat Sidebar Redesign

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/chat/page.tsx` (lines 437-611 sidebar JSX)

- [ ] **Step 1: Add sidebar state and search logic**

At the top of `ChatPageContent()` (around line 85), add new state:

```tsx
const [searchQuery, setSearchQuery] = useState("");
const [searchExpanded, setSearchExpanded] = useState(false);
const [drawerOpen, setDrawerOpen] = useState(false);
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conversationId: string } | null>(null);
```

Add a debounced search value and filtered conversations memo (after the existing memos):

```tsx
const deferredSearch = useDeferredValue(searchQuery);

const filteredConversations = useMemo(() => {
  if (!deferredSearch.trim()) return conversations;
  const q = deferredSearch.trim().toLowerCase();
  return conversations.filter((c) => {
    // renderConversationTitle returns string (not JSX), safe to filter
    const title = renderConversationTitle(c).toLowerCase();
    return title.includes(q);
  });
}, [conversations, deferredSearch, renderConversationTitle]);
```

Note: Import `useDeferredValue` from React at the top of the file.

- [ ] **Step 2: Add context menu handler and delete function**

Add a delete conversation handler (after handleConversationCreate). Note: add `apiDelete` to the import from `@/lib/api` (line 18).

```tsx
const handleDeleteConversation = useCallback(
  async (conversationId: string) => {
    try {
      await apiDelete(`/api/v1/chat/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        const remaining = conversations.filter((c) => c.id !== conversationId);
        const next = remaining[0]?.id ?? null;
        setActiveConversationId(next);
        replaceChatUrl(selectedProjectId, next);
      }
    } catch { /* silent */ }
    setContextMenu(null);
  },
  [activeConversationId, conversations, replaceChatUrl, selectedProjectId],
);

const handleContextMenu = useCallback(
  (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, conversationId });
  },
  [],
);
```

- [ ] **Step 3: Rewrite sidebar JSX**

Replace the entire `<aside>` block (lines 448-584) and the `chat-main` div (lines 586-600). Skeletal JSX structure:

```tsx
{/* Drawer backdrop — only visible on mobile */}
<div
  className={`chat-sidebar-drawer-backdrop${drawerOpen ? " is-open" : ""}`}
  onClick={() => setDrawerOpen(false)}
/>

<aside className={`chat-sidebar${drawerOpen ? " is-open" : ""}`}
  style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 16,
    borderRadius: 20, background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 18px 50px rgba(15,23,42,0.08)",
    backdropFilter: "blur(18px)" }}>

  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
    {/* Search bar */}
    <div className="chat-sidebar-search">
      <svg className="chat-sidebar-search-icon" onClick={() => setSearchExpanded(!searchExpanded)} .../>
      {searchExpanded && (
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")} autoFocus />
      )}
    </div>

    {/* Project selector + New button row */}
    <div className="chat-sidebar-header-row">
      <select value={selectedProjectId} onChange={handleProjectChange} ...>
        {projects.map((p) => <option key={p.id} value={p.id}>{...}</option>)}
      </select>
      <button className="chat-sidebar-new-btn" onClick={handleConversationCreate}
        disabled={!selectedProjectId || isCreatingConversation}>+</button>
    </div>
  </div>

  {/* Conversation list */}
  <div className="chat-sidebar-list" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
    {filteredConversations.map((conv) => (
      <button key={conv.id} className={`chat-sidebar-item${conv.id === activeConversationId ? " is-active" : ""}`}
        onClick={() => { handleConversationSelect(conv.id); setDrawerOpen(false); }}
        onContextMenu={(e) => handleContextMenu(e, conv.id)}>
        <div className="chat-sidebar-item-row1">
          <div className="chat-sidebar-item-avatar">{/* first letter */}</div>
          <div className="chat-sidebar-item-title">{renderConversationTitle(conv)}</div>
        </div>
        <div className="chat-sidebar-item-row2">
          <span className="chat-sidebar-item-preview">{conversationSummaries[conv.id] || t("noPreview")}</span>
          <span className="chat-sidebar-item-time">{formatRelativeTime(conv.updated_at, t)}</span>
        </div>
      </button>
    ))}
  </div>
</aside>

{/* Context menu */}
{contextMenu && (
  <div className="chat-sidebar-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
    <button className="chat-sidebar-context-item is-danger"
      onClick={() => handleDeleteConversation(contextMenu.conversationId)}>
      {t("deleteConversation")}
    </button>
  </div>
)}

{/* Main chat area — no outer card wrapper */}
<div className="chat-main" style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
  <button className="chat-sidebar-hamburger" onClick={() => setDrawerOpen(true)}>☰</button>
  <ChatInterface ... />
</div>
```

This is a skeleton — the implementer should fill in exact props, SVG icons, and disabled states from the existing code.

- [ ] **Step 4: Add click-outside handler for context menu**

Add a useEffect to close the context menu when clicking outside:

```tsx
useEffect(() => {
  if (!contextMenu) return;
  const close = () => setContextMenu(null);
  window.addEventListener("click", close);
  return () => window.removeEventListener("click", close);
}, [contextMenu]);
```

- [ ] **Step 5: Verify and commit**

Run `npm run build` in `apps/web` to check for TypeScript errors.

```bash
cd apps/web && npm run build
git add apps/web/app/[locale]/(console)/app/chat/page.tsx
git commit -m "feat(chat): redesign sidebar with search, compact items, context menu, responsive drawer"
```

---

### Task 4: Chat Mode Panel — Convert to Dropdown

**Files:**
- Modify: `apps/web/components/console/ChatModePanel.tsx` (56 lines, full rewrite)
- Modify: `apps/web/components/console/ChatInterface.tsx` (lines 765-790, header area)

- [ ] **Step 1: Rewrite ChatModePanel as dropdown**

Replace the entire component with a `<select>` element using `chat-mode-dropdown` class. Keep the same props interface (`mode`, `defaultMode`, `onModeChange`, `syntheticModeAvailable`).

```tsx
export function ChatModePanel({ mode, defaultMode, onModeChange, syntheticModeAvailable }: ChatModePanelProps) {
  const t = useTranslations("console-chat");
  const options = [
    { key: "standard", label: t("mode.standard") },
    { key: "omni_realtime", label: t("mode.omni") },
    { key: "synthetic_realtime", label: t("mode.synthetic") },
  ];
  return (
    <select
      className="chat-mode-dropdown"
      value={mode}
      onChange={(e) => onModeChange(e.target.value as ChatMode)}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key} disabled={o.key === "synthetic_realtime" && !syntheticModeAvailable}>
          {o.label}{o.key === defaultMode ? ` (${t("mode.default")})` : ""}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Update ChatInterface header layout**

In `ChatInterface.tsx`, find the `chat-workspace-header` div (around line 765). Restructure:
- Left side: title (`chat-workspace-kicker`) + description
- Right side: `ChatModePanel` dropdown + message count badge
- Update padding to 24px horizontal

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/ChatModePanel.tsx apps/web/components/console/ChatInterface.tsx
git commit -m "feat(chat): convert mode panel to dropdown, update header layout"
```

---

### Task 5: Chat Input Bar Redesign

**Files:**
- Modify: `apps/web/components/console/ChatInputBar.tsx` (251 lines)

- [ ] **Step 1: Replace input with textarea**

Change the `<input>` element (around line 153) to a `<textarea>`. Wrap it in a `.chat-input-container` div. Move tool chips inside the container.

Update `handleKeyDown` (lines 119-124):
```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
};
```

- [ ] **Step 2: Add auto-resize behavior**

Add a ref and resize handler:

```tsx
const textareaRef = useRef<HTMLTextAreaElement>(null);

const handleInput = useCallback(() => {
  const el = textareaRef.current;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}, []);
```

Call `handleInput()` in the onChange handler and after sending (reset to min-height).

- [ ] **Step 3: Restructure JSX layout**

New structure:
```
.chat-input-bar
  .chat-input-container
    textarea.chat-input-textarea
    .chat-input-toolbar
      [tool chips: mic, camera, search, think, attachment]
    .chat-input-send (moved inside, after toolbar at the right)
```

Move the send button inside `.chat-input-container`, using `margin-left: auto` in the toolbar row. Add `.has-content` class when text is non-empty.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/ChatInputBar.tsx
git commit -m "feat(chat): redesign input bar with auto-expanding textarea and inline tools"
```

---

### Task 6: Message List — Bubble Styles and Spacing

**Files:**
- Modify: `apps/web/components/console/ChatMessageList.tsx` (lines 640-720, message rendering)

- [ ] **Step 1: Update message bubble rendering**

In the message rendering section (around line 640), wrap each message in `.chat-message-wrapper`. For assistant messages:
- Add a 24px logo circle on the left (only for the first in a consecutive assistant group). Check if the previous message was also assistant — if so, skip the avatar.
- Remove the border from `.chat-bubble` for assistant messages (handled by CSS now).

- [ ] **Step 2: Move read-aloud button to hover overlay**

Find the `chat-message-actions` div (around line 716). Move it inside `.chat-message-wrapper` and apply `.chat-message-hover-actions` class so it appears on hover at top-right.

- [ ] **Step 3: Update message spacing**

The CSS from Task 1 handles most spacing via `.chat-message` margins. Verify the JSX doesn't have inline `marginBottom` styles that override the CSS. Remove any inline margin/padding styles on message elements.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/ChatMessageList.tsx
git commit -m "feat(chat): update message bubbles with left-bar style, hover actions, tighter spacing"
```

---

### Task 7: Realtime Voice Panel Rewrite

**Files:**
- Modify: `apps/web/components/console/RealtimeVoicePanel.tsx` (390 lines, major rewrite)

- [ ] **Step 1: Update WaveformBars to accept barCount prop**

Change the `WaveformBars` component (lines 31-51) to accept `barCount` prop (default 5):

```tsx
function WaveformBars({ levels, barCount = 5 }: { levels: number[]; barCount?: number }) {
```

Also add `is-large` class when `barCount > 5`.

- [ ] **Step 2: Add collapsed/expanded state**

Add state to the main component:
```tsx
const [expanded, setExpanded] = useState(false);
```

- [ ] **Step 3: Rewrite the panel rendering**

Replace the three-state rendering (entry/pill/panel from lines 165-355) with two states:

**State A — Not connected:** Show entry button with `rt-capsule` style (warm colors).

**State B — Connected, collapsed:** Show `rt-capsule` with status dot, label, timer, mini waveform (barCount=3), expand button.

**State C — Connected, expanded:** Show `rt-card` with:
- Header: status dot + title + timer + collapse button
- Waveform: `WaveformBars` with barCount=8 and `is-large` class
- Transcript: last 2 entries from transcriptLog
- Controls: mic, hangup, speaker buttons with new classes
- Media bar (synthetic mode only): existing media toolbar content

Use the new CSS classes from Task 1 Step 4.

- [ ] **Step 4: Update all color values**

Replace all `#1a1a2e`, `#16213e`, `#22c55e`, `#818cf8` color references with CSS variable references (`var(--voice-bg)`, `var(--voice-accent)`, etc.).

- [ ] **Step 5: Update StandardVoiceControls styling**

Modify `apps/web/components/console/StandardVoiceControls.tsx` (110 lines). Update the inline color values to match the warm theme:
- Replace any `#22c55e` (green) references with `var(--voice-accent)` for active recording state
- Replace any `#818cf8` (indigo) references with `var(--voice-accent-deep)`
- Ensure `.chat-mic-btn.is-recording` uses the amber pulse animation from the voice panel

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/console/RealtimeVoicePanel.tsx apps/web/components/console/StandardVoiceControls.tsx
git commit -m "feat(voice): rewrite realtime panel with warm theme, expandable card, animations"
```

---

### Task 8: Assistant Detail Page — 2-Column Layout

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`

This is a large file (1,292 lines). Focus changes on the layout JSX, not the logic.

- [ ] **Step 1: Restructure hero header**

Find the hero section (search for `assistant-detail-hero` or `assistant-detail-compact-header`). Replace with compact layout:
- Single row: avatar + info column (name, badge, description, stats line) + action buttons
- Stats line: conversation count, knowledge count, created date — all inline with `·` separators
- Use `.assistant-detail-hero-compact` class

- [ ] **Step 2: Replace 3-column grid with 2-column**

Find the grid layout (search for `grid-template-columns` with `280px` and `220px`). Replace with:
```tsx
className="assistant-detail-grid-2col"
```

Remove the right column entirely (Activity card and Created card — their data is now in the hero stats).

- [ ] **Step 3: Combine personality and knowledge cards**

Wrap the personality section and knowledge section in a single `.assistant-detail-combined-card` container with a `.assistant-detail-combined-divider` between them.

- [ ] **Step 4: Compact model rows**

In the model configuration section, reduce vertical padding on `.profile-model-row` elements. Remove empty helper text lines where `helperText` is empty/null.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx
git commit -m "feat(assistant): 2-column layout with compact hero and inline stats"
```

---

### Task 9: Home Page Merge + Assistants Redirect

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/page.tsx` (493 lines, major rewrite)
- Modify: `apps/web/app/[locale]/(console)/app/assistants/page.tsx` (229 lines, replace with redirect)

- [ ] **Step 1: Replace assistants list page with redirect**

Replace the entire content of `assistants/page.tsx` with a locale-aware redirect. The project uses `next-intl`, and `@/i18n/navigation` exports a locale-aware `redirect`:

```tsx
import { redirect } from "@/i18n/navigation";

export default function AssistantsPage() {
  redirect("/app");
}
```

- [ ] **Step 2: Rewrite home page**

Rewrite `app/page.tsx` to display:
1. Header: title + description + create button
2. Assistant card grid using `.home-assistant-grid` with `.home-assistant-card` items
3. Create card with `.home-create-card`
4. Recent conversations section with `.home-recent-section`

Keep the existing data fetching logic (projects, pipeline configs, recent conversations) but restructure the JSX layout. Remove the 3-column grid (`dashboard-glass-grid`) and tabs.

Use translations from `console` namespace with the `home.*` keys added in Task 2.

- [ ] **Step 3: Verify navigation flow**

Check that:
- Clicking an assistant card navigates to `/app/assistants/{id}`
- Clicking "Start Chat" navigates to `/app/chat?project_id={id}`
- Clicking "Create New" navigates to `/app/assistants/new`
- `/app/assistants` redirects to `/app`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/(console)/app/page.tsx apps/web/app/[locale]/(console)/app/assistants/page.tsx
git commit -m "feat(home): merge assistants list into home page, add redirect"
```

---

### Task 10: Navigation Cleanup + Final Verification

**Files:**
- Modify: `apps/web/components/console/Sidebar.tsx` (line 44-50, NAV_ITEMS)
- Verify: `apps/web/components/console/MobileTabBar.tsx`

- [ ] **Step 1: Verify Sidebar nav items**

Check `Sidebar.tsx` NAV_ITEMS (lines 44-50). The Home link `/app` already points to the merged home page. No changes needed unless there's a separate assistants link in the expanded sidebar project section. If the expanded sidebar links directly to `/app/assistants` (not `/app/assistants/[id]`), update it to `/app`.

- [ ] **Step 2: Verify MobileTabBar**

Check `MobileTabBar.tsx` MAIN_TABS (lines 8-14). The Home link `/app` should already be correct. Verify no tab links to `/app/assistants`.

- [ ] **Step 3: Build verification**

```bash
cd apps/web && npm run build
```

Fix any TypeScript or build errors.

- [ ] **Step 4: Run existing tests**

Run the Playwright tests that may be affected by UI changes. Selectors in these tests may need updating if CSS classes or DOM structure changed:

```bash
cd apps/web && npx playwright test tests/chat-realtime-voice.spec.ts tests/console-shell.spec.ts --reporter=list
```

Fix any failing selectors (e.g., `.rt-pill` → `.rt-capsule`, `.chat-mode-chip` → `.chat-mode-dropdown`).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: navigation cleanup and build verification for chat UI redesign"
```
