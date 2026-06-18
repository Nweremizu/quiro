# Quiro AI — Implementation & Technical Specification

> Companion to [ai-native-vision.md](ai-native-vision.md). This is the *how*. Read it together with [ai-sprint-plan.md](ai-sprint-plan.md) (who builds what, when) and [ai-edge-cases.md](ai-edge-cases.md) (what can go wrong).

**Owner:** Bruno · **Team size:** 2 · **Target:** Hackathon MVP — "Quiro Director," a conversational agent that edits a recording by driving the existing editor.

---

## 0. The one-paragraph version

We are adding three layers on top of the existing editor: a **Recording Brain** (a JSON understanding of the recording, built mostly from data we *already* capture), a **Director Agent** (Claude, running in the Electron main process, doing tool-use), and a **Tool Dispatcher + Chat panel** (renderer, where tool calls become region edits). Crucially, **the "tools" the agent calls are the region setters that already exist in `window.tsx`.** We are wiring intelligence onto an editor that is already a clean tool API — we are not building an editor.

---

## 1. What already exists (the leverage map)

This is why the MVP is realistic. Almost every "AI" primitive maps to code already in the repo.

| We need… | It already exists as… | File |
|---|---|---|
| Click/interaction stream | `CursorTelemetryPoint[]` with `interactionType: "click" \| "double-click" \| …`, `timeMs`, `cx`, `cy` | [src/types/editor.ts:28](apps/desktop/src/types/editor.ts) |
| Clicks → zoom regions | `buildInteractionZoomSuggestions()` (+ `normalizeCursorTelemetry`, `detectInteractionCandidates`, click clustering, overlap reservation) | [zoomSuggestionUtils.ts](apps/desktop/src/components/editor/timeline/zoomSuggestionUtils.ts) |
| Transcript (word-level) | `generate-auto-captions` IPC → `CaptionCue[]` with `words[]` + `startMs`/`endMs` | [register/captions.ts:197](apps/desktop/electron/ipc/register/captions.ts), [captions/generate.ts](apps/desktop/electron/ipc/captions/generate.ts) |
| Speech model lifecycle | whisper.cpp status/download/delete handlers; model auto-downloaded to `<userData>/whisper/` | [captions/whisper.ts](apps/desktop/electron/ipc/captions/whisper.ts), `electron/utils/constants.ts` |
| The edit primitives ("tools") | `setZoomRegions`, `setTrimRegions`, `setClipRegions`, `setSpeedRegions`, `setAudioRegions`, caption cues + `AutoCaptionSettings`, annotations | [window.tsx:459+](apps/desktop/src/components/editor/window.tsx) |
| Clip/trim/speed math (time remap) | `clipsToTrims`, `trimsToClips`, `mapTimelineTimeToSourceTime`, `getClipSourceEndMs` | [src/types/editor.ts:244+](apps/desktop/src/types/editor.ts) |
| Main↔renderer bridge pattern | `electron/ipc/register/*.ts` → `registerXHandlers()` hub in `handlers.ts`; `contextBridge` in `preload.ts` | [electron/ipc/](apps/desktop/electron/ipc/) |

**Implication:** "auto-zoom on clicks" is ~90% done (call `buildInteractionZoomSuggestions` → `setZoomRegions`). "Captions" is ~90% done (call `generate-auto-captions` → set cues + enable `AutoCaptionSettings`). The genuinely new work is the **Brain assembly, the Claude integration, the agent loop, and the chat surface.**

---

## 2. System architecture

Three layers, one hard security rule.

