# 003 — Fragments over IPC, and the font bytes that make them true

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Depends on:** 001 · **Blocks:** 004

## Problem

Annotations are drawn by the frontend, twice, from a flat string — on screen as
SVG and again at export in Canvas2D:

```tsx
// AnnotationLayer.tsx:1108
<text x={annotation.x} y={annotation.y + annotation.height}
      fontSize={`${annotation.height}px`} fontFamily="sans-serif">
  {annotation.text}
</text>

// screenshotExport.ts:517
ctx.font = `${ann.height}px sans-serif`;
ctx.fillText(ann.text, ann.x, ann.y + ann.height);
```

Neither can wrap, neither knows about runs, and both measure with whatever the
webview resolves `sans-serif` to. That is the third measuring authority.

The obvious fix — have Rust paint annotations too — is wrong here. Annotations
are deliberately frontend-composited so a drag costs a compositor transform
rather than a GPU render and a full frame over a socket (`context.tsx:88`).
Moving them into the renderer would undo that.

### The font problem this exposes

`rendering/src/layers/mod.rs:30` keeps the two sides agreeing by pinning
fontdb's generic families to whatever the webview resolves them to, per platform:

```rust
#[cfg(windows)]
{
    // WebView2 (Chromium): sans-serif → Arial, serif → Times New Roman, …
    db.set_sans_serif_family("Arial");
}
```

That covers three generic names. `Family::Name(anything_else)` is a coin flip —
fontdb may resolve a family the webview does not have, or pick a different face
for the same name, and cosmic-text then shapes with a silent fallback. Once the
frontend paints fragments Rust measured, a mismatch is no longer a slightly
different line break; it is precisely-positioned boxes containing the wrong
glyphs.

## Change

Rust measures. The frontend paints what it is given and never re-measures.

### The command

```rust
#[tauri::command]
#[specta::specta]
pub async fn measure_text(
    content: TextContent,
    constraint: Constraint,
) -> Result<TextLayoutResult, String>;

pub struct TextLayoutResult {
    pub fragments: Vec<Fragment>,
    pub width: f32,
    pub height: f32,
    pub faces: Vec<FaceId>,   // referenced by the fragments
}
```

Called on commit, not per keystroke — 004 owns that policy. The `buffers` half
of `TextLayout` stays on the Rust side; only fragments cross.

### Font bytes cross the boundary

fontdb resolves the family; Rust hands the frontend the exact face it shaped
with, and the webview registers it.

```rust
#[tauri::command]
pub async fn font_face_bytes(id: FaceId) -> Result<Vec<u8>, String>;
// db.with_face_data(id, |bytes, _index| bytes.to_vec())
```

```ts
const face = new FontFace(`quiro-face-${id}`, bytes);
await face.load();
document.fonts.add(face);
```

`font_family` on the wire is a face id, not a family name. The webview paints
with provably the same face cosmic-text shaped with, for arbitrary family names
and not only the three generics. Generic pinning stays as a fallback for
anything that fails to load, rather than being the mechanism.

Cache by face id — a face is fetched once per session. Bytes are 100 KB–5 MB, so
send them over the existing frame socket or the asset protocol rather than
base64 through `TAURI_INVOKE`.

The same registered faces serve 004's `contentEditable`, which is what keeps the
commit-time reflow small.

### Painting fragments

SVG, on screen. One `<text>` per fragment, positioned absolutely, no wrapping and
no font resolution in the browser:

```tsx
{fragments.map((f, i) => (
  <text key={i}
        x={f.rtl ? f.x + f.width : f.x}
        y={f.y}                        // baseline — LayoutRun.line_y
        textLength={f.width}
        lengthAdjust="spacingAndGlyphs"
        dominantBaseline="alphabetic"
        style={{
          fontFamily: `quiro-face-${f.fontFace}`,
          fontSize: `${f.fontSize}px`,
          fontWeight: f.fontWeight,
          fontStyle: f.italic ? "italic" : "normal",
          textDecoration: f.decoration,
          fill: f.color,
          whiteSpace: "pre",
        }}>
    {f.text}
  </text>
))}
```

