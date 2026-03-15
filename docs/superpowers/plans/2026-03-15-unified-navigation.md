# Unified Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the public site header (SiteHeader) and console top bar (TopBar) into a single UnifiedHeader component, with reliable auth state detection via an `auth_state` cookie.

**Architecture:** One `UnifiedHeader` component auto-adapts between public-site mode (nav links + login/avatar) and console mode (logo + "控制台" label + avatar). Auth state is tracked via a JS-readable `auth_state` cookie set on login, cleared on logout/401. A new `middleware.ts` file wires the existing `proxy()` function for route guarding.

**Tech Stack:** Next.js App Router, next-intl, Tailwind CSS, shadcn/ui DropdownMenu, Framer Motion (mobile nav), existing CSS design system variables.

**Spec:** `docs/superpowers/specs/2026-03-15-unified-navigation-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/lib/api.ts` | Modify | Rename cookie, add `logout()`, add `setAuthState()`/`clearAuthState()`, clear `auth_state` on 401 |
| `apps/web/lib/auth-state.ts` | Create | Thin helpers: `isLoggedIn()`, `setAuthState()`, `clearAuthState()` — shared between client components and api.ts |
| `apps/web/middleware.ts` | Create | Next.js middleware entry: import and call `proxy()` |
| `apps/web/proxy.ts` | Modify | Use `auth_state` cookie for `/app` route guard |
| `apps/web/components/UnifiedHeader.tsx` | Create | Unified header: public mode + console mode |
| `apps/web/components/UnifiedMobileNav.tsx` | Create | Unified mobile navigation overlay |
| `apps/web/components/console/InlineTopBar.tsx` | Create | Breadcrumb + project switcher for console workspace area |
| `apps/web/components/console/ConsoleShell.tsx` | Modify | Remove TopBar, add InlineTopBar |
| `apps/web/app/[locale]/(public)/layout.tsx` | Modify | Replace SiteHeader with UnifiedHeader |
| `apps/web/app/[locale]/(console)/layout.tsx` | Modify | Replace ConsoleShell's TopBar with UnifiedHeader |
| `apps/web/app/[locale]/(auth)/layout.tsx` | Modify | Replace SiteHeader with UnifiedHeader |
| `apps/web/app/[locale]/(auth)/login/page.tsx` | Modify | Call `setAuthState()` + use renamed cookie on login |
| `apps/web/app/[locale]/(auth)/register/page.tsx` | Modify | Call `setAuthState()` + use renamed cookie on register |
| `apps/web/app/[locale]/(console)/app/settings/page.tsx` | Modify | Use centralized `logout()` |
| `apps/web/messages/zh/common.json` | Modify | Add user menu translation keys |
| `apps/web/messages/en/common.json` | Modify | Add user menu translation keys |
| `apps/web/styles/globals.css` | Modify | Add unified-header styles, remove old site-header-v2/topbar styles |

**Delete after all tasks complete:**
- `apps/web/components/public/SiteHeader.tsx`
- `apps/web/components/console/TopBar.tsx`
- `apps/web/components/public/MobileNav.tsx`
- `apps/web/components/console/MobileConsoleNav.tsx`

---

## Task 1: Auth state cookie helpers + API refactor

**Files:**
- Create: `apps/web/lib/auth-state.ts`
- Modify: `apps/web/lib/api.ts`

- [ ] **Step 1: Create `auth-state.ts` with cookie helpers**

```typescript
// apps/web/lib/auth-state.ts
const AUTH_STATE_COOKIE = "auth_state";
const AUTH_STATE_MAX_AGE = 3600; // 1 hour, matches JWT_EXPIRE_MINUTES default

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string, maxAge?: number): void {
  if (typeof document === "undefined") return;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
  document.cookie = cookie;
}

function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

export function isLoggedIn(): boolean {
  return readCookie(AUTH_STATE_COOKIE) === "1";
}

export function setAuthState(): void {
  writeCookie(AUTH_STATE_COOKIE, "1", AUTH_STATE_MAX_AGE);
}

export function clearAuthState(): void {
  clearCookie(AUTH_STATE_COOKIE);
}
```

