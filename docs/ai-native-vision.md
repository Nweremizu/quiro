# Quiro AI — Product Vision & Hackathon Brief

> **One-liner:** Quiro turns a messy screen recording into a polished demo *while you talk to it.* You record; you tell it what you want in plain language; the timeline edits itself.

**Status:** Proposal / hackathon direction
**Owner:** Bruno
**Last updated:** 2026-06-17

---

## TL;DR

Editing a screen recording takes far longer than recording it. Today Quiro gives users powerful *manual* tools (zoom, trim, speed, captions, annotations). We want to make Quiro **AI-native**: a conversational agent that *understands* the recording and *edits it for the user* by driving the same tools they'd use by hand.

Because every edit in Quiro is already structured data (regions), the AI doesn't need to "drive a UI" — it reads and writes regions directly. That is our unfair advantage and the reason we can ship something magical in a hackathon timeframe.

---

## 1. The problem we're solving

**Recording is easy. Editing is the wall.** For the people who make screen recordings — developers writing docs, founders making product demos, support teams, educators, content creators — the work breaks down like this:

- **Editing takes 5–10× the recording time.** Placing zooms on every click, cutting dead air, removing "ums," speeding up boring stretches, writing captions — all manual, all tedious.
- **Polish requires skill.** Knowing *when* to zoom, how to pace, where to cut is craft. Most people don't have it, so their recordings look amateur.
- **One recording, many needs.** The same demo needs to become a short, a GIF for a README, a captioned social clip, a help-doc walkthrough. Today that's N separate manual edits.
- **The tools don't understand the content.** Existing editors (including ours, today) are dumb canvases. They don't know that at 0:42 the user clicked "Export," or that 0:10–0:18 is silence.

**The result:** people either ship rough, unpolished recordings, or they burn hours editing. Neither is good.

---

## 2. Our insight — why Quiro can win this

Two things make Quiro uniquely positioned:

1. **Our editor is already a clean tool API.** Every edit — zoom / trim / clip / speed / audio / annotation — lives as a structured *region* in `apps/desktop/src/components/editor/window.tsx`. An AI agent doesn't have to simulate clicks or move sliders; it calls a function that adds a region. **The editing surface is the tool surface.** Most competitors would have to bolt an agent onto a UI; ours plugs straight into state.

2. **We already capture the signals an AI needs to *understand* a recording:**
   - **Transcript** — whisper.cpp runtime is already integrated (captions). → words + timestamps.
   - **Cursor & interaction stream** — our native cursor monitor (`electron/native/bin/win32-x64/`) already tracks the cursor for the overlay. → clicks, movement, typing moments.
   - **The frames themselves** — we can sample frames and use a vision model for scene understanding.

We are ~60% of the way to an AI-native editor *before writing any AI code.* The hackathon work is the glue, not the foundation.

---

## 3. The vision — "Quiro Director"

A conversational editing agent built into the editor. The user records, then:

> *"Make this a punchy 60-second product demo. Zoom into every button I click, cut the dead air and my 'ums', add captions, and end on the pricing page."*

…and the **timeline assembles itself in front of them** — zoom regions snap onto clicks, dead air collapses, captions appear. Then they refine conversationally: *"second zoom is too aggressive," "keep my intro,"* and the agent adjusts.

The chat panel becomes a first-class surface that can:
- **Answer** questions about the recording ("what did I demo at 2:30?")
- **Edit** the video (agentic — calls editing tools)
- **Repurpose** it (generate a short, a GIF, a caption set)
- **Teach** the app ("how do I add a zoom?" → and offers to do it)

---

## 4. The core we're building — the "Recording Brain"

This is the real technical contribution and the thing everything else depends on. After a recording, we build **one structured semantic timeline** by fusing three signals:

| Signal | Source | Gives us |
|---|---|---|
| Transcript | whisper.cpp (already integrated) | words + timestamps, silences, filler words, sentence/topic boundaries |
| Interaction stream | native cursor monitor (already integrated) | clicks, typing, scrolls, "user interacted here" moments |
| Scene understanding | sparse frame sampling → vision model | semantic labels: "settings open," "pricing page," "code editor visible" |

Fuse these into a JSON timeline of **moments**, each with a time range, a description, and tags (silence / filler / click / scene-change / important). **Every AI feature becomes a query over this structure.** Build it once; the rest is cheap.

---

## 5. What we're adding to the product (as a whole)

Tiered so the team can see what's flagship vs. nice-to-have.

### Tier 0 — Foundation (build first)
- **The Recording Brain / semantic timeline** (Section 4). Nothing else works without it.

### Tier 1 — Flagship (the "wow")
- **Conversational edit agent ("Quiro Director").** Chat → tool calls → regions update live.
- **One-click auto-edit ("magic first draft").** Before any chat, AI generates a first pass automatically: silence removal, filler-word cuts, auto-zoom on clicks, speed-ramp idle stretches. The instant-gratification moment.