`textLength` bounds the residual risk: the browser still distributes glyphs
*within* a fragment, so a metric difference is absorbed as tracking inside one
box rather than accumulating across the line.

Canvas2D, at export, from the same array:

```ts
for (const f of fragments) {
  ctx.font = `${f.italic ? "italic " : ""}${f.fontWeight} ${f.fontSize}px "quiro-face-${f.fontFace}"`;
  ctx.fillStyle = f.color;
  ctx.textAlign = f.rtl ? "right" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(f.text, f.rtl ? f.x + f.width : f.x, f.y);
}
```

Both paths consume one array. The alignment, wrapping and vertical-align maths
exist in exactly one place — `quiro-text` — and neither painter reimplements
any of it.

### Hit-testing stays glyph-accurate

SVG hit-tests painted geometry, so `pointerEvents: "all"` on the `<g>`
(`AnnotationLayer.tsx:651`) gives glyph-accurate hover for free — the thing
Penpot needs an `intersect_position_in_text` FFI call for, because it paints to
a canvas that has no hit-testing.

**Ship Penpot's exemption with it.** With glyph-accurate hit areas, clicks fall
through the gaps between letters, so the first click of a double-click on an
already-selected text reselects whatever is underneath. The rule: a text that is
already selected hit-tests on its box, not its glyphs.

### Where fragments live

On the annotation in workspace state, not in the project file. They are derived
from `text_content` plus the anchor rect and are regenerated on load and on
every commit — the same posture the research document describes for Penpot's
`position-data`, which is invalidated aggressively for exactly this reason.

## Files

- `apps/desktop/src-tauri/src/screenshot_editor.rs` — `measure_text`,
  `font_face_bytes`
- `apps/desktop/src/utils/tauri.ts` — regenerated bindings
- `apps/desktop/src/routes/screenshot-editor/context.tsx` — fragments in state,
  regenerated on load and commit; face registration cache
- `apps/desktop/src/routes/screenshot-editor/AnnotationLayer.tsx` — `case "text"`
  paints fragments; already-selected box exemption
- `apps/desktop/src/routes/screenshot-editor/screenshotExport.ts:515` — the
  `fillText` branch paints fragments
- `apps/desktop/src/routes/screenshot-editor/space.ts` — fragments are frame px;
  they get a `Rect<FramePx>` and go through the existing conversions

## Acceptance

- `grep -n "sans-serif" apps/desktop/src/routes/screenshot-editor/` returns
  nothing outside a fallback path.
- Export and on-screen rendering of the same annotation are pixel-identical
  within antialiasing — both consume the same fragment array.
- A text annotation using a family that is **not** one of the three generics
  renders identically in the webview and in the renderer. This is the case
  generic pinning could never cover, and the reason for the byte transfer.
- Resizing an auto-height annotation re-wraps at the new width and the exported
  PNG wraps at the same place.
- Dragging a selected text annotation still costs no renderer frame — check the
  config revision does not advance during a drag.
- Double-clicking an already-selected text enters edit mode rather than
  selecting the capture underneath.

## Risks

- **`textLength` distorts.** It forces the browser to hit the measured width, so
  a real metric mismatch shows up as visibly loose or tight tracking rather than
  as a wrong line break. Better than the alternative, but it means a font that
  fails to register degrades to *ugly* rather than to *obviously broken* — which
  is harder to notice. Log a warning when a face fails to load.
- **Face bytes over IPC.** A 5 MB CJK face base64'd through `TAURI_INVOKE` will
  be felt. Use the socket or the asset protocol, and fetch lazily per face.
- **Fragments are stale between commit and response.** The frontend paints the
  previous fragments while `measure_text` is in flight. Bound it: 004 keeps the
  `contentEditable` on screen during editing, so the only visible window is the
  commit itself.
- **Font licensing.** Bytes stay on the machine that already has the font
  installed and are not written into exports or project files. Worth stating
  explicitly somewhere, because "we ship the font bytes" reads worse than it is.

## Outcome

