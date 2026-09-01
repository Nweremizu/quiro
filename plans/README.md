# Animation plans

Findings from an `improve-animations` audit of `Select`, `Switch` and `Button`,
run against commit `500ef34`.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Add motion tokens and a reduced-motion convention](001-motion-tokens.md) | MEDIUM | DONE |
| 002 | [Give the Select popup entrance motion from its trigger](002-select-popup-motion.md) | HIGH | DONE |
| 003 | [Add press feedback to Button](003-button-press-feedback.md) | HIGH | DONE |
| 004 | [Sharpen the Switch thumb travel and add press feedback](004-switch-motion.md) | MEDIUM | DONE |

## Execution order

**001 first** — 002, 003 and 004 all reference the `--ease-snappy` token it
adds. After that, 002 / 003 / 004 are independent and touch different files.

## Deliberately not planned

- **`SelectItem` highlight has no transition.** Correct as-is: list-item hover
  is a high-frequency interaction and must stay instant. `Dropdown.tsx` items
  *do* transition on `data-[highlighted]`, which is the real violation — out of
  scope here.
- **Ungated `:hover` styling.** Tailwind v4 already gates the `hover:` variant
  behind `@media (hover: hover)`, so there is nothing to fix.
- **Missed opportunities not yet planned**: the Button icon ↔ spinner swap
  (currently pops in and shifts the label; a cross-fade is the textbook fix), and
  a Select value-text crossfade (probably wrong — it is a frequent interaction).
