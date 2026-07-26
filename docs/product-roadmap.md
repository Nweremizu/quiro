# Quiro Product Roadmap

Status: agreed 2026-07-26. Supersedes the roadmap sections of `ai-sprint-plan.md`
(which remains valid as the AI implementation reference).

This document exists to stop re-litigating settled questions. Each decision below
records *what* was chosen and *why*, so a future disagreement can attack the
reasoning rather than re-run the debate.

---

## 1. Locked decisions

### D1 — This is a product roadmap, not a hackathon plan
Foundations over demo. No hardcoding for stage effect, no features whose only
value is a wow moment. Evidence this is the right frame: v1.2.2 is shipped to
real users, and current in-flight work is export correctness, GIF encoding, and
keyboard shortcuts across eight locales — maintenance and polish, not demo work.

### D2 — Configurable-first
Deep control stays the primary UI. Presets are starting points, not replacements.
`cursorSpringStiffnessMultiplier` and friends stay visible.

**Consequence:** beginner accessibility cannot come from simplifying the panel,
so it has to come from somewhere else. See D3.

### D3 — The agent is the novice surface; named looks make it repeatable
Novices don't touch the settings panel — they describe what they want and the
agent moves the knobs. Power users keep the sliders. Two audiences, one codebase,
no Simple/Pro toggle.

This also resolves the agent's vocabulary problem: an agent setting
`cursorSpringDampingMultiplier: 0.83` is guessing; an agent applying a curated
named look is choosing from validated states.

**Consequence:** the agent is now load-bearing, not a bonus feature. Its
reliability matters more than its cleverness. See D9.

### D4 — Refactor only what a feature forces
No speculative architecture work. The `projectStore` inversion happens inside
Phase 2 because named looks genuinely require atomic multi-field apply — not
before, and only for the fields looks touch.

Note: two arguments commonly made for the store inversion are already solved
in-repo and should not be re-raised as justification. Undo/redo exists
(`editor-window/history.ts`, with tests), and the agent already batches a run
into one undo step via `beginAiBatch`/`endAiBatch`. `EditorActions` is
deliberately semantic (ten domain methods), not field-level — that is the
correct design and should stay.

**Prerequisite:** the duplicate settings-panel sections
(`settings-panel/CursorSection.tsx` vs `settings-panel/sections/CursorSection.tsx`,
and the same for Captions/Crop/Frame/Webcam/Zoom) must be resolved before feature
work, or every phase re-resolves the same conflict.

### D5 — Local-only core, pluggable user-owned destinations
No Quiro backend. No accounts, no share pages, no stored user data. Shareable
links come from the *user's own* provider — their Drive, their S3, a watched
folder, YouTube.

**Why not full cloud:** it is a second product (auth, storage, share pages,
privacy policy, GDPR, billing, abuse handling, on-call), it would consume the
entire roadmap for two people, and it competes on the incumbent's strength.
Screen Studio is the proof case for the other direction.

**Why not pure local:** "capture → paste a link in Slack" is the most common
screenshot job in the world, and it would be missing.

Ship exactly one destination adapter first. Each provider is ongoing maintenance
liability when their API shifts.

### D6 — Windows-first, double down
All native work targets Windows. Mac and Linux stay best-effort (TS branches
exist; no native helpers).

**Why:** Screen Studio — the output-quality benchmark — is macOS-only. There is
no beloved, taste-led, beautiful-output screen recorder on Windows. That is an
achievable #1 position. Existing sunk advantage is all Windows: `wgc-capture`,
`cursor-monitor`, `quiro-gpu-export`, `quiro-nvidia-cuda-compositor`,
`hud-topmost-guard`.

**Known risk, accepted:** the audience that cares most about beautiful demos
skews Mac. If buyer research contradicts this, D6 is the decision to revisit
first, and it reshapes several months of work.

### D7 — Output accessibility is a headline feature; app a11y is a floor
Two different things were previously bundled under one word.

- **Headline (build):** the *produced video* is legible to every viewer —
  contrast validation, minimum text size, caption quality, reduced-motion export.
  Nobody in this category ships this. It converges with the vision self-check
  (D9), so it is one mechanism serving two goals.
- **Floor (maintain):** keyboard navigation, visible focus rings, correct labels
  on icon buttons. Currently 146 `aria-*` and 18 `role=` across components.

**Explicitly out:** screen-reader support for the PixiJS timeline. That is
inventing an accessible-canvas-NLE pattern that does not exist in the industry,
for months of work and a very small affected population.