- [ ] **Step 2: Refactor `api.ts` — rename cookie, add `logout()`, clear auth on 401**

In `apps/web/lib/api.ts`:

1. Change `WORKSPACE_COOKIE_NAME` from `"qihang_workspace_id"` to `"mingrun_workspace_id"`
2. Import `{ clearAuthState, setAuthState }` from `@/lib/auth-state`
3. In `parseResponse`, after the `clearCachedSecurityState()` call on 401/403, add `clearAuthState()`
4. Add exported `logout()` function:

```typescript
export async function logout(): Promise<void> {
  try {
    await apiPost("/api/v1/auth/logout", {});
  } catch {
    // Clear client state regardless of API errors
  }
  clearAuthState();
  clearWorkspaceId();
  clearCachedSecurityState();
  window.location.href = "/login";
}
```

5. Update `persistWorkspaceId` to also call `setAuthState()`:

```typescript
export function persistWorkspaceId(workspaceId: string): void {
  writeCookie(WORKSPACE_COOKIE_NAME, workspaceId);
  setAuthState();
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/auth-state.ts apps/web/lib/api.ts
git commit -m "feat(auth): add auth_state cookie helpers and centralized logout"
```

---

## Task 2: Middleware + proxy auth guard

**Files:**
- Create: `apps/web/middleware.ts`
- Modify: `apps/web/proxy.ts`

- [ ] **Step 1: Update `proxy.ts` to use `auth_state` cookie**

In `apps/web/proxy.ts`, find the auth check block (around line 66):

```typescript
// OLD:
const hasAuth = request.cookies.get("access_token")?.value || request.cookies.get("qihang_workspace_id")?.value;
if (isProtectedConsolePath(strippedPath) && !hasAuth) {
```

Replace with:

```typescript
// NEW:
if (isProtectedConsolePath(strippedPath) && !request.cookies.get("auth_state")?.value) {
```

- [ ] **Step 2: Create `middleware.ts`**

```typescript
// apps/web/middleware.ts
export { proxy as middleware } from "./proxy";
export { config } from "./proxy";
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts apps/web/proxy.ts
git commit -m "feat(auth): wire middleware.ts and switch route guard to auth_state cookie"
```

---

## Task 3: Translation keys for user menu

**Files:**
- Modify: `apps/web/messages/zh/common.json`
- Modify: `apps/web/messages/en/common.json`

- [ ] **Step 1: Add user menu keys to zh/common.json**

Add these keys:

```json
"user.enterConsole": "进入控制台",
"user.backToSite": "返回官网",
"user.settings": "账号设置",
"user.logout": "退出登录",
"nav.consoleBadge": "控制台"
```

- [ ] **Step 2: Add user menu keys to en/common.json**

Add these keys:

```json
"user.enterConsole": "Enter Console",
"user.backToSite": "Back to Site",
"user.settings": "Account Settings",
"user.logout": "Log Out",
"nav.consoleBadge": "Console"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/zh/common.json apps/web/messages/en/common.json
git commit -m "i18n: add unified header user menu translation keys"
```

---

## Task 4: UnifiedHeader component

**Files:**
- Create: `apps/web/components/UnifiedHeader.tsx`

This is the core component. It reads the current pathname to determine mode (public vs console), reads `auth_state` cookie for login status, and renders accordingly.

- [ ] **Step 1: Create `UnifiedHeader.tsx`**

Key implementation details:

```typescript
"use client";

import { useState, useCallback } from "react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useScrollNav } from "@/lib/useScrollNav";
import { isLoggedIn } from "@/lib/auth-state";
import { logout } from "@/lib/api";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
// Import shadcn DropdownMenu components for user menu
```

Structure:
- `isConsoleMode` = `pathname === "/app" || pathname.startsWith("/app/")`
- `loggedIn` = `isLoggedIn()` (reads `auth_state` cookie)
- `useScrollNav()` only called when NOT in console mode (use conditional rendering or separate sub-components to avoid conditional hook calls — wrap in a `PublicScrollBehavior` child component)
- Public mode: render `NAV_KEYS` links (product, ecosystem, demo, pricing, support) with active state
- Console mode: render brand + "控制台" badge
- Right side: `LanguageSwitcher` + either login button (if !loggedIn) or `UserAvatarMenu` dropdown (if loggedIn)
- `UserAvatarMenu` dropdown items: enter console / back to site (context-dependent), settings, separator, logout (red)
- Mobile: hamburger button triggers `UnifiedMobileNav`

