# Console Core Pages: Wizard + Profile + Chat + Memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the creation wizard (personality-first, 3 steps), assistant profile page (from Canvas Workbench to Profile), chat page (memory highlights + tool chips), and memory page (graph-first with list toggle).

**Architecture:** Reuse existing API endpoints and data patterns. Wizard reorders steps and hides model selection. Assistant profile replaces the canvas workbench tab with a consumer Profile layout. Chat adds memory highlight indicators and adaptive tool chips. Memory page wraps the existing MemoryGraph component with a new top bar and list view toggle.

**Tech Stack:** Next.js 16 App Router, React 18, D3.js (memory graph), Tailwind CSS, next-intl, clsx

**Spec:** `docs/superpowers/specs/2026-03-19-console-consumer-redesign.md`

---

### Task 1: Redesign creation wizard — personality-first, 3 steps

**Files:**
- Modify: `apps/web/components/console/wizard/WizardShell.tsx`
- Modify: `apps/web/components/console/wizard/StepPersonality.tsx` (becomes Step 1)
- Create: `apps/web/components/console/wizard/StepIdentity.tsx` (new Step 2: name + avatar)
- Modify: `apps/web/components/console/wizard/StepKnowledge.tsx` (becomes Step 3, optional)
- Delete: `apps/web/components/console/wizard/StepModel.tsx`
- Delete: `apps/web/components/console/wizard/StepFinish.tsx`
- Modify: `apps/web/styles/globals.css` (wizard CSS updates)

#### Overview

Old flow: Model → Knowledge → Personality → Finish (4 steps)
New flow: Personality → Identity (name + avatar + greeting) → Knowledge optional (3 steps)

Model selection is hidden — system auto-assigns default models (Qwen 3.5 Plus for LLM, Paraformer-v2 for ASR, CosyVoice-v1 for TTS). Users can change models later via the Discover page.

- [ ] **Step 1: Read current wizard files**

Read all files in `apps/web/components/console/wizard/` to understand current state, data flow, and API submission logic.

- [ ] **Step 2: Update WizardShell to 3 steps**

In `WizardShell.tsx`:
- Change from 4 steps to 3 steps
- Update step labels: `["性格", "命名", "知识"]`
- Update step components to render:
  - Step 0: `<StepPersonality />`
  - Step 1: `<StepIdentity />`
  - Step 2: `<StepKnowledge />`
- Remove import of `StepModel` and `StepFinish`
- Add import of `StepIdentity`
- In the submission function (`handleSubmit`):
  - Hard-code default model choices instead of reading from `data.model`:
    ```ts
    const defaultModel = { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", tier: "custom" as const };
    const defaultAsr = "paraformer-v2";
    const defaultTts = "cosyvoice-v1";
    ```
  - Use `data.name` and `data.color` from `StepIdentity` (moved from StepFinish)
  - Keep the same API submission flow (POST project → PATCH pipeline × 3 → upload files → start training)

- [ ] **Step 3: Enhance StepPersonality as Step 1**

In `StepPersonality.tsx`:
- Keep the existing 6 personality templates
- Keep the custom textarea input
- Add a section title: "你的助手是什么样的？" and subtitle: "选择一个性格模板，或者用自己的话描述"
- Make sure the "下一步" button is enabled when a template is selected OR custom text has content
- Remove skip option — personality is required in the new flow

- [ ] **Step 4: Create StepIdentity component (new Step 2)**

Create `apps/web/components/console/wizard/StepIdentity.tsx`:

This combines the name/color from old StepFinish with a new greeting/avatar section:
- **Left side:** Avatar preview circle (shows selected color + assistant icon), color picker (6 colors)
- **Right side:**
  - Name input (label: "助手名字", placeholder: "给它起个名字...", max 50 chars)
  - Greeting textarea (label: "开场白", placeholder: "助手第一次见到你时会说什么...", 3-4 rows)
- Use existing color palette from StepFinish
- Name is required, greeting is optional
- Store data as `{ name: string, color: string, greeting: string }` in wizard data

Data type update in WizardShell — add `greeting: string` to `WizardData` interface.

- [ ] **Step 5: Update StepKnowledge as optional Step 3**

