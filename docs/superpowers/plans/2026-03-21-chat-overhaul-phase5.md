# Chat System Overhaul — Phase 5: Polish & Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split chat/page.tsx sidebar, add graceful degradation, and final cleanup.

**Architecture:** Extract ConversationSidebar from page.tsx. Add fallback logic in ChatInterface for when streaming/realtime/TTS/ASR services are unavailable.

**Tech Stack:** React, Next.js, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-chat-system-overhaul-design.md` — Phase 5

**Depends on:** Phases 1-4 complete

---

## Task 1: Extract ConversationSidebar from page.tsx

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/chat/ConversationSidebar.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/chat/page.tsx`

- [ ] **Step 1: Read page.tsx fully**

Understand all sidebar-related code:
- Conversation list fetching and state
- Date grouping (today/yesterday/thisWeek/earlier)
- Message summary fetching for conversation titles
- Search filtering
- New/delete conversation handlers
- Sidebar JSX structure

- [ ] **Step 2: Create ConversationSidebar.tsx**

Extract into a self-contained component:

```typescript
interface ConversationSidebarProps {
  projectId: string | null;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onConversationCreated?: (id: string) => void;
}
```

The sidebar should self-manage:
- Fetching conversations for the current project
- Date grouping and search filtering
- Message summaries for titles
- Delete with confirmation
- Creating new conversations

Expose callbacks for parent coordination:
- `onSelectConversation` — user clicks a conversation
- `onNewConversation` — user clicks new conversation button
- `onConversationCreated` — after API creates new conversation, pass ID back

- [ ] **Step 3: Slim page.tsx to layout-only**

page.tsx should only:
- Manage two-column layout
- Hold `activeConversationId` state
- Sync route params (`project_id`, `conv`) with state
- Render `<ConversationSidebar>` and `<ChatInterface>`

Target: page.tsx under 100 lines.

- [ ] **Step 4: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/(console)/app/chat/"
git commit -m "refactor: extract ConversationSidebar from chat page"
```

---

## Task 2: Graceful degradation

**Files:**
- Modify: `apps/web/components/console/ChatInterface.tsx`
- Modify: `apps/web/components/console/RealtimeVoicePanel.tsx`
- Modify: `apps/web/components/console/StandardVoiceControls.tsx`

- [ ] **Step 1: SSE fallback to non-streaming**

In ChatInterface's handleSend, if the SSE stream request fails (not abort), fall back to the existing `apiPost` non-streaming endpoint:

```typescript
} catch (err) {
  if ((err as Error).name === "AbortError") {
    messageListRef.current?.finalizeMessage(tempId, { id: tempId, isStreaming: false });
  } else {
    // Fallback to non-streaming
    try {
      const response = await apiPost<MessageOut>(
        `/api/v1/chat/conversations/${conversationId}/messages`,
        { content, enable_thinking: options.enableThinking },
      );
      messageListRef.current?.updateMessage(tempId, () => response.content);
      messageListRef.current?.finalizeMessage(tempId, {
        id: response.id,
        isStreaming: false,
      });
    } catch (fallbackErr) {
      // Show error in message bubble
      messageListRef.current?.updateMessage(tempId, () => t("errors.streamError"));
      messageListRef.current?.finalizeMessage(tempId, { id: tempId, isStreaming: false });
    }
  }
}
```

- [ ] **Step 2: Realtime voice fallback**

In RealtimeVoicePanel, if WebSocket connection fails after max reconnect attempts, show a toast suggesting standard text mode:

```typescript
if (voice.state === "error") {
  // Already shows retry button
  // Add: suggestion to switch to standard mode
}
```

- [ ] **Step 3: Hide unavailable features**

In StandardVoiceControls, if the first dictation attempt fails with `model_api_unconfigured`, hide the mic button for the rest of the session:

```typescript
const [asrAvailable, setAsrAvailable] = useState(true);
// In catch: if (error.code === "model_api_unconfigured") setAsrAvailable(false);
if (!asrAvailable) return null; // Don't render mic button
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/console/
git commit -m "feat: add graceful degradation for streaming, realtime, and voice"
```

---

## Task 3: Final verification

- [ ] **Step 1: Full TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 2: Backend tests**

Run: `cd apps/api && python -m pytest tests/ -q --tb=short`

- [ ] **Step 3: Line count audit**

Run line counts on all refactored files, verify ChatInterface is trending toward target size:

```bash
wc -l apps/web/components/console/ChatInterface.tsx \
     apps/web/components/console/ChatMessageList.tsx \
     apps/web/components/console/ChatInputBar.tsx \
     apps/web/components/console/ChatModePanel.tsx \
     apps/web/components/console/StandardVoiceControls.tsx \
     apps/web/components/console/RealtimeVoicePanel.tsx \
     apps/web/components/console/chat-types.ts \
     apps/web/hooks/useRealtimeVoiceBase.ts \
     apps/web/hooks/useRealtimeVoice.ts \
     apps/web/hooks/useSyntheticRealtimeVoice.ts \
     apps/web/lib/api-stream.ts \
     "apps/web/app/[locale]/(console)/app/chat/page.tsx" \
     "apps/web/app/[locale]/(console)/app/chat/ConversationSidebar.tsx"
```

- [ ] **Step 4: Check for stale imports**

```bash
grep -r "from.*RealtimeVoice\"\|from.*SyntheticRealtimeVoice\"" apps/web/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next | grep -v useRealtimeVoice | grep -v useSyntheticRealtimeVoice
```

- [ ] **Step 5: Final commit**

```bash
git commit -m "refactor: Phase 5 complete — sidebar split, graceful degradation, final polish"
```