**Done, Rust and TypeScript both.** The bindings blocker below resolved
mid-session (a `quiro-desktop.exe` already running on the machine had
regenerated `tauri.ts` on its own debug-mode startup); the `quiro-enc-ffmpeg`
clippy blocker was fixed directly (see its own section, no longer
hypothetical). A real, previously-undetected bug in `quiro-text` — not
mentioned in the plan, found while building the frontend half — is also
fixed here; see "The anchor-height bug" below.

`apps/desktop/src-tauri/src/screenshot_editor.rs` gained `measure_text` and
`font_face_bytes`, registered in `lib.rs`'s `specta_bindings()`, plus a local
`TextLayoutResult { fragments, width, height, faces }` (`quiro_text::TextLayout`
minus `buffers`, matching the plan's own struct exactly) and a `#[cfg(test)]`
module with 3 async tests exercising both commands directly as plain
functions (they take no `AppHandle`/`Window`, so this needs no running app).
`quiro-desktop` gained a `quiro-text` path dependency it didn't have before.

### `FaceId` cannot be `fontdb::ID` — the plan's own sketch assumed it could

The pseudocode's `Fragment.font_face: FaceId` and `font_face_bytes(id: FaceId)`
both assume `FaceId` (aliased to `cosmic_text::fontdb::ID` since 001) can cross
IPC as-is. It can't, for two independent reasons discovered while wiring the
command: `fontdb::ID` has no `Serialize`/`specta::Type` impl, and — more
fundamentally — its internal representation is a private `slotmap` key with
no public constructor from a raw integer (only `ID::dummy()`, which hardcodes
`u64::MAX`). Even adding the derives by hand would not help: a `FaceId` the
frontend sent back to `font_face_bytes` could never be reconstructed into a
real `fontdb::ID`, because nothing outside `fontdb` itself can build one.

Resolved by making `quiro_text::FaceId` its own registry-backed newtype
(`packages/crates/text/src/fragment.rs`) — a `u64` wire id, `pub(crate)` field
so only this crate can mint one — backed by a `FaceRegistry` (`to_wire`/
`to_real` maps plus a counter) that lives on the same `Engine` as the shared
`FontSystem`, so a `FaceId` always resolves against the database that named
it. `extract_fragments` interns the real `fontdb::ID` the moment it builds
each `Fragment` (`compute()` now threads `&mut FaceRegistry` down from
`layout_text`'s lock, alongside the `FontSystem` it already threaded); a new
public `quiro_text::face_bytes(id: FaceId) -> Option<Vec<u8>>` resolves a wire
id back to the real one and calls `Database::with_face_data`. This keeps the
plan's own shape intact for every caller (`Fragment.font_face` is still just
a field a painter reads) — the registry is invisible outside `quiro-text`.
`quiro-text` picked up `serde` and `specta` as real dependencies as a result
(previously only `serde_json`, for the cache key); `Constraint` and `Fragment`
both gained `Type, Serialize`(`, Deserialize` on `Constraint`, which crosses
as a command *parameter*) to make the whole chain IPC-safe.

3 new tests in `quiro-text` (20 total, all passing) cover this directly:
a fragment's `font_face` resolves to non-empty bytes
(`a_fragments_font_face_resolves_to_bytes`), the same face referenced from
two different layouts interns to the same id
(`the_same_face_interns_to_the_same_id` — the property a webview's `FontFace`
cache depends on to register each face exactly once), and an id this process
never minted resolves to nothing rather than another face's bytes
(`an_unknown_face_id_resolves_to_nothing`). `quiro-desktop`'s 3 new tests
mirror the same properties one layer up (`measure_text` returns exactly the
faces its fragments reference; `font_face_bytes` resolves one of them; a
forged id — built via `serde_json::from_str`, the only way to construct a
`FaceId` from outside the crate — is rejected) but cannot actually run in
this environment: the whole `quiro-desktop` test binary fails at process
startup with `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139), the identical,
already-documented WebView2/native-DLL issue from 002's Outcome, unrelated to
this plan's logic. `cargo check -p quiro-desktop --tests` compiles them
cleanly; run them for real on a machine without that blocker.

### `quiro-enc-ffmpeg`'s clippy blocker — fixed, not worked around

`cargo clippy -p quiro-desktop -- -D warnings` used to fail before it ever
reached this plan's code: `quiro-enc-ffmpeg` (a transitive dependency, three
hops from anything this plan touched) had 11 dead-code findings in
`packages/crates/enc-ffmpeg/src/video/h264.rs`. Root cause: NVENC/QSV/AMF
hardware-encoder threshold constants and `estimate_hw_encoder_max_fps` were
gated `#[cfg(any(target_os = "macos", target_os = "windows"))]`, but
`requires_software_encoder`'s existing Windows branch already forces
`libx264` unconditionally (its own pre-existing `ponytail:` comment says so)
rather than calling that function — so on Windows specifically, the whole
group compiled but was never reached. Narrowed every gate to
`#[cfg(target_os = "macos")]`, matching the real caller instead of an
anticipated one; widen back to `any(macos, windows)` if Windows hardware
encoder selection is ever wired up. One more finding in the same crate
(`remux.rs:1163`, an `as u64` cast onto an already-`u64` expression) was
trivial and fixed alongside it. `quiro-rendering` had 3 of its own
pre-existing findings (two NaN-unsafe negated comparisons in
`zoom_spring.rs`, one dead `..Default::default()` in `lib.rs`) fixed the same
way, using the exact NaN-preserving rewrite pattern already established in
000's Outcome. `quiro-desktop`'s clippy run still surfaces ~41 further
findings, but all `#[cfg(windows)]`-only dead code across a dozen files this
session never touched (`fake_window.rs`, `power_observer.rs`,
`permissions.rs`, `windows/commands.rs`, and more) — CI runs clippy on
`ubuntu-latest`, so a Windows-only `--all-targets` pass had apparently never
been run clean before. Left alone at the user's explicit direction: a large,
unrelated backlog, not a regression from this plan.

### The bindings blocker, and how it actually resolved

Same root problem as 002: `apps/desktop/src/utils/tauri.ts` only regenerates
via a full `#[cfg(debug_assertions)]` desktop launch, and the `quiro-desktop`
test binary that could otherwise run the same export without a window fails
to even start in this environment (`STATUS_ENTRYPOINT_NOT_FOUND`,
0xc0000139). Extensive further investigation this session — comparing the
working main `.exe`'s and the failing test binary's full import tables via
`dumpbin /imports` down to individual function names, running the identical
test binary from the app's own working directory to rule out a DLL-search-
path issue, checking for a PATH-shadowing system FFmpeg install — found
nothing conclusive; the two binaries' direct imports are nearly identical,
and the failure is specific to the test binary's own linkage, not its
location or a missing file. Given the earlier `STATUS_ENTRYPOINT_NOT_FOUND`
theory ("suspected WebView2 Runtime") is now known to be wrong — a real
`quiro-desktop.exe` launches and runs fine — this remains unsolved but is
also no longer the actual blocker: that same running instance had already
regenerated a complete, current `tauri.ts` (verified: `measureText`,
`fontFaceBytes`, `TextContent`, `FaceId`, `TextLayoutResult` all present) on
its own debug-mode startup, before it was closed (with explicit permission —
it held a file lock blocking an unrelated build). The frontend work below
was built directly against that regenerated file.

### The anchor-height bug, found while wiring the frontend

`Constraint::anchor_height` is documented as scaling `RunStyle::font_size`
from "px@1080" to real output pixels — the same claim 002's Outcome made
("the engine applies the anchor rule") — but `quiro-text/src/layout.rs`
never actually read the field anywhere; `build_attrs`/`shape_paragraph` used
`style.font_size` verbatim. Invisible to every existing test in both
`quiro-text` and `quiro-rendering`, because all of them constructed
`Constraint { anchor_height: 1080.0, .. }` (a no-op scale of 1). It surfaced
immediately once this plan needed a *different* anchor — a screenshot
capture's content-rect height, essentially never 1080 — because annotation
text would otherwise render at the wrong size relative to its box on any
capture that isn't exactly 1080 tall.

Fixed in `layout.rs`: `compute` now computes
`scale = constraint.anchor_height.max(1.0) / quiro_project::TEXT_REFERENCE_HEIGHT`
once, and threads it into both `shape_paragraph` (the buffer-level fallback
`Metrics`) and `build_attrs` (per-run `Metrics`, letter-spacing's em ratio is
scale-invariant by construction so needs no separate multiply). `TEXT_REFERENCE_HEIGHT`
(`configuration.rs`) was `pub`-ed for this — previously private, and its doc
comment referenced a `REFERENCE_HEIGHT` in `rendering/src/text.rs` that 002
had already deleted. `fragment.rs`'s `Fragment::font_size` needed the same
fix for a different reason: it fed a painter directly (`AnnotationLayer.tsx`,
`screenshotExport.ts`), and reporting the *unscaled* value there would have
desynced it from `x`/`y`/`width`, which come from the actually-shaped (now
correctly scaled) glyph geometry — a painter setting `font-size` from the old
value would have drawn glyphs a different size than the box they were
positioned for. `extract_fragments`/`flush` now thread `scale` too; `flush`
picked up a `FlushContext` struct bundling its now-8 parameters back under
clippy's `too_many_arguments` threshold. A new test,
`anchor_height_scales_font_size_and_fragment_geometry`, asserts a fragment's
`font_size`/`width`/`height` all double between `anchor_height: 1080.0` and
`2160.0` — the property no existing test could have caught. 21/21
`quiro-text` tests pass; `quiro-rendering` and `quiro-project` are unaffected
(148 and 76 passing) since video output at 1080p was scale-1 already, by
coincidence — see 002's Outcome for the correction to that plan's own claim.

### The TypeScript half

All five files the plan named are done, plus two it didn't ("Files" above
missed `AnnotationConfig.tsx`'s two text controls and `LayersPanel.tsx`'s
layer label — both still read the flat `text`/`height`/`strokeColor` fields
until this pass).