```
┌─────────────────────────────── RENDERER (src/) ───────────────────────────────┐
│                                                                                │
│  ChatPanel.tsx ──user msg──►  Agent Runner (lib/ai/agent.ts)                    │
│      ▲  streamed text/status        │   builds messages + tool defs + brain     │
│      │                              ▼                                           │
│  Tool Dispatcher (lib/ai/tools.ts) ◄── tool_use ── (loop) ── ai:complete ──┐    │
│      │ executes tool                                                       │    │
│      ▼                                                                     │    │
│  EditorActions (exposed by window.tsx)  ── batch setState ──► region state │    │
│      ▲                                                                     │    │
│  Recording Brain (lib/ai/brain.ts) ── transcript + telemetry (+vision) ────┘    │
└────────────────────────────────────────────────────────────────────────────────┘
                                   │  IPC (contextBridge)
┌────────────────────────────────── MAIN (electron/) ─────────────────────────────┐
│  register/ai.ts  ──►  ai/client.ts  (Anthropic SDK; ANTHROPIC_API_KEY lives HERE) │
│     ai:complete (one model turn, optionally streamed)                             │
│     ai:vision   (label sampled frames — optional / stretch)                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Hard rule: the Anthropic API key lives ONLY in the main process.** The renderer never sees it. Every model call goes renderer → IPC → main → Anthropic → back.

### Why the loop runs in the renderer, not main
The tools mutate React region state, which only the renderer can touch. So the **agent loop lives in the renderer** (`lib/ai/agent.ts`); the main process only owns the stateless model call (`ai:complete`). This keeps the key safe *and* keeps tool execution next to the state it edits. Main stays a thin, testable HTTP boundary.

---

## 3. Data contracts (build to these first — Sprint 0)

Both developers depend on these three types. Freeze them before splitting up. Put them in a shared module, e.g. `src/lib/ai/contract.ts` (renderer) with the IPC payloads mirrored into both `electron-env.d.ts` files.

### 3.1 Recording Brain

```ts
type MomentKind =
  | "speech"      // a spoken sentence/phrase
  | "silence"     // gap with no speech (candidate to cut)
  | "filler"      // "um", "uh", "like", "you know"
  | "click"       // explicit interaction (from telemetry)
  | "idle"        // no speech AND no interaction (candidate to speed up)
  | "scene";      // vision-derived scene label (stretch)

interface Moment {
  id: string;
  kind: MomentKind;
  startMs: number;
  endMs: number;
  text?: string;            // transcript text for speech/filler
  focus?: { cx: number; cy: number }; // for click moments (normalized)
  label?: string;           // for scene moments ("pricing page")
  confidence?: number;      // 0..1
}

