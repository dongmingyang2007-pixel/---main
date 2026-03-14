# Convergence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish cross-cutting concerns: legacy token cleanup, mobile adaptations, prefers-reduced-motion support, touch target sizing, and MobileNav CTA hide behavior.

**Architecture:** Convergence focuses on cleanup and polish — no new features. Legacy CSS tokens and Tailwind colors are migrated in remaining files, then removed from globals.css and tailwind.config.ts. Mobile-specific CSS and reduced-motion media queries are added. MobileNav gets IntersectionObserver-based CTA hiding.

**Tech Stack:** CSS custom properties, Tailwind CSS, IntersectionObserver API, GSAP ScrollTrigger, Framer Motion

---

## Chunk 1: Legacy Token Migration

### Task 1: Migrate DataTable to v2 tokens

Replace `var(--muted)`, `var(--line)`, `var(--fg)` with v2 equivalents.

### Task 2: Migrate Uploader to v2 tokens

Replace `var(--muted)` with `var(--text-secondary)`.

### Task 3: Migrate console page inline legacy vars

In console pages that still reference `var(--fg)`, `var(--muted)`, `var(--bg)`, etc., replace with v2 tokens.

### Task 4: Remove legacy tokens from globals.css

Remove legacy `:root` vars: `--bg`, `--bg-soft`, `--fg`, `--muted`, `--muted-soft`, `--line`, `--line-strong`, `--glass`, `--glass-strong`, `--glass-dark`, `--brand` (legacy), `--brand-strong`, `--accent`, `--danger`, `--warning`, `--success`, `--radius-panel`, `--radius-card`, `--radius-pill`.

### Task 5: Remove legacy Tailwind colors

Remove `ink`, `surf`, `electric`, `mint`, `amber` from tailwind.config.ts.

## Chunk 2: Mobile & Accessibility Polish

### Task 6: MobileNav CTA hide on scroll

Add IntersectionObserver to hide the bottom CTA when a CTA section is visible.

### Task 7: Touch target sizing

Add CSS for minimum 44x44px touch targets and disable hover on touch devices.

### Task 8: prefers-reduced-motion for GSAP

Ensure useScrollScene and all GSAP animations respect prefers-reduced-motion.

### Task 9: Console mobile polish

Verify and adjust console mobile layout for < lg and < md breakpoints.