- **`context.tsx`** gained `textFragments: Map<string, Fragment[]>` and a
  debounced measurement effect. Fragments are genuinely derived state, never
  persisted: a `measuredKeys` ref (id → last-measured `JSON.stringify(textContent)`)
  is what lets a pure position/rotation drag — which changes
  `resolvedAnnotations`' identity on every pointer move without touching
  `textContent` — skip re-measuring entirely, at zero IPC cost, rather than
  needing a coarser dependency array. A 200ms debounce (`MEASURE_DEBOUNCE_MS`)
  satisfies "called on commit, not per keystroke": `TextEditor`'s `onInput`
  still patches `textContent` every keystroke (004 owns the finer-grained
  policy the plan deferred), but the stale fragments in between are never
  visible — `AnnotationLayer.tsx` renders the contentEditable, not fragments,
  for whichever annotation is being typed into, so nothing needs the
  in-between measurements to be fresh, only the one after editing ends.
- **`AnnotationLayer.tsx`**: `RenderAnnotation`'s "text" case now maps
  `fragments` to one `<text>` per fragment (`x`/`y` offset by the
  annotation's own position — fragments are computed in the block's local
  space, same convention `layers/text.rs` already used for video), with
  `textLength`+`lengthAdjust="spacingAndGlyphs"` bounding a font-mismatch to
  tracking rather than a wrong line break, matching the plan's pseudocode.
  One addition beyond that pseudocode: `textAnchor={fragment.rtl ? "end" : "start"}`.
  The plan's own SVG sketch set `x = f.x + f.width` for RTL without an anchor
  override, which — combined with default `text-anchor: start` — would have
  planted the glyphs growing further right, past the right edge, rather than
  contained in `[x, x+width]`; Canvas2D's `textAlign: "right"` (in
  `screenshotExport.ts`) is the same fix by a different name, so the two
  painters needed to agree. The already-selected hit-testing exemption is a
  single transparent `<rect>` covering the annotation's box, rendered only
  when `selected` — it doesn't need to "win" over the glyph outlines, it just
  needs pointer-events somewhere in the box so the parent `<g>`'s
  `onMouseDown`/`onDoubleClick` always fires. `TextEditor` (the
  contentEditable shown while typing) now reads/writes through
  `textContentString`/`withTextContentString`/`textContentStyle`, and applies
  `fontSizeToFramePx` (new in `space.ts`) so its on-screen size is at least
  in the right ballpark relative to the surrounding already-rendered
  fragments — accepted as approximate per the plan's own design note ("the
  DOM edits, it does not measure").
