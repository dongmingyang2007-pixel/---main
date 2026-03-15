# Auth Pages Public Site Integration

## Goal

Merge login, register, and forgot-password pages into the public site's visual system. They should feel like natural extensions of the public site, not a separate application.

## Current State

Auth pages sit under `(auth)` route group with no SiteHeader/Footer. They use a split-panel layout (WorkbenchHero dark gradient left + form right) with `console-*` CSS classes. This creates a jarring visual break from the clean, white, Tailwind-driven public pages.

## Target State

Auth pages share the same header, footer, and visual language as product/pricing/support pages. Clean centered card form, v2 design tokens, standard typography hierarchy, GSAP entrance animations.

## Architecture

### Route Change

Move auth pages from `(auth)` to `(public)` route group, or update `(auth)/layout.tsx` to include SiteHeader + SiteFooter. Preferred: update auth layout to wrap with public chrome, keeping the route group separation for potential middleware differences.

### Page Structure (all 3 pages)

```
SiteHeader (shared)
  <main pt-16>
    <section min-h-[60vh] flex-col items-center justify-center px-6 text-center>
      <p> eyebrow (text-sm uppercase tracking-widest text-secondary)
      <h1> title (text-3xl font-bold text-primary)
      <p> description (mt-4 text-secondary max-w-md)
      <div> form card (mt-8 w-full max-w-md rounded-radius-lg border bg-surface p-8)
        inputs (Tailwind: rounded-radius-md border bg-base px-4 py-3)
        MagneticButton (rounded-radius-full bg-brand-v2 w-full py-3)
        links (text-brand-v2)
    </section>
SiteFooter (shared)
```

### Login Page

- Eyebrow: "Console"
- Title: t("login.title")
- Description: t("login.helper")
- Form: email + password + submit button
- Below form: forgot password link, register link

### Register Page

- Step 1 (form): eyebrow + title + description + form (displayName, email, password, confirmPassword) + get code button
- Step 2 (code): eyebrow changes to "verify", title changes, description shows email, 6-digit code input + submit button + back/resend links

### Forgot Password Page

- Step 1 (email): eyebrow + title + description + email input + get code button + back to login link
- Step 2 (code): title changes, code + new password inputs + submit + back/resend links
- Success: title + description + sign-in link

### Components to Remove

- `WorkbenchHero` import from all 3 auth pages
- `useScrollReveal` import from login page
- `auth-back-bar` / `auth-back-link` CSS (SiteHeader replaces)
- `auth-shell` / `auth-card` / `auth-panel` CSS classes from page JSX

### Components to Add/Reuse

- `SiteHeader` + `SiteFooter` via layout
- `MagneticButton` for submit buttons
- GSAP entrance animation (fade + slide-up, matching public pages)

### CSS Changes

- Auth pages use Tailwind utilities directly (no custom auth-* or console-* classes)
- Input styling via Tailwind: `w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[var(--text-primary)]`
- Labels: `block mb-2 text-sm font-medium text-[var(--text-secondary)]`
- Error notice: `rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`

## Files Changed

- `apps/web/app/[locale]/(auth)/layout.tsx` - add SiteHeader + SiteFooter
- `apps/web/app/[locale]/(auth)/login/page.tsx` - rewrite JSX
- `apps/web/app/[locale]/(auth)/register/page.tsx` - rewrite JSX
- `apps/web/app/[locale]/(auth)/forgot-password/page.tsx` - rewrite JSX

## Files NOT Changed

- Translation keys (reuse existing keys)
- API integration logic (same endpoints)
- State management logic (same useState/useCallback patterns)
- `WorkbenchHero.tsx` component (keep for potential future use, just remove imports)
