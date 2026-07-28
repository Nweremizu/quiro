# 0002 — BrandKit is a separate persisted layer, never a field inside a Look

Status: accepted, 2026-07-26 (roadmap D12) · not yet implemented (Phase 2)

## Context

Phase 2 introduces `Look` — a plain serializable subset of `ProjectEditorState`
representing a curated or user-saved visual/motion preset — and, separately,
brand identity (logo, colors, fonts) that a user wants applied across their
exports. The two are easy to conflate: both are "settings that get applied to
a project," and a naive design embeds brand fields directly inside each Look.

## Decision

Brand identity lives in its own persisted structure, `BrandKit`, stored in
`<userData>` — outside and independent of any Look. A Look never carries
logo/color/font fields directly; where it needs to reference brand identity
(e.g. "use the brand accent color"), it references brand *tokens*, not values.

**Structural rule, held firmly:** a user has *one* brand and *many* Looks.

## Rationale

A user's brand does not change when they switch visual styles. If brand
fields were embedded per-Look:

- Switching Looks would wipe branding, since each Look would carry its own
  (or no) copy of the logo/colors/fonts.
- Every new Look — built-in or user-saved — would need brand data re-entered,
  turning an eight-built-in-Looks feature into eight opportunities to forget
  branding.
- There would be no single source of truth for "what is this user's brand,"
  making a future "apply my brand consistently" agent tool (or even a manual
  "update my logo everywhere" action) require rewriting every stored Look.

The moat here is the taste embedded in the built-in Looks, not the save/load
mechanism around them. Eight Looks that feel genuinely expensive beat infinite
save slots, and none of that taste is compromised by keeping brand identity
external.

## Consequences

- `Look` stays a plain serializable subset of `ProjectEditorState` with no
  brand fields, which is also what keeps it costlessly shareable as a file
  later (deferred, not built) — a Look file that referenced local brand
  tokens by value would leak someone else's branding into it, or reference
  tokens the recipient doesn't have.
- The Look-application code path (settings panel, and later the `apply_look`
  agent tool in Phase 3) must resolve brand tokens against the current
  `BrandKit` at apply time, not read them off the Look.
- `BrandKit` needs its own persistence, its own settings-panel surface, and
  its own default-state question (a project with no configured brand) — none
  of which exists yet. This ADR fixes the *shape* of that future work, not
  its implementation.
- A Look picker (Phase 2) can safely present Looks without also presenting
  branding controls — they are orthogonal UI, not layered.

## Related

- `docs/product-roadmap.md` — D12, Phase 2 checklist
- ADR 0001 (configurable-first) — a Look is a *starting point* users can move
  away from, same as any preset; BrandKit similarly is not meant to be a
  one-time embedded snapshot, it stays live and editable.
