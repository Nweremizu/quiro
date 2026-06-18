# Quiro AI — Sprint Plan & Task Board (2-person team)

> Execution plan for [ai-implementation-spec.md](ai-implementation-spec.md). Pairs with [ai-edge-cases.md](ai-edge-cases.md).

**Team:** 2 · **Owner:** Bruno

---

## Roles

We split by **layer**, not by feature, so each person owns a vertical they can move fast in. The two halves meet at the **contract** (spec §3).

| | **Person A — "The Brain" (intelligence + data + main process)** | **Person B — "The Director" (surface + tools + renderer)** |
|---|---|---|
| Owns | Recording Brain, main-process Anthropic client (`ai:complete`), tool *schemas*, system prompts, models, first-draft pipeline logic | Chat panel UI, agent runner loop, tool *dispatcher*, `EditorActions` exposure in `window.tsx`, magic-draft button, preview/undo UX |
| Lives in | `electron/ai/`, `electron/ipc/register/ai.ts`, `src/lib/ai/brain.ts`, `src/lib/ai/firstDraft.ts`, `src/lib/ai/prompts.ts` | `src/components/editor/ai/`, `src/lib/ai/agent.ts`, `src/lib/ai/tools.ts`, edits to `window.tsx` |
| Risk they de-risk | "Can we even understand the recording + talk to Claude safely?" | "Can a tool call actually move the timeline without breaking playback?" |

> Suggested: **Bruno = Person A** (owns the Brain + Claude integration — the heart of the pitch). Swap if Bruno prefers UI. Either way, **both pair on Sprint 0.**

---

## The one rule that makes 2-person parallelism work

**Contract first.** Nobody builds in isolation until `src/lib/ai/contract.ts` (Brain type, tool schema, IPC payloads, `EditorActions` interface — spec §3) is written and committed *together* in Sprint 0. After that, A mocks B and B mocks A, and you only integrate at sprint boundaries.

---

## Sprints

Phase-ordered, not calendar-locked — compresses to a **weekend hackathon** (Sprint 0–1 day one, 2–3 day two, 4 morning of demo) or stretches to ~2 weeks. Integrate at the end of every sprint.

### Sprint 0 — Foundations & Contract *(JOINT, ~½ day)*
Goal: agreed contract + skeletons that compile, so parallel work can't drift.

| ID | Task | Owner | Depends | Done when |
|---|---|---|---|---|
| S0-1 | Write & commit `src/lib/ai/contract.ts` (Brain, tools, IPC, EditorActions) | A+B | — | Both import it; types compile |
| S0-2 | Stub `ai:complete` IPC end-to-end (returns a canned message) + both `d.ts` files | A | S0-1 | Renderer can call `window.electronAPI.ai.complete` and get the stub |
| S0-3 | Add `ANTHROPIC_API_KEY` config + `.env.example` + "missing key" state | A | — | App boots without key, shows a clear prompt |
| S0-4 | Mount an empty `ChatPanel` dock in the editor; expose stub `EditorActions` from `window.tsx` | B | S0-1 | Panel toggles; `actions.snapshot()` returns real region counts |

**Integration check:** typing in the chat hits the stub `ai:complete` and renders a canned reply.

### Sprint 1 — First vertical slice *(end-to-end, thin)*
Goal: one real tool, end to end, with a real model call. Proves the whole pipe.

| ID | Task | Owner | Depends | Done when |
|---|---|---|---|---|
| S1-1 | `buildBrain()` v1 from transcript + telemetry (no vision) + unit tests | A | S0-1 | Fixtures (both/transcript-only/telemetry-only/neither) pass |
| S1-2 | Real `ai:complete` (Anthropic SDK, non-streaming first) + Brain-summary in system prompt | A | S0-2 | Returns real model text |
| S1-3 | Agent runner loop (single tool round-trip) + `MAX_TOOL_ITERATIONS` | B | S0-1, S1-2 | A `tool_use` round-trips and returns a `tool_result` |
| S1-4 | Dispatcher: `auto_zoom_on_clicks` → `buildInteractionZoomSuggestions` → `applyZoomSuggestions` | B | S0-4, S1-1 | "Zoom into my clicks" actually adds zoom regions |

**Integration check:** *"Zoom into everything I clicked"* → zoom regions appear on the timeline. 🎯 First magic moment.

### Sprint 2 — The three MVP tools + agent fluency
Goal: the full flagship tool set + the agent chooses tools from intent.