- **`screenshotExport.ts`**: `drawAnnotations` and `renderScreenshotExportCanvas`
  are both `async` now. A new `measureExportText` calls `measure_text`
  independently of the live editor's cache — export runs at a different
  resolution (`scaleAnnotations`' `scaleX`/`scaleY`), so `anchorHeight` has to
  be export's own (`imageRect.height * scaleY`), not the preview's — and
  registers faces through the same shared cache. The Canvas2D paint loop
  follows the plan's pseudocode (`ctx.font` built from
  `quiro-face-{fontFace}`, `textAlign` for RTL) and adds one thing the
  pseudocode didn't cover: `TextDecoration` has no native Canvas2D
  equivalent, so `underline`/`lineThrough` are drawn as a manually-positioned
  stroke. Nothing in the UI can set decoration yet, but the plan's own
  premise — "both paths consume one array... neither painter reimplements
  any of it" — means SVG and Canvas2D have to agree on every field the array
  carries, not just the two currently reachable from a control.
- **`AnnotationConfig.tsx`**: the existing Color and Size controls for `isText`
  now write `textContent`'s one run via a new `updateTextStyle` helper,
  instead of `strokeColor`/`height` — `strokeColor` stays live for every
  other annotation type's actual stroke. **`LayersPanel.tsx`**: its label
  fallback (`annotation.text` when set) now reads `textContentString(annotation.textContent)`,
  or it would have gone stale the instant this pass shipped.