In `StepKnowledge.tsx`:
- Add a prominent skip notice at top: "💡 这一步是可选的，你可以随时在助手设置中添加知识" with a "跳过，直接完成 →" link
- The skip link calls the parent's submit handler directly
- Keep existing drag-and-drop upload functionality
- The "下一步" button text changes to "完成" since this is the last step

- [ ] **Step 6: Delete StepModel.tsx and StepFinish.tsx**

```bash
rm apps/web/components/console/wizard/StepModel.tsx
rm apps/web/components/console/wizard/StepFinish.tsx
```

- [ ] **Step 7: Update wizard CSS**

In `globals.css`, find the wizard CSS section and update:
- Change progress bar from 4 dots to 3 dots
- Add `.wizard-identity-layout` for the name+avatar split layout
- Add `.wizard-skip-notice` for the knowledge step skip banner

- [ ] **Step 8: Update wizard i18n keys**

Add new keys to `apps/web/messages/zh/console-assistants.json` and `en` equivalent:
- `"wizard.step.personality"`: "性格" / "Personality"
- `"wizard.step.identity"`: "命名" / "Identity"
- `"wizard.step.knowledge"`: "知识" / "Knowledge"
- `"wizard.personality.title"`: "你的助手是什么样的？"
- `"wizard.personality.subtitle"`: "选择一个性格模板，或者用自己的话描述"
- `"wizard.identity.title"`: "给它一个名字和形象"
- `"wizard.identity.subtitle"`: "让你的助手成为独一无二的存在"
- `"wizard.identity.nameLabel"`: "助手名字"
- `"wizard.identity.greetingLabel"`: "开场白"
- `"wizard.knowledge.skipNotice"`: "这一步是可选的，你可以随时在助手设置中添加知识"
- `"wizard.knowledge.skipLink"`: "跳过，直接完成"

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: redesign creation wizard — personality-first, 3 steps, hidden model selection"
```

---

### Task 2: Rebuild assistant detail page as Profile

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console-assistants.json`
- Modify: `apps/web/messages/en/console-assistants.json`

#### Overview

Replace the current two-tab (graph + config/canvas) layout with a Profile-style page. The memory graph is no longer embedded here — it lives at `/app/memory` now.

- [ ] **Step 1: Read current assistant detail page**

Read `apps/web/app/[locale]/(console)/app/assistants/[id]/page.tsx` to understand current data loading, state, and MemoryGraph integration.

- [ ] **Step 2: Rewrite assistant detail page as Profile**

Replace the page content with a Profile layout:

**Header section:**
- Large avatar circle (88px, gradient with assistant color)
- Assistant name (large, bold)
- Personality tagline (from project description metadata)
- Meta row: created date, total conversations, total memories
- CTA buttons: "开始聊天" (primary, links to /app/chat) + "设置" (secondary)

**Tab section with 4 tabs:** 概览 / 性格 / 知识 / 模型

