# Text engine — one model, one measurement authority

Plans for replacing the two independent text systems with a shared content model
and a single layout engine, so that the thing which decides where a glyph lands
exists exactly once.

Scope is **screenshot annotations and video text segments**. Captions
(`rendering/src/layers/captions.rs`, 1233 lines) are a third text path and stay
out; they carry their own timing and per-word emphasis concerns that do not fit
the model here. They are the obvious next candidate once this set lands.

Context: [`docs/canvas-unification.md`](../../docs/canvas-unification.md) for the
architecture, and
[`docs/research/penpot-text-system.md`](../../docs/research/penpot-text-system.md)
for the prior art — a design tool that solved the same problem, whose answers
are cited throughout and whose complexity is deliberately *not* copied
wholesale. Section 11 of that note maps what was adopted against what was
rejected, plan by plan.

Audited against `main` @ `6c4370f`.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 000 | [One `TextContent` model for annotations and text segments](000-text-content-model.md) | HIGH | TODO |
| 001 | [`quiro-text`: one layout engine, no consumers](001-quiro-text-crate.md) | HIGH | TODO |
| 002 | [Move video text onto the engine and delete the `1.05` hack](002-video-text-on-engine.md) | HIGH | TODO |
| 003 | [Fragments over IPC, and the font bytes that make them true](003-fragments-ipc-fonts.md) | HIGH | TODO |
| 004 | [Rich text editing for annotations](004-annotation-text-editor.md) | MEDIUM | TODO |

## Execution order

**000 → 001 → 002 → 003 → 004** is a straight line. Each one leaves the app
shippable, and the first two change no behaviour at all.

- **000 first.** It is the only data change, and everything else reads the model
  it defines. Additive: the legacy `text` / `content` fields stay, nothing reads
  `text_content` yet, so a build carrying only 000 can be downgraded.
- **001 next, with no consumers.** The engine is built and tested standalone.
  The cost of that choice is an API designed without a caller pushing back, so
  every snapshot test is sourced from a **real migrated case** from one of the
  two hosts rather than invented.
- **002 is the first consumer and the smallest one.** The video renderer already
  paints text and already holds the buffers, so it needs none of the fragment
  format, none of the IPC, and none of the font transfer. It proves the engine
  end to end, deletes the `1.05` hack, and stops the per-frame re-shaping.
- **003 is the keystone.** It is where the frontend stops measuring: the
  fragment wire format, the `measure_text` command and the font-byte transfer
  all land together, because none of them is useful alone.
- **004 last.** Pure feature work on a proven base — the editor, the panel, the
  halo, and the undo fix. It is also where the legacy fields are finally deleted.

## The three findings that drove this set

1. **Two engines measure the same string, and the renderer compensates.**
   `rendering/src/layers/text.rs:75` shapes 5% + 4px wider than the box it was
   given because *"the webview and cosmic-text can disagree by a few pixels per
   line, and without slack a line that fit in the editor wraps in the render"*.
   The slack is then threaded through `TextBounds` and the buffer origin — three
   places serving one disagreement. Plans 001, 002.

2. **Annotation text has no typography and is drawn twice in TypeScript.**
   `annotation.height` *is* the font size; the panel offers one slider; the text
   is emitted as SVG at `AnnotationLayer.tsx:1108` and again as
   `ctx.fillText` at `screenshotExport.ts:517`, both with a hardcoded
   `sans-serif`. Plans 000, 003, 004.

3. **Two properties are hardcoded in the renderer rather than stored.**
   `layers/text.rs:120` sets `Align::Center` on every line and `:81` sets
   `line_height` to `font_size * 1.2`. Neither exists in the data model, so
   every video title in every existing project is centred by accident rather
   than by choice — which is why 000's migration writes `Center` explicitly
   while the model's default is `Left`. Plans 000, 002.

## Design decisions worth restating

- **cosmic-text is the only measurement authority.** Rust paints video text;
  the frontend paints annotations from returned fragments and never re-measures.
  Annotations stay frontend-composited because a drag must cost a compositor
  transform rather than a render and a frame over a socket (`context.tsx:88`).
- **The DOM edits, it does not measure.** That removes the class of hack Penpot
  needs (forcing paragraph `font-size: 0` to fix browser height measurement) and
  is what makes a `contentEditable` round-trip affordable.
- **Font size is px against a 1080-tall anchor**, with the anchor being
  `Capture` for annotations and the frame for segments. One formula; segments
  need no conversion because that is already what they do.
- **Rust ships the resolved face bytes to the webview.** Generic-family pinning
  (`layers/mod.rs:30`) covers three names; this covers every name, and is what
  makes precisely-positioned fragments safe.
- **Fragments are derived state**, held in workspace state and regenerated on
  load and commit — never written to the project file.

## Deliberately not planned

- **Captions.** A third text path with its own timing model. Unifying it is
  worth doing and is not worth doing now; the model here has no concept of
  per-word timing and inventing one before a caller needs it would be guesswork.

- **Typography library assets.** Penpot's `typography-ref-id` / `-file` with
  library sync is a whole subsystem — asset CRUD, staleness tracking, remapping
  on cross-file paste, detach-on-edit. There is no library concept in this
  product to hang it on.

- **Gradient and multi-fill text.** Penpot supports up to eight fills per span
  and pays for it with a 160-byte-per-fill wire format and a separate SVG paint
  pass per layer. One colour per run, plus the halo, covers the actual use.

- **RTL as a UI control.** No direction picker, no bidi controls. Note that RTL
  still *lays out* correctly for free — cosmic-text runs bidi regardless and
  `LayoutRun` carries `rtl` — so 001 carries the flag through to the fragment
  and 003's painter anchors RTL fragments at `x + width`. The correctness is
  free; only the control is skipped.

- **Refactoring `Annotation` into a tagged enum.** 000 takes it to sixteen
  optional type-specific fields with a hand-written `validate()` holding the
  invariant. An `AnnotationKind` enum would delete `validate()` outright and let
  the type system carry it. It is the right change and it is a migration plus a
  sweep of every consumer in two languages — separate work, not a rider on this.

- **Collapsing `ParagraphSet`.** The model keeps Penpot's four levels, and the
  paragraph-set level carries nothing in Penpot either — its schema forbids
  styles on it and a migration exists to strip fills off it. Every document will
  have exactly one. Flagged in 000 and 004; if it is going to go, it should go
  before 004 hardens the DOM round-trip around it.