| ID | Task | Owner | Depends | Done when |
|---|---|---|---|---|
| S2-1 | `generate_captions` tool → `generate-auto-captions` → `applyCaptions` + enable `AutoCaptionSettings` | B | S1-4 | Captions appear; handles "model not downloaded" |
| S2-2 | `remove_silences_and_fillers` → Brain silence/idle/filler → kept clips → `setKeptClips` | A→B | S1-1 | Dead air + fillers collapse; `clipsToTrims` correct |
| S2-3 | System prompt + tool descriptions so the agent reliably maps intent → right tool(s) | A | S2-1,2-2 | "Make it punchy + captioned" fires 2–3 tools |
| S2-4 | Tool-result narration + "Applied: …" chips in chat | B | S1-3 | Each edit shows what changed |
| S2-5 | Arg validation/clamping in dispatcher (bounds, end>start, empty results) | B | S1-4 | Bad model args can't corrupt state (see edge cases) |

**Integration check:** one sentence of intent fires multiple tools and the agent narrates them.

### Sprint 3 — Magic first draft + streaming + trust
Goal: instant gratification + it *feels* alive + edits are safe.

| ID | Task | Owner | Depends | Done when |
|---|---|---|---|---|
| S3-1 | `firstDraft.ts` deterministic pipeline (captions → zoom → trim) | A | S2-2 | One call yields a polished pass with no model |
| S3-2 | "✨ Magic first draft" button wired to S3-1; runs async after Brain builds | B | S3-1 | One click polishes a raw recording |
| S3-3 | Streaming `ai:complete` (`ai:delta` events) + streamed chat rendering | A→B | S1-2 | Text streams token-by-token |
| S3-4 | `beginAiBatch/endAiBatch` → each run is ONE undo; "Undo this" in chat | B | S1-4 | Ctrl+Z reverts a whole agent action |
| S3-5 | Playback regression pass (`playbackSessionDebug` summary) | B | S3-2 | `stalls ≥80ms` = none during playback |

**Integration check:** record messy clip → one click → polished; then refine by chat; Ctrl+Z undoes cleanly.

### Sprint 4 — Polish, hardening, demo
Goal: it survives the stage.

| ID | Task | Owner | Depends | Done when |
|---|---|---|---|---|
| S4-1 | Graceful states: no key / no transcript model / imported video w/o telemetry / model error / offline | A+B | all | Each shows a friendly message, never crashes |
| S4-2 | One stretch tool if time (`add_zoom` *or* `query_recording`) | A+B | S2-3 | Bonus capability for Q&A |
| S4-3 | Rehearsed 90-sec demo + a **pre-recorded fallback clip** | B (lead) | all | Runs twice back-to-back, no crash |
| S4-4 | Pitch deck / talk track (problem → live transform → "while you talk") | A (lead) | all | 3–5 slides + script |
| S4-5 | `README`/demo notes for judges | A | all | Anyone can run it |

**Definition of MVP done:** spec §11 checklist all green.

---

## Critical path & parallelism

```
S0-1 (contract) ─┬─► A: S1-1 brain ──► S2-2 silences ──► S3-1 firstdraft ─┐
                 │                                                         ├─► S4 demo
                 ├─► A: S1-2 ai:complete ──► S3-3 streaming ───────────────┤
                 └─► B: S0-4 panel ──► S1-3 agent ──► S1-4 zoom tool ──────┘
                                            └─► S2-1 captions, S2-5 validation, S3-4 undo
```
- **Blocking dependency:** B's agent loop (S1-3) needs A's `ai:complete` (S1-2). Mitigate: A ships the **stub** (S0-2) day one so B builds the loop against the stub, then swaps in the real call.
- **The Brain (S1-1) is the long pole** — start it first, keep it a pure function so it's testable without the model.

## Cadence
- **Daily 10-min sync:** what landed, what's blocked, what integrates today.
- **Integrate at every sprint boundary** on `main` (or short-lived feature branches → PR). Don't let the two halves diverge for more than a day.
- **One shared demo recording fixture** committed early, so both test against the same clip.

## If we fall behind — cut in this order
1. Drop vision/scene moments (Brain works on transcript+telemetry alone).
2. Drop streaming (non-streaming chat still demos).
3. Drop conversational refinement; lean on the **Magic first draft button** (deterministic, no model) — it alone is a strong demo.
4. Drop stretch tools (`add_zoom`, `set_speed`, annotations, `query_recording`).

**Never cut:** the Brain, the zoom tool, undo safety, and the graceful "no key / no telemetry" states.
```
