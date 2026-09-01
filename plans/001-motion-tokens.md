# 001 — Add motion tokens and a reduced-motion convention

- **Status**: DONE
- **Commit**: 500ef34
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Accessibility
- **Estimated scope**: 1 file, ~15 lines

## Problem

There are no motion tokens. Eight hand-typed cubic-beziers are spread across the
app, two of them near-identical:

```css
/* apps/desktop/src/App.css — current, four separate occurrences */
cubic-bezier(0.4, 0, 0.2, 1)
/* apps/desktop/src/App.css */
cubic-bezier(0.23, 1, 0.32, 1)
cubic-bezier(0, 0, 0.2, 1)
cubic-bezier(0.8, 0, 1, 1)
```

```ts
// apps/desktop/src/components/Scrubber.tsx — current, two near-duplicates
transition: "width 150ms cubic-bezier(0.23, 1, 0.32, 1)"
transition: "left 150ms cubic-bezier(0.22, 1, 0.36, 1)"
```

`0.23, 1, 0.32, 1` and `0.22, 1, 0.36, 1` are the same curve to the eye. Plans
002–004 all need a strong ease-out; without a token they would add a ninth and
tenth hand-typed curve.

Separately, `packages/ui` has **zero** `prefers-reduced-motion` handling, so any
motion added by 002–004 would inherit that gap.

## Target

Two tokens in the existing `:root` block of `packages/ui/style/tokens.css`,
beside the `--ease-spring-out` token that is already there:

```css
/* Strong ease-out for UI that enters, exits or responds to a press. The
 * built-in CSS easings are too weak to read as deliberate. */
--ease-snappy: cubic-bezier(0.23, 1, 0.32, 1);

/* Strong ease-in-out for elements moving between two on-screen positions. */
--ease-smooth: cubic-bezier(0.77, 0, 0.175, 1);
```

**They must NOT be named `--ease-out` / `--ease-in-out`.** Tailwind v4 ships
those exact names as theme variables (`tailwindcss/theme.css:435-436`), so
redefining them in `:root` would silently retarget every existing `ease-out` and
`ease-in-out` utility across the whole app.

Usage from Tailwind classes is `ease-[var(--ease-snappy)]`.

## Repo conventions to follow

- Easing custom properties live in the `:root` block of
  `packages/ui/style/tokens.css` — exemplar at
  `packages/ui/style/tokens.css:220` (`--ease-spring-out`), which is also
  preceded by a comment explaining what the curve is for. Match that.
- `@theme` in the same file is reserved for Tailwind-generated utilities
  (`--font-sans`, `--animate-shimmer`). Do not put easings there.

## Steps

1. In `packages/ui/style/tokens.css`, directly after the `--ease-spring-out`
   declaration (line 220), add the two tokens from **Target** with their
   comments.

## Boundaries

- Do NOT migrate existing hand-typed curves in `App.css` or `Scrubber.tsx` in
  this plan — those are working and out of scope. This plan only makes the
  tokens available.
- Do NOT add anything to `@theme`.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit -p apps/desktop` passes (CSS-only
  change, so this only proves nothing else broke).
- **Feel check**: none — this plan adds no motion on its own.
- **Done when**: `grep -n "ease-snappy\|ease-smooth" packages/ui/style/tokens.css`
  returns both tokens, and `grep -c "^\s*--ease-out:" packages/ui/style/tokens.css`
  returns 0.