**Overview tab (default):** 4-card grid
- Personality card: shows template name + description excerpt, "编辑" link
- Activity card: stats (this week's conversations, new memories, usage hours)
- Model config card: shows current LLM/ASR/TTS models with "更换" links pointing to /app/discover
- Knowledge card: list of uploaded files with sizes + dates

**Other tabs:** placeholder content for now — will be detailed views of personality editing, knowledge management, and model slot configuration. These can be implemented in a future iteration.

Data loading:
- Reuse existing `GET /api/v1/projects/${id}` for project data
- Reuse existing conversation count from `GET /api/v1/chat/conversations?project_id=${id}`
- Parse personality/model info from project's `description` metadata (which is JSON-encoded by the wizard)

- [ ] **Step 3: Add Profile CSS**

Add to `globals.css` an `.assistant-profile` section:
- `.assistant-profile-header` — flex layout with avatar, info, actions
- `.assistant-profile-avatar` — 88px circle with gradient
- `.assistant-profile-tabs` — tab bar with underline indicator
- `.assistant-profile-grid` — 2-column card grid
- `.assistant-profile-card` — card with title, content, action link

- [ ] **Step 4: Add Profile i18n keys**

Add to console-assistants.json (zh + en):
- `"profile.startChat"`: "开始聊天" / "Start chatting"
- `"profile.settings"`: "设置" / "Settings"
- `"profile.tab.overview"`: "概览" / "Overview"
- `"profile.tab.personality"`: "性格" / "Personality"
- `"profile.tab.knowledge"`: "知识" / "Knowledge"
- `"profile.tab.models"`: "模型" / "Models"
- `"profile.card.personality"`: "性格" / "Personality"
- `"profile.card.activity"`: "活跃度" / "Activity"
- `"profile.card.models"`: "模型配置" / "Model Config"
- `"profile.card.knowledge"`: "知识" / "Knowledge"
- `"profile.edit"`: "编辑" / "Edit"
- `"profile.change"`: "更换" / "Change"
- `"profile.manage"`: "管理" / "Manage"

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: rebuild assistant detail page as consumer Profile"
```

---

### Task 3: Enhance chat page — memory highlights + tool chips

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/chat/page.tsx`
- Modify: `apps/web/components/console/ChatInterface.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console-chat.json`
- Modify: `apps/web/messages/en/console-chat.json`

#### Overview

Three enhancements: date-grouped conversation list, memory highlight indicators on assistant messages, and adaptive tool chips in the input bar.

- [ ] **Step 1: Read current chat page and ChatInterface**

Read both files to understand current structure before making changes.

- [ ] **Step 2: Add date grouping to conversation list**

In the chat page (`page.tsx`), update the conversation list rendering:
- Group conversations by date: "今天" / "昨天" / "本周" / "更早"
- Add date group headers as small uppercase labels between conversation items
- Sorting logic: use `updated_at` timestamp to bucket conversations

Helper function:
```ts
function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays <= 7) return "本周";
  return "更早";
}
```

- [ ] **Step 3: Add memory highlight indicators**

In `ChatInterface.tsx`, after each assistant message bubble, add a memory indicator:

When the backend includes extracted memories in the response (future API enhancement), show a small tag below the bubble:
```html
<div class="chat-memory-indicator">
  <MemoryIcon /> 记住了：{summary}
</div>
```

For now, implement the UI component but keep it hidden (no backend support yet). Add a conditional render that checks for a `memories_extracted` field on the message response. This prepares the UI for when the backend adds memory extraction reporting.

CSS for `.chat-memory-indicator`:
- Small tag (padding 6px 12px, border-radius 8px)
- Background: `rgba(var(--accent-rgb), 0.06)`, border: `rgba(var(--accent-rgb), 0.12)`
- Font size 11px, color: accent
- Flex with icon + text
- Cursor pointer (will link to memory graph in future)

- [ ] **Step 4: Add adaptive tool chips to input bar**

In `ChatInterface.tsx`, add tool chips between the input textarea and the action buttons:

```tsx
<div className="chat-tool-chips">
  <button className="chat-tool-chip" data-state={searchState} onClick={cycleSearchState}>
    <SearchIcon /> 搜索
  </button>
  <button className="chat-tool-chip" data-state={thinkState} onClick={cycleThinkState}>
    <ThinkIcon /> 深度思考
  </button>
</div>
```

State machine for each chip: `"auto" → "on" → "off" → "auto"` (cycle on click)

CSS for `.chat-tool-chip`:
- Pill shape (padding 5px 12px, border-radius 16px, font-size 11px)
- `[data-state="auto"]`: default style, no highlight, light border
- `[data-state="on"]`: accent background, white text
- `[data-state="off"]`: text-decoration line-through, muted color

For now, tool state is UI-only — it doesn't affect the API call yet. The backend integration will be done when the tool calling system is implemented.

- [ ] **Step 5: Update chat CSS**

Add to the chat CSS section in `globals.css`:
- `.chat-date-group` — date group header in conversation list
- `.chat-memory-indicator` — memory tag below assistant messages
- `.chat-tool-chips` — chip container in input area
- `.chat-tool-chip` — individual chip with 3 data-state variants

- [ ] **Step 6: Add chat i18n keys**

Add to console-chat.json (zh + en):
- `"dateGroup.today"`: "今天" / "Today"
- `"dateGroup.yesterday"`: "昨天" / "Yesterday"
- `"dateGroup.thisWeek"`: "本周" / "This Week"
- `"dateGroup.earlier"`: "更早" / "Earlier"
- `"tool.search"`: "搜索" / "Search"
- `"tool.think"`: "深度思考" / "Deep Think"
- `"memory.remembered"`: "记住了" / "Remembered"

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: enhance chat with date groups, memory highlights, and tool chips"
```

---

### Task 4: Build memory page — graph-first with list toggle

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/memory/page.tsx`
- Create: `apps/web/components/console/MemoryListView.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

#### Overview

Replace the placeholder memory page with a full implementation. The graph is the default view (reusing existing MemoryGraph component). A list view is available via toggle. Top bar has export/import/new buttons.

- [ ] **Step 1: Read MemoryGraph component**

Read `apps/web/components/console/graph/MemoryGraph.tsx` and understand its props, how it gets data (useGraphData hook), and what project context it needs.

- [ ] **Step 2: Build the memory page**

Replace `apps/web/app/[locale]/(console)/app/memory/page.tsx`:

```
"use client"

Layout:
- Top bar: title "记忆" + count badge + view toggle (图谱/列表) + actions (导出/导入/新建)
- Content area: full height, conditionally renders MemoryGraph or MemoryListView

State:
- view: "graph" | "list" (default: "graph")
- Uses useProjectContext() to get current project ID
- Passes projectId to MemoryGraph

Top bar actions:
- Export: download memories as JSON (calls API, triggers file download)
- Import: file input that uploads a JSON memory file
- New: opens a simple modal/dialog to create a memory manually
```

The MemoryGraph component is currently used inside the assistant detail page with a conversation selector. In the new memory page, it should be used WITHOUT the conversation selector — show all memories for the project.

Check MemoryGraph's props to understand what's required. It likely needs `projectId` and possibly `conversationId` (which should be null/undefined to show all).

- [ ] **Step 3: Create MemoryListView component**

Create `apps/web/components/console/MemoryListView.tsx`:

Simple list view of memories with:
- Left panel (320px): search + filter tabs (全部/个人/知识/偏好/记忆包) + memory item list
- Right panel: detail view of selected memory (content, category, source, related memories, edit/delete buttons)

Data: reuse the same `useGraphData` hook that MemoryGraph uses, or if that's too coupled, make direct API calls to list memories.

Memory item display:
- Color dot (permanent=rust, learned=blue, pack=purple)
- Category label
- Content preview (2-line clamp)
- Timestamp

- [ ] **Step 4: Add memory page CSS**

Add to `globals.css`:
- `.memory-page` — full-height flex layout
- `.memory-topbar` — top bar with title, toggle, actions
- `.memory-view-toggle` — pill toggle for graph/list
- `.memory-action-btn` — export/import/new buttons
- `.memory-list-panel` — left panel in list view
- `.memory-list-item` — individual memory in list
- `.memory-detail-panel` — right panel detail view

- [ ] **Step 5: Add memory i18n keys**

Add to console.json (zh + en):
- `"memory.title"`: "记忆" / "Memory"
- `"memory.viewGraph"`: "图谱" / "Graph"
- `"memory.viewList"`: "列表" / "List"
- `"memory.export"`: "导出" / "Export"
- `"memory.import"`: "导入" / "Import"
- `"memory.new"`: "新建记忆" / "New Memory"
- `"memory.filterAll"`: "全部" / "All"
- `"memory.filterPersonal"`: "个人" / "Personal"
- `"memory.filterKnowledge"`: "知识" / "Knowledge"
- `"memory.filterPreference"`: "偏好" / "Preferences"
- `"memory.filterPack"`: "记忆包" / "Packs"

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: build memory page with graph-first view and list toggle"
```

---

### Task 5: Verify build and run final check

**Files:** None (verification only)

- [ ] **Step 1: Run build**

```bash
cd apps/web && npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify all new routes are accessible**

Check that these routes exist in the build output:
- `/app` (Dashboard)
- `/app/assistants/new` (Wizard)
- `/app/assistants/[id]` (Profile)
- `/app/chat` (Chat)
- `/app/memory` (Memory)
- `/app/discover` (Discover placeholder)
- `/app/devices` (Devices placeholder)

- [ ] **Step 3: Commit if any fixes were needed**

```bash
git add -A && git commit -m "fix: resolve build issues from Plan 2 implementation"
```
