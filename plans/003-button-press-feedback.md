# 003 — Add press feedback to Button

- **Status**: DONE
- **Commit**: 500ef34
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, ~2 lines

## Problem

`Button` has no press feedback. Its base class transitions colour only, and
there is no `:active` styling anywhere in `packages/ui` — so a click produces no
physical acknowledgement on the most-used control in the app (referenced in 35
files).

```ts
// packages/ui/src/components/Button.tsx:16 — current
export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-1 rounded-lg font-medium transition-colors cursor-pointer disabled:cursor-not-allowed",
```

Press feedback is not decoration. A button is pressed many times a day, and the
frequency rule that bans decorative motion on frequent actions explicitly
exempts feedback — the press *is* the product responding.

## Target

```
transition-[transform,background-color,border-color,color] duration-150
ease-[var(--ease-snappy)]
active:scale-[0.97]
disabled:active:scale-100
motion-reduce:transition-[background-color,border-color,color] motion-reduce:active:scale-100
```

- `0.97` sits in the 0.95–0.98 range; anything smaller reads as a bounce.
- The properties are named individually. `transition-all` would animate
  unintended properties off the GPU.
- Disabled buttons must not react to a press.
- The existing `transition-colors` is replaced by this list, which already
  includes the colour properties it covered.

## Repo conventions to follow

- Variants are declared with `cva` and the base string is its first argument —
  the transition belongs in that base string so every variant inherits it, not
  in each variant.
- `--ease-snappy` comes from plan 001, in `packages/ui/style/tokens.css`.
- Exemplar of naming exact properties: `apps/desktop/src/components/Scrubber.tsx`
  uses `transition: "width 150ms cubic-bezier(...)"`, never `all`.

## Steps

1. In `packages/ui/src/components/Button.tsx:16`, replace `transition-colors` in
   the `buttonVariants` base string with the Target class list.

## Boundaries

- Do NOT add motion to the `Kbd` sub-component.
- Do NOT change any variant's colours, sizes, or the `href`/`spinner`/`icon`
  props.
- Do NOT touch other clickable components (`EditorButton` in the editor has its
  own styling) — separate scope.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit -p apps/desktop` and
  `pnpm exec biome check packages/ui/src/components/Button.tsx` pass.
- **Feel check**:
  - Press and hold any button: it scales down slightly and **stays** down until
    release. Release: it returns.
  - The scale is subtle — if it reads as "squishy", it is too much.
  - Press a disabled button: nothing moves.
  - Hover a button and confirm the colour transition still runs at the same
    speed it did before.
  - DevTools → Rendering → "Emulate prefers-reduced-motion": pressing produces
    no scale, but the colour change remains.
- **Done when**: every button in the app responds to a press, disabled buttons
  do not, and no button's resting appearance changed.
