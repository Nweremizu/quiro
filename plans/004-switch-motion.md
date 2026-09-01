# 004 — Sharpen the Switch thumb travel and add press feedback

- **Status**: DONE
- **Commit**: 500ef34
- **Severity**: MEDIUM
- **Category**: Easing & duration / Physicality
- **Estimated scope**: 1 file, ~3 lines

## Problem

The Switch thumb animates with Tailwind's bare `transition-transform`, which
resolves to 150ms at `cubic-bezier(0.4, 0, 0.2, 1)` — a weak, symmetric curve.
A toggle should snap into its new state; this one drifts.

```tsx
// packages/ui/src/components/Switch.tsx:20 — current
<SwitchPrimitive.Thumb
  className={cn(
    "pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform",
    "data-[unchecked]:translate-x-0 data-[checked]:translate-x-full",
  )}
/>
```

There is also no press feedback, and no reduced-motion handling anywhere in the
component.

## Target

Thumb:

```
pointer-events-none block size-5 rounded-full bg-white shadow-sm
transition-transform duration-[180ms] ease-[var(--ease-snappy)]
motion-reduce:transition-[background-color]
```

Root (append to the existing class list, which already has `transition-colors`):

```
active:scale-[0.97] motion-reduce:active:scale-100
disabled:active:scale-100
transition-[colors,transform] duration-150 ease-[var(--ease-snappy)]
```

- 180ms for a 20px travel reads as deliberate without lag; the thumb is
  *entering* a new position, so ease-out is the right family.
- Reduced motion drops the thumb's travel animation — the position change still
  happens instantly, which still communicates state, and the track's colour
  change (a non-motion state cue) is untouched.

## Repo conventions to follow

- `--ease-snappy` comes from plan 001, in `packages/ui/style/tokens.css`.
- Class lists are passed through `cn()` from `../utils/helpers`, split across
  string arguments by concern — keep that shape.
- Exemplar of `motion-reduce:` usage:
  `apps/desktop/src/components/PanelSection.tsx`.

## Steps

1. In `packages/ui/src/components/Switch.tsx:20`, replace the thumb's first
   class string with the Thumb target.
2. In `packages/ui/src/components/Switch.tsx:10`, replace `transition-colors` in
   the root's first class string with the Root target's transition and add the
   `active:` / `motion-reduce:` classes.

## Boundaries

- Do NOT change the track or thumb dimensions, colours, or the
  `data-[checked]` / `data-[unchecked]` translate values — the 20px travel is
  already geometrically correct (44px track − 4px padding − 20px thumb).
- Do NOT add a bounce or overshoot curve. `--ease-spring-out` exists in the
  token file; it is deliberately not used here — this is a crisp desktop tool,
  not a playful consumer app.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit -p apps/desktop` and
  `pnpm exec biome check packages/ui/src/components/Switch.tsx` pass.
- **Feel check**: the editor's Background tab → Decoration → "Show border".
  - Toggle it: the thumb arrives decisively rather than gliding to a stop.
  - Toggle it rapidly back and forth: the thumb reverses from its current
    position and never jumps back to the start.
  - Press and hold the switch: the whole control scales down slightly.
  - DevTools → Animations at 10% playback: the thumb covers most of its distance
    early, then settles — not a constant-speed slide.
  - DevTools → Rendering → reduced motion: the thumb jumps, the track colour
    still changes.
- **Done when**: all five bullets hold and the switch's resting appearance in
  both states is unchanged.