### D8 — Full screenshot product, still-source path first
Screenshots are in scope at full scope: capture, editor integration,
annotations, OCR, Quick/Studio, PNG export, destinations.

**Why it fits the Windows thesis:** the beautiful-screenshot field is
macOS-heavy (CleanShot X, Shottr, Xnapper). On Windows it is ShareX (powerful,
ugly), Snagit (dated), and Snipping Tool (basic). Same hole, same reason. Quiro
already owns the renderer that wins it.

**Cheap because three of four hard parts exist:** `wgc-capture.exe` ships
already, Pixi already accepts still textures (`Texture.from(canvas)` /
`Texture.from(img)` alongside `VideoSource.from(video)`), and all visual config
is already in `ProjectEditorState`.

**Design rule — do not fork the document.** `ProjectEditorState` describes
*appearance*; the source is separate. Widen `EditorProjectData.videoPath` into a
`ProjectSource` discriminator. A screenshot project is the same state object with
empty region arrays. Cap's screenshot editor reuses its `ProjectConfiguration`
verbatim; do the same.

### D9 — Agent: trust before capability
Preview, confirm, explain, revert — before planning loops.

**Why:** the agent currently applies edits directly with no preview or change
summary; recovery is undo-only. A power user notices a bad edit and undoes it. A
novice — the audience D3 assigned here — will not notice, will export it, and
will conclude Quiro produces mediocre output. Output quality is the moat, so the
novice path cannot have an unchecked gap between "model guessed" and "user
exports."

Vision self-check is **promoted** out of the capability bucket because it is the
only mechanism that lets the agent catch its own bad output, and it is the same
implementation as D7's checks.

Multi-turn planning is **deferred** — real per-turn latency and cost for a
feeling of sophistication.

### D10 — Motion quality is the investment; composition is packaging
Where premium output comes from.

**Why motion:** it is the least copyable thing available. Backgrounds and frames
are a weekend's work and a competitor can match them from a feature list. Camera
motion that feels right is taste applied over many iterations. It is also
literally what "smooth" means in the differentiation thesis, the machinery
already exists (camera springs, cursor springs, `zoomMotionBlur` with sample
count and shutter fraction, three easing slots), and it is what makes D2 and D12
pay off — a preset is only valuable if the values inside it took weeks to get
right.

**Not capture fidelity:** capture is pinned at 60fps and MP4 export caps at 60.
That is correct for screen content. The gap is what happens after capture.

### D11 — Phase 0 closes the in-flight work first
29 uncommitted files. Assessed as coherent, near-done work — not exploratory —
so this is days.

### D12 — Looks are built-ins plus user-save; BrandKit is a separate layer
**Structural rule, held firmly:** brand identity is a separate persisted layer,
never a field inside a look. A user has *one* brand and *many* looks. Embedding
logo/colors/fonts in a look means switching looks wipes branding and every new
look re-enters it. `BrandKit` lives in `<userData>`; looks reference brand tokens.

The moat is the taste in the built-ins, not the save/load mechanism. Eight looks
that feel genuinely expensive beat infinite save slots. Shareable look *files*
are deferred — costless to add later if looks are plain serializable objects.

### D13 — Symmetric Quick/Studio, reversible
Both recording and screenshots get a fast path.

- **Quick:** stop → render with active look → file + destination. Editor never opens.
- **Studio:** stop → editor.

**Reversible, which is where this beats Cap:** Quick still writes a project
alongside the output, and the completion toast carries an **Edit** button. The
up-front mode choice stops being irreversible; Quick can be the default.

**Honest asymmetry to reflect in copy:** Cap's Instant Mode is truly instant
because upload overlaps recording. Local-only cannot do that — a Quick *video*
still needs a render pass. Quick means *no editor interaction*, not *no wait*.
Screenshots are instant; recordings are not. Do not imply otherwise.

### D14 — Monetization deferred, seam reserved
No activation or licensing work in this roadmap. You cannot price polish that
does not exist yet, and a license check on a local-only desktop app is a late,
shallow addition (unlike cloud, where auth is foundational).

**Do now, five lines:** a single `isPro()` returning `true` unconditionally.
Route any future gate through it. Cap's entire licensing model is one function
with a self-host escape hatch on the first line, which is why it stayed
changeable.

---

## 2. Phases

### Phase 0 — Close the loop *(days)*

- [ ] Land the native GIF encoder migration (`gif-exporter` → `nativeSessionId`); keep the smoke test
- [ ] Commit the `KeyframeMarkers` removal (timeline −83 / window +87)
- [ ] Land shortcuts + the 8 locale files
- [ ] **Resolve duplicate settings-panel sections** (×6) — prerequisite for everything
- [ ] Add `isPro()` returning `true`; route nothing through it yet
- [ ] Cut v1.3.0

