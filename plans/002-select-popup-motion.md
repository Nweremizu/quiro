# 002 — Give the Select popup entrance motion from its trigger

- **Status**: DONE
- **Commit**: 500ef34
- **Severity**: HIGH
- **Category**: Physicality & origin / Missed opportunities
- **Estimated scope**: 1 file, ~8 lines
- **Depends on**: 001 (uses `--ease-snappy`)

## Problem

The Select popup has no entrance or exit motion at all — it teleports into
place. There is no transition, no `data-starting-style`, and no
`transform-origin`, so nothing connects the popup to the trigger it came from.
This is the single most-used dropdown in the app (11 instances in the editor's
config sidebar alone).

```tsx
// packages/ui/src/components/Select.tsx:88 — current
export function SelectContent({ className, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Popup
      className={cn(
        "z-1000 max-h-80 min-w-(--anchor-width) isolate overflow-hidden rounded-xl border border-gray-5 bg-gray-2 p-1 text-gray-12 shadow-md",
        className,
      )}
      {...props}
    />
  );
}
```

The trigger's chevron also never rotates, even though the trigger already reads
`data-[popup-open]` for its border colour:

```tsx
// packages/ui/src/components/Select.tsx:52 — current
<SelectPrimitive.Icon>
  <ChevronDownIcon className="size-4 opacity-50" />
</SelectPrimitive.Icon>
```

## Target

Base UI 1.7.0 exposes `--transform-origin`, `data-starting-style` and
`data-ending-style` (verified present in the installed package). Add to the
`SelectPrimitive.Popup` class list:

```
origin-[var(--transform-origin)]
transition-[transform,opacity] duration-200 ease-[var(--ease-snappy)]
data-[starting-style]:scale-96 data-[starting-style]:opacity-0
data-[ending-style]:scale-96 data-[ending-style]:opacity-0
motion-reduce:transition-[opacity] motion-reduce:data-[starting-style]:scale-100
```

- `scale-96` (0.96), never `scale-0` — nothing in the real world appears from
  nothing.
- 200ms sits inside the 150–250ms budget for dropdowns and selects.
- Transitions, not keyframes, so a popup closed mid-open retargets from where it
  is instead of restarting.
- Under reduced motion the scale is dropped but the opacity fade stays, because
  reduced motion means gentler, not zero.

And on the chevron:

```
size-4 opacity-50 transition-transform duration-200 ease-[var(--ease-snappy)]
group-data-[popup-open]/select-trigger:rotate-180 motion-reduce:transition-none
```

This requires the trigger to be a named group. Add `group/select-trigger` to the
`selectTriggerVariants` base string at `packages/ui/src/components/Select.tsx:10`.

## Repo conventions to follow

- Motion is expressed as Tailwind utility classes on the component, not as CSS
  in a stylesheet — exemplar: `apps/desktop/src/components/PanelSection.tsx`,
  whose panel uses
  `transition-[height] duration-150 ease-out motion-reduce:transition-none`.
- Every transition names its exact properties. `transition-all` is never used in
  `packages/ui` — keep it that way.
- `cn()` from `../utils/helpers` merges class strings.

## Steps

1. In `packages/ui/src/components/Select.tsx:10`, add `group/select-trigger` to
   the front of the `selectTriggerVariants` base class string.
2. In `packages/ui/src/components/Select.tsx:52`, replace the chevron's
   `className` with the chevron target above.
3. In `packages/ui/src/components/Select.tsx:88` (`SelectContent`), append the
   popup target classes to the existing class string, before `className`.

## Boundaries

- Do NOT animate `SelectItem`'s `data-[highlighted]` state. List-item hover is a
  high-frequency interaction and must stay instant — this is deliberate, not an
  oversight.
- Do NOT touch `Dropdown.tsx`, `Popover.tsx`, `Dialog.tsx` or `Toast.tsx`, even
  though they have the same missing-motion problem. Separate scope.
- Do NOT change the popup's structure, positioning, `sideOffset`, or z-index.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit -p apps/desktop` and
  `pnpm exec biome check packages/ui/src/components/Select.tsx` both pass.
- **Feel check**: open the editor's config sidebar (any tab) and open a Select:
  - The popup grows from the **trigger's edge**, not from its own centre. Open a
    Select near the bottom of the sidebar — the popup flips above the trigger and
    the origin must follow it.
  - The chevron rotates 180° as the popup opens and unwinds as it closes.
  - Open and immediately close: the popup shrinks from wherever it had got to,
    it does not jump to full size first.
  - In DevTools → Animations, set playback to 10% and confirm the popup starts
    at 0.96 scale, never at 0.
  - In DevTools → Rendering, enable "Emulate prefers-reduced-motion" and confirm
    the popup fades without scaling or sliding.
- **Done when**: all four bullets above hold and no other component's appearance
  changed.