CSS classes: reuse existing `site-header-v2` base class for positioning/backdrop. Add `is-console` modifier for console mode.

**Important:** `useScrollNav()` cannot be called conditionally. Create a wrapper approach:
- Always render the header
- Pass `enableScroll={!isConsoleMode}` prop to a child `ScrollBehavior` component that conditionally uses the hook
- Or: use `useScrollNav()` unconditionally but ignore its output in console mode (always show header)

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/UnifiedHeader.tsx
git commit -m "feat: create UnifiedHeader component with public/console modes"
```

---

## Task 5: UnifiedMobileNav component

**Files:**
- Create: `apps/web/components/UnifiedMobileNav.tsx`

- [ ] **Step 1: Create `UnifiedMobileNav.tsx`**

Merge logic from existing `MobileNav.tsx` (public) and `MobileConsoleNav.tsx` (console):

```typescript
"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { isLoggedIn } from "@/lib/auth-state";
import { logout } from "@/lib/api";
```

Props: `open: boolean`, `onClose: () => void`, `mode: "public" | "console"`

- Public mode: show public nav items (产品, AI 生态, Demo, 定价, 支持) + login/user actions
- Console mode: show console nav items (仪表盘, 项目, 数据集, 训练, 模型仓, 评测, 设备, 计费, 设置) + user actions
- Animation: reuse existing Framer Motion slide-in pattern
- Prevent body scroll when open
- Close on link click

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/UnifiedMobileNav.tsx
git commit -m "feat: create UnifiedMobileNav with context-dependent navigation"
```

---

## Task 6: InlineTopBar for console workspace

**Files:**
- Create: `apps/web/components/console/InlineTopBar.tsx`

- [ ] **Step 1: Create `InlineTopBar.tsx`**

Extract breadcrumb and project switcher logic from existing `TopBar.tsx` (lines 15-86):

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useProjectContext } from "@/lib/ProjectContext";
```

Contains:
- `BreadcrumbNav` — same logic as current TopBar breadcrumb (split pathname, translate segments, truncate UUIDs)
- `ProjectSwitcher` — same dropdown as current TopBar (read from ProjectContext)
- Layout: horizontal bar with breadcrumb left, project switcher right
- Styled as a thin utility bar inside the workspace area (not a fixed header)

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/console/InlineTopBar.tsx
git commit -m "feat: create InlineTopBar with breadcrumb and project switcher"
```

---

## Task 7: Wire layouts + update ConsoleShell

**Files:**
- Modify: `apps/web/app/[locale]/(public)/layout.tsx`
- Modify: `apps/web/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/web/app/[locale]/(console)/layout.tsx`
- Modify: `apps/web/components/console/ConsoleShell.tsx`

- [ ] **Step 1: Update public layout**

Replace `SiteHeader` import with `UnifiedHeader`:

```typescript
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { SiteFooter } from "@/components/public/SiteFooter";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UnifiedHeader />
      <main className="pt-16">{children}</main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 2: Update auth layout**

Same change — replace `SiteHeader` with `UnifiedHeader`:

```typescript
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { SiteFooter } from "@/components/public/SiteFooter";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UnifiedHeader />
      <main className="pt-16">{children}</main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 3: Update ConsoleShell — remove TopBar, add InlineTopBar**

```typescript
"use client";

import { type ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { InlineTopBar } from "./InlineTopBar";
import { StatusBar } from "./StatusBar";

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="console-shell">
      <div className="console-shell-body">
        <ActivityBar />
        <div className="console-shell-workspace">
          <InlineTopBar />
          {children}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
```

Note: mobile menu state is now managed by `UnifiedHeader`, not ConsoleShell.

- [ ] **Step 4: Update console layout — add UnifiedHeader above ConsoleShell**