- **`AnnotationLayer.tsx`**'s text-tool `handleMouseDown` and a new
  `apps/desktop/src/routes/screenshot-editor/text-content.ts` (mirroring
  002's `routes/editor/text-content.ts`, with the annotation migration's own
  defaults — `align: "left"`, `fontWeight: 400`, `growType: "autoWidth"`,
  rather than the segment migration's `center`/`700`/`autoHeight`) give a
  freshly drawn annotation a real `textContent` immediately, the same way
  002 changed `Timeline/index.tsx`'s `addText()`.
- **Two new `*.check.ts` self-checks** (this repo's convention for
  non-trivial logic with no test runner behind it — see `space.check.ts`),
  registered in `scripts/run-checks.mjs`'s `CHECKS` array: one per
  `text-content.ts`, covering default-tree shape, text-only and style-only
  patches preserving the other half, and the missing-content fallback path.
  33 assertions total, all passing under `pnpm check`.
- **Deliberately not done, staying 004's scope**: `AutoWidth` is the only
  `growType` any current UI path can produce for an annotation (matching the
  migration), so resize-triggered re-wrap (the plan's "auto-height
  annotation" acceptance criterion) has no reachable case yet — `Fixed`/
  `AutoHeight` controls are 004's. An annotation's stored `width`/`height`
  (its selection-box/hit-test bounding box) is not auto-updated from a
  measurement's real extent; this was already loose before this plan (the
  old single-`<text>` renderer could already overflow those bounds), so it's
  treated as a pre-existing, unchanged characteristic rather than new scope.

### One risk this plan's own list didn't name

`font_face_bytes`, matching the plan's pseudocode exactly, discards the face
index `Database::with_face_data` also returns
(`|data, _face_index| data.to_vec()`). That is correct for a standalone font
file, but a face that lives inside a TrueType Collection (`.ttc`) needs its
index to be selected correctly — a bare `new FontFace(name, bytes)` on the
frontend has no way to ask for face N out of a multi-face blob. Not a
regression (the plan never mentioned collections either), but worth deciding
before 004 ships to a font library that contains any: either send the index
alongside the bytes, or reject/flatten collection faces on the Rust side
before they're ever interned.
