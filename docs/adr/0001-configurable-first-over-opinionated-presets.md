# 0001 — Configurable-first over opinionated presets

Status: accepted, 2026-07-26 (roadmap D2)

## Context

A common shape for creative tools facing a novice/power-user split is to hide
depth behind a Simple/Pro mode toggle, or to replace deep controls with a small
set of opinionated presets and demote the raw parameters to an "advanced"
drawer. Quiro has real depth to hide: `cursorSpringStiffnessMultiplier` and
its siblings, six zoom depths, per-region easing, drift strength, and so on.

The pressure to simplify comes from a real problem — novices don't want to
learn a spring-physics vocabulary. But two different audiences were being
treated as one design question: *how does a novice get a good result* and
*where does the power-user control live*.

## Decision

Deep control stays the primary UI, permanently. Presets — including the
camera/cursor motion presets and the Phase 2 named "looks" — are starting
points a user can move away from, never the only way to reach a value. No
Simple/Pro toggle; no controls demoted to an advanced drawer.

**How this is enforced, not just intended:** as of the Phase 1 motion-preset
work, presets are implemented against a `CursorMotionPresetHandlers` map keyed
by every field the preset writes (`cursor-motion-presets.ts`). Adding a field
to a preset's value shape is a compile error until a handler — i.e. a visible,
editable control — exists for it. A preset literally cannot ship a field the
panel doesn't expose.

This also settled a real incident: `normalizeProjectEditor` used to resolve
the closest matching preset on project load and overwrite ten stored fields
with that preset's values, so a user's custom tuning silently reverted to the
nearest preset on reopen. That directly violated this ADR — a preset was
functioning as a replacement, not a starting point — and was fixed by keeping
the user's stored values and only falling back to preset/default values for
fields that are genuinely absent.

## Consequences

- Beginner accessibility cannot come from simplifying the panel. It has to
  come from somewhere else — the conversational agent (see the sibling
  decision on the agent as the novice surface, in `docs/product-roadmap.md`
  D3), which moves the same sliders a power user would, rather than a
  parallel simplified UI.
- Every preset and every future "look" (Phase 2) must be auditable field by
  field against the panel. A preset that sets something the panel can't show
  is a bug, not a feature.
- New settings-panel work should default to a visible control, not a
  presets-only value. If a value is genuinely not meant to be user-facing yet,
  it should not be in a preset either — see the `zoomInOverlapMs` /
  `connectedZoomGapMs` / `connectedZoomDurationMs` case, which stayed
  unexposed and consequently silently inert (issue #30).
- A stale memory once told a session to build the *opposite* of this
  decision (an opinionated-presets-first design), and it was acted on before
  being caught. This document is the durable fix for that failure mode.

## Related

- `docs/product-roadmap.md` — D2, D3, D4
- `apps/desktop/src/components/editor/utils/cursor-motion-presets.ts`