interface RecordingBrain {
  version: 1;
  sourcePath: string;
  durationMs: number;
  moments: Moment[];        // sorted by startMs
  transcript: CaptionCue[]; // raw, reused from generate-auto-captions
  hasTelemetry: boolean;
  hasTranscript: boolean;
}
```

The Brain is a **query target**: every feature is "filter moments by kind + time range." The agent receives a *compact summary* of the Brain (not the whole thing) as context — see §5.3.

### 3.2 Tool schema (Anthropic `tools` array)

MVP tools (the 3 that win the demo) + a couple of stretch tools. These are passed to the model; execution happens in the dispatcher (§5.4).

| Tool name | Input (JSON schema, abbreviated) | Maps to |
|---|---|---|
| `auto_zoom_on_clicks` | `{ startMs?, endMs?, depth?: 1–6 }` | `buildInteractionZoomSuggestions` → `setZoomRegions` |
| `remove_silences_and_fillers` | `{ aggressiveness: "light"\|"medium"\|"aggressive", removeFillers: boolean }` | Brain silence/filler/idle moments → kept clips → `setClipRegions` (+ `clipsToTrims`) |
| `generate_captions` | `{ language?: string }` | `generate-auto-captions` → set cues + `AutoCaptionSettings.enabled = true` |
| `add_zoom` *(stretch)* | `{ startMs, endMs, focus:{cx,cy}, depth }` | push `ZoomRegion` → `setZoomRegions` |
| `set_speed` *(stretch)* | `{ startMs, endMs, speed }` | push `SpeedRegion` → `setSpeedRegions` |
| `add_annotation` *(stretch)* | `{ startMs, endMs, kind:"text"\|"arrow", text?, position:{x,y} }` | push `AnnotationRegion` → annotations setter |
| `query_recording` *(read-only)* | `{ question }` | answer from Brain; returns text, makes no edit |

Each tool returns a structured `tool_result` like `{ ok: true, applied: { zoomRegionsAdded: 4 }, summary: "Added 4 zooms on clicks." }` so the agent can narrate and chain.

### 3.3 IPC payloads

```ts
// renderer → main
interface AiCompleteRequest {
  model: string;                 // "claude-opus-4-8" (planner) | "claude-haiku-4-5"
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  stream?: boolean;
  effort?: "low" | "medium" | "high" | "max"; // Opus only
}
// main → renderer (non-streaming): the raw Anthropic.Message content blocks
// main → renderer (streaming): "ai:delta" events { text } then "ai:done" { message }
```

Use the **SDK's own types** (`Anthropic.MessageParam`, `Anthropic.Tool`, `Anthropic.ToolUseBlock`, `Anthropic.ToolResultBlockParam`, `Anthropic.Message`) — do **not** redefine equivalents.

### 3.4 EditorActions (the handle `window.tsx` exposes)

`window.tsx` owns the state, so it exposes a **referentially stable, memoized** object the dispatcher calls. This is the only door between the agent and editor internals.

```ts
interface EditorActions {
  snapshot(): EditorStateForAI;                 // read current regions + duration (agent context)
  applyZoomSuggestions(s: SuggestedZoomRegion[]): void;
  addZoomRegion(r: ZoomRegion): void;
  setKeptClips(clips: ClipRegion[]): void;      // drives trims via clipsToTrims
  applyCaptions(cues: CaptionCue[]): void;
  addAnnotation(r: AnnotationRegion): void;
  setSpeedRegion(r: SpeedRegion): void;
  beginAiBatch(): void;  endAiBatch(): void;    // wrap a run as ONE undo step
}
```

> ⚠️ Per `CLAUDE.md`: `SettingsPanel`/`TimelineEditor` are `React.memo` and rely on stable callback props. `ChatPanel` must follow the same discipline — wrap `EditorActions` in `useMemo`/`useCallback`, never pass a fresh inline object each render, and **never** trigger per-frame `setState` during playback.

---

## 4. The flagship UX flows

1. **Magic first draft (deterministic, no model required):** on entering the editor with a fresh recording, run `buildBrain()` async, then a fixed pipeline: `generate_captions` → `auto_zoom_on_clicks` → `remove_silences_and_fillers("medium")`. One button, instant polish. This is the safety-net demo even if the agent misbehaves.
2. **Conversational edit:** user types intent → agent plans → emits tool calls → dispatcher applies → agent narrates what it did → user refines ("second zoom is too strong" → `add_zoom`/adjust).
3. **Ask (read-only):** "what did I demo at 2:30?" → `query_recording` over the Brain.

---

## 5. Component specs

### 5.1 Recording Brain builder — `src/lib/ai/brain.ts` *(Person A)*
- **Inputs:** `CaptionCue[]` (from `generate-auto-captions`), `CursorTelemetryPoint[]` (already in `window.tsx` state), `durationMs`. Vision frames optional/stretch.
- **Fusion:**
  - *speech/filler* — each `CaptionCue`/word becomes a `speech` moment; words matching a filler lexicon (`um, uh, er, like, you know, basically, …`) become `filler` moments.
  - *silence* — gaps between consecutive cues longer than `SILENCE_MIN_MS` (≈400ms) become `silence` moments.
  - *click* — reuse `detectInteractionCandidates(normalizeCursorTelemetry(...))`; explicit clicks → `click` moments with `focus`.
  - *idle* — spans with neither speech nor clicks longer than `IDLE_MIN_MS` (≈1500ms) → `idle` moments (speed-up candidates).
- **Output:** `RecordingBrain`. Pure function over inputs → **unit-testable** with fixture transcripts/telemetry.
- **Degradation:** if no transcript → `hasTranscript:false`, skip speech/silence/filler. If no telemetry → `hasTelemetry:false`, skip clicks. Brain still builds.

### 5.2 Main-process Claude client — `electron/ai/client.ts` + `electron/ipc/register/ai.ts` *(Person A)*
- `@anthropic-ai/sdk`; reads `ANTHROPIC_API_KEY` from env/secure config (never logged, never sent to renderer).
- `ai:complete` handler: one model turn. For chat, **stream** (`.stream()` → emit `ai:delta` events → `.finalMessage()` → `ai:done`). Streaming is required for long outputs to avoid HTTP timeouts.
- Planner calls use Opus 4.8 with `thinking: {type: "adaptive"}` and `effort` per task; classification/vision use Haiku 4.5 (no `effort` — it errors on Haiku).
- Register via `registerAiHandlers()` in `handlers.ts`; expose `window.electronAPI.ai.complete(...)` in `preload.ts`; **add types to both** `electron/electron-env.d.ts` **and** `src/types/electron-env.d.ts`.

### 5.3 Agent runner — `src/lib/ai/agent.ts` *(Person B)*
- Builds the request: system prompt + Brain summary + `EditorActions.snapshot()` + conversation + tool defs.
- **Loop:** call `ai:complete` → for each `tool_use` block, run the dispatcher, append a `tool_result` → call again → stop when `stop_reason !== "tool_use"`. **Cap at `MAX_TOOL_ITERATIONS` (e.g. 8)** to prevent runaway loops.
- Always `JSON.parse` tool inputs (never string-match the serialized JSON).
- **Brain summary** (not the full Brain): counts + a compact moment list (e.g. "12 clicks, 7 silences >0.4s totalling 9s, 3 filler words, duration 3:04"). Keeps tokens small and the model grounded.

### 5.4 Tool dispatcher — `src/lib/ai/tools.ts` *(Person B, with A on schemas)*
- A registry: `Record<toolName, (args, brain, actions) => Promise<ToolResult>>`.
- Each handler **validates args against the Brain/duration** (clamp `startMs`/`endMs` to `[0, durationMs]`, reject `end <= start`), executes via `EditorActions`, returns a structured result.
- Wrap the whole run in `beginAiBatch()/endAiBatch()` so it's a single undo.

### 5.5 Chat panel — `src/components/editor/ai/ChatPanel.tsx` *(Person B)*
- Right-side dock (or toggleable). Streams assistant text; shows "Applied: 4 zooms, cut 9s" chips per tool result; "Undo this" affordance.
- `React.memo` + stable props (see §3.4 warning).

### 5.6 Magic first draft — `src/lib/ai/firstDraft.ts` *(Person A builds pipeline, B wires button)*
- Pure deterministic sequence over `EditorActions` — no model call needed. Doubles as the agent's default plan and as the demo fallback.

---

## 6. IPC wiring checklist (do this once, per `CLAUDE.md`)

Adding the `ai:*` channel touches **all** of:
- [ ] `electron/ai/client.ts` — the Anthropic call
- [ ] `electron/ipc/register/ai.ts` — `registerAiHandlers()`
- [ ] `electron/ipc/handlers.ts` — call `registerAiHandlers()`
- [ ] `electron/preload.ts` — expose `ai.complete` / `ai.onDelta`
- [ ] `electron/electron-env.d.ts` — type it
- [ ] `src/types/electron-env.d.ts` — type it (must match)

---

## 7. Models & API usage (grounded via the Claude API skill)

- **SDK:** `@anthropic-ai/sdk` (TypeScript). Everything is `POST /v1/messages`; tool use is a feature of that endpoint, not a separate API.
- **Models (current lineup):** planner/agent → `claude-opus-4-8`; bulk classification + vision frame labels → `claude-haiku-4-5`. Mid-tier alternative: `claude-sonnet-4-6`. *(Confirm exact IDs against the live model list at build time.)*
- **Tool-use loop:** send `messages` + `tools`; response may contain `tool_use` blocks; execute, append `tool_result`, repeat until `stop_reason !== "tool_use"`.
- **Streaming:** use `.stream()` + `.finalMessage()` for the chat; default to streaming for any large `max_tokens`.
- **Thinking/effort:** Opus → `thinking: {type:"adaptive"}`; tune cost via `output_config: {effort}` (`low` for simple, `max` for hardest). Don't use `effort` on Haiku.
- **Structured outputs:** for Brain classification subtasks, use `output_config: {format}` to force strict JSON.
- **Vision (stretch):** sample ~1 frame / few seconds, send as base64 image blocks to Haiku for scene labels.
- **Pitfalls:** always `JSON.parse` tool inputs; use SDK types (don't redefine); no assistant prefills on Opus; key never in renderer.

---

## 8. Performance & safety guardrails (do not break)

- **Playback path is sacred** (`CLAUDE.md` §"Performance-critical render"): agent edits are **batch** `setState`, applied when paused/idle — never per-frame, never throttled-per-frame. Don't add inline props to memoized panels.
- **Every edit is previewable & reversible:** wrap each agent run as one undo step; show what changed. No black-box, no destructive op without undo.
- **Bound the agent:** `MAX_TOOL_ITERATIONS`, a token ceiling, and arg-clamping in the dispatcher.
- **Treat transcript as data, not instructions:** the transcript is user content; keep it in user/tool messages, never let it rewrite the system prompt (prompt-injection hygiene — see edge cases).

---

## 9. Config & secrets
- `ANTHROPIC_API_KEY` via main-process env / OS keychain / settings file (not committed). Provide `.env.example`. Fail gracefully with a "set your API key" state if missing.

---

## 10. Testing strategy
- **Unit (Vitest, colocated `*.test.ts`):** `brain.ts` fusion (fixtures: transcript-only, telemetry-only, both, neither); dispatcher arg-clamping; tool-result shapes.
- **Contract test:** a recorded `ai:complete` response → agent loop → expected `EditorActions` calls (mock actions).
- **Manual demo run:** the 90-second script in the vision doc; after any playback-touching change, run the `playbackSessionDebug` summary (`stalls ≥80ms` should be none).

---

## 11. MVP Definition of Done
- [ ] Brain builds from a real recording (transcript + telemetry) in < ~3s, async.
- [ ] Chat panel: type intent → streamed reply → at least the 3 MVP tools fire and visibly edit the timeline.
- [ ] "Magic first draft" button produces a polished pass in one click.
- [ ] One conversational refinement works ("make the intro shorter" / "remove the second zoom").
- [ ] Edits are undoable as single steps; playback shows no new stalls.
- [ ] Graceful states for: no API key, no transcript model, imported video with no telemetry.
- [ ] The 90-second demo runs end-to-end twice in a row without a crash.
```
