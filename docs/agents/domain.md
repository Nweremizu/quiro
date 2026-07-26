# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
├── apps/
│   ├── desktop/     ← the product; almost all work happens here
│   └── web/         ← marketing / download site
└── packages/
    └── shared/      ← shared types
```

Quiro is a monorepo but not a multi-context one. `apps/desktop` is the product; `apps/web` and `packages/shared` are satellites with no competing vocabulary. Terms like *zoom region*, *clip*, *look*, *brand kit* mean exactly one thing across the whole repo, so one root glossary covers it.

Revisit this only if desktop and web ever develop genuinely conflicting terminology — at which point switch to a `CONTEXT-MAP.md` at the root pointing at per-area `CONTEXT.md` files.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

## Related standing docs

Not domain docs, but read them before proposing product work:

- **`docs/product-roadmap.md`** — 14 agreed decisions with reasoning, phases, and an explicit not-doing list. Settled questions live here so they aren't re-litigated.
- **`AGENTS.md` / `CLAUDE.md`** — repo layout, commands, and the playback/render performance invariants that must not be regressed.

Two roadmap decisions are hard to reverse and are the obvious first ADR candidates, currently unwritten: **BrandKit is a separate persisted layer, never a field inside a Look** (a user has one brand and many looks), and **configurable-first over opinionated presets**.