### Tier 2 — Moat (depth that makes it real, not a toy)
- **Text-based editing.** Show the transcript; delete a sentence → the video cuts that span. Natural for narration-heavy screencasts.
- **Auto-repurpose / one-to-many export.** "Turn this into a 30s vertical short, a README GIF, and a thread with timestamps." One recording → many assets.
- **AI voiceover & translation.** Clean up audio (remove ums/pacing) or re-voice the demo in another language with TTS + re-captioning. (Screen demos show no face → re-voicing Just Works.)

### Tier 3 — Polish (cheap generations off the Brain)
- Auto chapters, auto title, auto thumbnail, auto callout annotations on the active UI element.
- **In-editor copilot** that answers "how do I…" questions and can perform the action.

---

## 6. How it fits our architecture (no rewrites)

- **Tools = existing region handlers.** Expose `window.tsx` handlers (`handleZoomDepthChange`, trim/clip/speed/caption/annotation mutations) as a tool schema. The agent is *just another caller* of the same state, so the performance-critical playback path is untouched.
- **API key lives in the main process.** Chat panel (renderer) → IPC → main process calls Claude → tool calls return → renderer mutates regions. This is exactly our existing `electron/ipc/` pattern. Adding the channel touches: handler, register file, `preload.ts`, and **both** `electron-env.d.ts` files (per CLAUDE.md).
- **Reuses what's already there.** whisper for transcript, cursor monitor for interactions, region system for edits, media servers for frames. New surface = chat UI + agent loop + the Brain builder.
- **Does not break playback.** No per-frame React state, no new inline props on the memoized `SettingsPanel` / `TimelineEditor`. Agent edits are batch state updates, not high-frequency ones.

---

## 7. Why we're different (competitive framing)

| | Loom | Screen Studio | **Quiro (this vision)** |
|---|---|---|---|
| Auto-zoom | partial | manual/auto, but mechanical | **AI zooms based on what you *did* (clicks) and *said*** |
| Understands content | no | no | **yes — transcript + interactions + vision** |
| Edit by talking | no | no | **yes — conversational agent** |
| One-click polished first draft | limited | no | **yes** |
| Repurpose to many formats | no | no | **yes** |

The category has *auto* features. **Nobody has an agent that understands the recording and edits it conversationally.** That's the wedge.

---

## 8. Hackathon scope (MVP — what we actually demo)

Don't build all of Section 5. The winning slice:

- ✅ **Recording Brain** (transcript + click stream + a few vision frames → moments JSON)
- ✅ **Chat agent with 3 tools:** auto-zoom-on-click, silence/filler trim, captions
- ✅ **One "magic first draft" button**
- ✅ **A rehearsed 90-second live demo**

Everything else becomes "…and it also does X" in Q&A. Transformation in the demo beats a long feature list.

---

## 9. Tech approach

- **Agent:** Claude API with **tool use** (function calling). Tools map 1:1 to region operations.
- **Models:** **Opus 4.8** (`claude-opus-4-8`) as the planning/agent brain; **Haiku 4.5** (`claude-haiku-4-5`) for cheap high-volume classification (per-segment "silence / filler / important?"). **Stream** the chat for a live feel.
- **Vision:** sample ~1 frame / few seconds; send to Claude for scene labels (used to build the Brain, not per-frame).
- **Security:** API key in main process only; never expose to renderer.

---

## 10. The demo (how we win the room)

1. Record a deliberately messy ~3-minute screencast live (with pauses, "ums," idle time).
2. Type **one sentence** of intent.
3. Watch the timeline build itself: zooms snap to clicks, dead air collapses, captions appear.
4. One conversational refinement ("make the intro shorter").
5. Export → show the polished result.

**Narrative:** *"Editing a screen recording takes 10× the recording time. Quiro does it while you talk."*

---

## 11. Risks & open questions

- **Latency.** The agent loop + vision passes must feel fast. Mitigation: build the Brain async right after recording; use Haiku for bulk classification; stream the chat.
- **Edit quality / trust.** AI edits must be *previewable and reversible* — never a black box. Show the diff on the timeline; everything is an undoable region.
- **Vision cost/volume.** Keep frame sampling sparse; cache scene labels in the Brain.
- **Open:** Hackathon **timeframe**? Judging **criteria / theme** to optimize the pitch toward? Voice input for the chat, or text-only for v1? Online (cloud API) vs. any offline constraints?

---

## 12. Suggested workstreams (team split)

- **A — Recording Brain:** transcript + cursor/click capture + frame sampling → moments JSON.
- **B — Agent & tools:** tool schema over region handlers, IPC channel, agent loop, streaming.
- **C — Chat UI & "magic first draft" button:** the surface users touch.
- **D — Demo & pitch:** script, recording, slides, narrative.

---

_This is a living doc — edit freely and bring questions to the team sync._
