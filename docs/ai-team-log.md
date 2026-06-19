# Quiro AI — Team Communication & Handoff Log

> Our async channel. When you finish something the other person depends on, or
> make a decision that affects the shared contract, **write it here** instead of
> hoping it gets said in standup. Newest entries at the top.

**Team:** Bruno = **Person A** ("The Brain" — Recording Brain + main-process Claude client) · Teammate = **Person B** ("The Director" — chat UI + agent loop + tool dispatcher)
**Plan:** [ai-sprint-plan.md](ai-sprint-plan.md) · **Spec:** [ai-implementation-spec.md](ai-implementation-spec.md) · **Edge cases:** [ai-edge-cases.md](ai-edge-cases.md) · **Contract:** `apps/desktop/src/lib/ai/contract.ts`

## How to use this file
- **Handoff entry** when you ship something the other half waits on → add to the log with `@A`/`@B` and what's now unblocked.
- **Decision** that changes the shared contract → add a `Dn` row and tag the other person to confirm.
- **Question** that blocks you → add to Open Questions and tag the owner.
- Status tags: `✅ done` · `🚧 in progress` · `⛔ blocked` · `👀 needs review`.

---

## 📋 Status board

| Task | Owner | Status | Notes |
|---|---|---|---|
| **S0-1** Shared contract (`contract.ts`) | A+B | ✅ done | Typechecks + lints clean. **Review & confirm, B.** |
| **S0-2** `ai:complete` IPC stub + both `d.ts` | A | ⬜ next | Ship the *stub* first so B can build the agent loop. |
| **S0-3** API key config + "missing key" state | A | ⬜ todo | |
| **S0-4** Empty ChatPanel + stub `EditorActions` | B | ⬜ todo | Implement `EditorActions` against the contract. |

_Update this board as things move._

---

## 🧭 Decisions (need both to agree)

| # | Decision | Rationale | Status |
|---|---|---|---|
| **D1** | IPC protocol uses **plain serializable wire types** (`AiMessage`, `AiContentBlock`, `AiToolDefinition`), **not** `@anthropic-ai/sdk` types. The **main process** owns the SDK and maps wire ↔ SDK. | IPC crosses the contextBridge (structured clone) and we don't want the SDK in the renderer bundle. Keeps the contract explicit. | ✅ agreed (A) · 👀 confirm (B) |
| **D2** | **Timebase = source-media ms everywhere in the Brain & tool args.** Convert to timeline-time only when touching existing clips, via `mapTimelineTimeToSourceTime` / `mapSourceTimeToTimelineTime` (`editor.ts`). | Transcript + telemetry are in source time; mixing timebases is the #1 bug risk (edge case 2.2). | ✅ agreed (A) · 👀 confirm (B) |
| **D3** | The agent receives a **`BrainSummary`** (counts + one paragraph), not the full `RecordingBrain`. | Keeps tokens bounded on long recordings. | ✅ agreed (A) · 👀 confirm (B) |
| **D4** | Models: planner `claude-opus-4-8`, classifier/vision `claude-haiku-4-5` (see `AI_MODELS` in contract). | Per spec §7. Confirm exact IDs at integration time. | ✅ agreed (A) |

---

## ❓ Open questions

- **@team** — Hackathon **timeframe**? Drives how much of Sprint 2–4 we attempt. (Sprint plan compresses to a weekend.)
- **@team** — Confirm **Bruno = Person A**. If you'd rather own the renderer, say so now (cheap to swap before S0-2).
- **@B** — For `EditorActions` (S0-4): does `window.tsx` already have an undo/history mechanism I (A) should know about, or do `beginAiBatch/endAiBatch` need to build one? Affects edge case 4.3.
- **@team** — Voice input for chat, or text-only v1? (Default: text only.)
- **@team** — Vision/`scene` moments in MVP, or stretch-only? (Default: stretch — Brain ships on transcript + telemetry.)

---

## 🧾 Handoff log

### 2026-06-19 — S0-1 contract landed ✅  `@B please review`
**From:** A (paired w/ Claude) · **Re:** `apps/desktop/src/lib/ai/contract.ts`

The shared contract is in and verified (`tsc --noEmit` + `eslint --max-warnings 0` both clean). It's the source of truth for both halves — please skim it and confirm D1–D3 above.

**What it defines (5 sections):**
1. **Recording Brain** — `MomentKind`, `Moment`, `BrainInputs`, `RecordingBrain`, `BrainSummary`.
2. **Editor boundary** — `EditorStateForAI` + `EditorActions` (the only door from the agent into `window.tsx`). **@B: this is your S0-4 interface to implement.**
3. **Tools** — `AiToolName`, per-tool input types, `ToolResult`, and `AI_TOOLS` (the full JSON-schema definitions array, with real descriptions). **@B: your dispatcher implements one handler per `AiToolName`.**
4. **IPC protocol** — `AiCompleteRequest`, `AiCompleteResult`, `AiStreamEvent`, `AI_IPC` channel names. **@A (me): S0-2 implements these in main.**
5. **Tuning constants** — `FILLER_WORDS`, `SILENCE_MIN_MS`, `IDLE_MIN_MS`, `MAX_TOOL_ITERATIONS`, `AI_MODELS`.

**What's now unblocked for @B:** you can start S0-4 (implement `EditorActions` in `window.tsx` + mount the empty `ChatPanel`) immediately — everything you need is typed. Build the agent loop against the `AI_IPC` + `AiMessage`/`AiToolUseBlock` types; I'll have the `ai:complete` **stub** (S0-2) returning a canned message shortly so you're never blocked on the real model.

**What I (A) do next:** S0-2 — `electron/ai/client.ts` + `electron/ipc/register/ai.ts` wiring `AI_IPC.complete`, plus the type entries in **both** `electron-env.d.ts` files (per CLAUDE.md). Stub first, real Anthropic call in S1-2.

**Heads-up / contract notes worth knowing:**
- I reuse the real editor types (`ZoomRegion`, `ClipRegion`, `CaptionCue`, `SuggestedZoomRegion`, …) rather than re-inventing them — so `applyZoomSuggestions` takes exactly what `buildInteractionZoomSuggestions()` returns.
- Tool `input` arrives as `unknown` on purpose — **always validate/clamp before applying** (edge cases 3.1, 3.6). Don't trust model-supplied times.

---

_(Add new entries above this line.)_