### Phase 1 — Motion quality *(the moat)*

- [ ] **Clip transitions** — crossfade + fade-through-black, minimum-duration floor. Confirmed absent from `types/editor.ts` and `timeline/`.
- [ ] **Glide/drift while zoomed** — slow parallax so a held zoom reads as camera work, not a static crop
- [ ] **Instant-zoom option** — bypass easing for hard cuts
- [ ] **Camera/zoom motion presets** — extend the proven `cursor-motion-presets.ts` + `MotionPresetCards` pattern
- [ ] **Spring/easing tuning sweep** — the actual taste work; iterate until *untouched* output looks expensive
- [ ] **`edgeSnapFocus` tuning pass** — already exists (`videoPlayback/focusUtils.ts:141`); validate across all 6 zoom depths
- [ ] **`motionSmoothing.ts` audit** — verify it earns its place

### Phase 2 — Looks & Brand Kit *(packaging)*

- [ ] `Look` type — plain serializable subset of `ProjectEditorState`
- [ ] **`projectStore.patch()`** — the D4 feature-forced refactor. Migrate only the ~30 fields looks touch. Object-valued fields must keep referential identity when unchanged or every subscriber re-renders.
- [ ] **8 built-in curated looks** — where Phase 1's tuning reaches users
- [ ] Save-current-as-look
- [ ] **`BrandKit`** in `<userData>` — logo, colors, fonts; looks reference tokens
- [ ] Look picker in the settings panel — starting points, not a replacement (D2)
- [ ] **Document migration chain on load** — field-level default differs from struct default so unversioned files self-identify as legacy; migrate at load, never in a batch job

### Phase 3 — Agent trust

- [ ] Plan preview before apply, with apply-on-confirm gate
- [ ] Plain-language change summary — "added 4 zooms on your clicks, trimmed 12s of silence"
- [ ] Per-edit revert, finer than the existing whole-run `beginAiBatch`
- [ ] **Vision self-check tool** — read the preview frame, self-correct focus/framing
- [ ] Deterministic no-model fallback ("magic first draft")
- [ ] **`apply_look` tool** — closes the vocabulary gap from D3
- [ ] Style memory — deferred until looks exist

### Phase 4 — Output accessibility *(headline)*

- [ ] Contrast check: captions/annotations against the actual composited background
- [ ] Minimum-readable-text-size warning, scaled to export resolution
- [ ] Caption quality presets — `AutoCaptionSettings` is already rich (incl. `inactiveTextColor` for word highlighting)
- [ ] **Reduced-motion export variant** — a real problem given zoom is the signature feature
- [ ] Pre-export check panel, sharing Phase 3's vision mechanism
- [ ] App a11y floor: keyboard nav, visible focus rings, icon-button labels

### Phase 5 — Screenshot product *(full)*

- [ ] **5a** `ProjectSource` discriminator · still branch at `Texture.from` · time-UI gating · PNG export
- [ ] **5b** WGC single-frame capture · region/window/fullscreen selection (reuse capture-area logic)
- [ ] **5c** Quick/Studio for screenshots · settings: save location, format, auto-copy
- [ ] **5d** Screenshot annotation tooling — arrows, numbered steps, redaction
- [ ] **5e** OCR via Windows.Media.Ocr — copy text, redact detected PII

Note for 5a: `AnnotationRegion` carries `startMs`/`endMs`, `keyframes`, and
`animation`. In still mode these must be **ignored at the visibility check**, not
zeroed — zeroing corrupts the project if the source is ever swapped.

### Phase 6 — Modes & destinations

- [ ] Quick/Studio for recording: render-on-stop with active look, project written alongside, **Edit** in the toast
- [ ] One destination adapter — watched folder or Drive
- [ ] Honest copy about the render wait (D13)

---

## 3. Explicitly not doing

- Cloud, accounts, share pages, view analytics, billing
- macOS native helpers
- Screen-reader support for the PixiJS canvas
- Multi-turn agent planning loop (latency/cost, deferred)
- Monetization infrastructure
- Capture-fidelity work — 60fps is correct for screen content
- Big-bang `projectStore` rewrite

---

## 4. Open

1. **Bug backlog from v1.2.x users** — unknown. The only thing that could resize Phase 0.
2. **Which destination adapter first** — watched folder or Drive.
3. **Latency budget for vision self-check** — gates Phase 3's design. Flagged undecided since 2026-07-08.