```typescript
"use client";

import { useEffect } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "console");
    root.classList.add("dark");
    return () => {
      root.removeAttribute("data-theme");
      root.classList.remove("dark");
    };
  }, []);

  return (
    <ProjectProvider>
      <UnifiedHeader />
      <ConsoleShell>{children}</ConsoleShell>
      <CommandPalette />
      <Toaster />
    </ProjectProvider>
  );
}
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/[locale]/(public)/layout.tsx apps/web/app/[locale]/(auth)/layout.tsx apps/web/app/[locale]/(console)/layout.tsx apps/web/components/console/ConsoleShell.tsx
git commit -m "feat: wire UnifiedHeader into all layouts, remove TopBar from ConsoleShell"
```

---

## Task 8: Update login/register pages + settings page

**Files:**
- Modify: `apps/web/app/[locale]/(auth)/login/page.tsx`
- Modify: `apps/web/app/[locale]/(auth)/register/page.tsx`
- Modify: `apps/web/app/[locale]/(console)/app/settings/page.tsx`

- [ ] **Step 1: Update login page**

In `apps/web/app/[locale]/(auth)/login/page.tsx`:

1. Import `{ setAuthState }` from `@/lib/auth-state`
2. In the `onSubmit` handler, after `persistWorkspaceId(auth.workspace.id)`, `setAuthState()` is already called inside `persistWorkspaceId` (from Task 1), so no additional change needed here. Just verify the renamed cookie works — `persistWorkspaceId` now writes to `mingrun_workspace_id`.

- [ ] **Step 2: Update register page**

Same pattern — verify `persistWorkspaceId` is called after successful registration. It should already call `setAuthState()` internally.

- [ ] **Step 3: Update settings page logout**

In `apps/web/app/[locale]/(console)/app/settings/page.tsx`, find the logout button handler and replace with:

```typescript
import { logout } from "@/lib/api";

// In the logout button onClick:
onClick={() => logout()}
```

Remove any inline logout logic (direct `apiPost` call, `window.location.href`, etc.).

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/[locale]/(auth)/login/page.tsx apps/web/app/[locale]/(auth)/register/page.tsx apps/web/app/[locale]/(console)/app/settings/page.tsx
git commit -m "feat: update auth pages to use auth_state cookie and centralized logout"
```

---

## Task 9: CSS updates

**Files:**
- Modify: `apps/web/styles/globals.css`

- [ ] **Step 1: Add console-mode header styles**

Add a `.site-header-v2.is-console` modifier:

```css
.site-header-v2.is-console {
  /* No auto-hide, no progress bar in console mode */
  transform: none !important;
  backdrop-filter: blur(12px);
}
```

Add `.console-badge` style for the "控制台" label next to the logo:

```css
.console-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand-v2);
}
```

Add `.inline-topbar` style for the console workspace inline bar:

```css
.inline-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.8125rem;
}
```

Update `.console-shell` to remove top padding for the old TopBar (now handled by UnifiedHeader + layout `pt-16`).

- [ ] **Step 2: Verify no visual regressions with a quick build**

Run: `cd apps/web && npx next build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add apps/web/styles/globals.css
git commit -m "style: add unified header console mode and inline topbar styles"
```

---

## Task 10: Delete old components + final verification

**Files:**
- Delete: `apps/web/components/public/SiteHeader.tsx`
- Delete: `apps/web/components/console/TopBar.tsx`
- Delete: `apps/web/components/public/MobileNav.tsx`
- Delete: `apps/web/components/console/MobileConsoleNav.tsx`

- [ ] **Step 1: Search for remaining imports of deleted files**

Run: `grep -r "SiteHeader\|TopBar\|MobileNav\|MobileConsoleNav" apps/web/components apps/web/app --include="*.tsx" --include="*.ts" -l`

Fix any remaining references before deleting.

- [ ] **Step 2: Delete old files**

```bash
rm apps/web/components/public/SiteHeader.tsx
rm apps/web/components/console/TopBar.tsx
rm apps/web/components/public/MobileNav.tsx
rm apps/web/components/console/MobileConsoleNav.tsx
```

- [ ] **Step 3: Final TypeScript compilation check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor: remove old SiteHeader, TopBar, MobileNav, MobileConsoleNav (replaced by UnifiedHeader)"
```
