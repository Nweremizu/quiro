# 003 — Fragments over IPC, and the font bytes that make them true

**Severity:** HIGH · **Status:** TODO · **Depends on:** 001 · **Blocks:** 004

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
