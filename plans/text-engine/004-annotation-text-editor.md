# 004 — Rich text editing for annotations

**Severity:** MEDIUM · **Status:** TODO · **Depends on:** 000, 001, 003

## Problem

The annotation text editor is a `contentEditable` that reads and writes one
string:

```tsx
// AnnotationLayer.tsx:737
element.textContent = annotation.text ?? "";
…
style={{ fontSize: `${annotation.height}px`, whiteSpace: "nowrap", lineHeight: 1 }}
onInput={(e) => onInput(e.currentTarget.textContent ?? "")}
```

`nowrap`, no runs, no alignment, and `height` doubling as the font size. After
003 the model and the painter can express far more than the editor can produce.

Two defects live here as well:

- **Every keystroke is an undo entry.** `onInput` calls `patch`, `patch` calls
  `commit`, and `commit` pushes history whenever it is not paused
  (`context.tsx:326`). Text editing never calls `beginGesture`, so a sentence
  costs forty entries.
- **The panel offers one control.** `AnnotationConfig.tsx:317` is a single
  "Size" slider writing `annotation.height`.

## Change

### The DOM is an input device, not a measuring device

This is what makes the round-trip cheap. Penpot's `from_dom` carries hacks —
forcing paragraph `font-size: 0`, stashing the real value in
`data-saved-font-size` — purely because the browser's height measurement had to
be accurate. Here it does not: cosmic-text measures, the DOM only has to
round-trip structure and attributes.

```
enter edit  →  to_dom(content)     →  contentEditable
  typing    →  local only, no IPC, no reflow
commit      →  from_dom(root)      →  TextContent
            →  measure_text(…)     →  fragments  →  repaint
```

```html
<div data-text-root style="--vertical-align: center">
  <p style="text-align: center; line-height: 1.2">
    <span style="font-weight: 400">Click </span>
    <span style="font-weight: 700">Save</span>
    <span style="font-weight: 400"> to continue</span>
  </p>
</div>
```

Attributes that are CSS are carried as CSS; the rest as `data-*`. Faces
registered in 003 are used here too, so what the user types looks like what the
renderer will produce and the reflow at commit is small.

`from_dom` must be total: any element it does not recognise collapses to a run
in the enclosing paragraph, and any empty paragraph is dropped. A commit that
cannot produce a valid tree keeps the previous content rather than writing a
malformed one.

### One undo entry per session

The mechanism already exists — `pause()` in `context.tsx:301` is re-entrant,
snapshots `{project, annotations}`, and pushes one entry on resume if anything
changed. Text editing simply never used it.

```ts
const resume = pause();            // entering edit
  // keystrokes mutate freely, no entries
  // commit: measure → fragments → auto-resize, all inside
resume();                          // one entry: text and geometry together
```

For a newly created text the creation is inside the same pause, so
create-type-commit is one entry. Committing empty deletes the shape rather than
leaving a ghost — the existing `if (!text.trim())` branch, moved inside the
pause.

### Sizing

`grow_type` becomes a real control. `AutoWidth` is the default for annotations —
you click and type a label and the box follows — and `set_size(None, None)`
makes that a single layout pass. Resize handles wrap the layout box; the click
region stays glyph-accurate with the already-selected exemption from 003.

### The panel

`AnnotationConfig.tsx` gains, for text:

| Level | Controls |
| --- | --- |
| Run | family, size, weight, italic, colour, letter-spacing, decoration, transform |
| Paragraph | align, line-height |
| Object | vertical-align, grow-type, halo |

Run-level controls apply to the DOM `Selection` when there is one and to the
whole object when there is not — which is why the editing surface has to be a
real `contentEditable` and not an `<input>`.

### Halo

Text sits on arbitrary screenshot content, so legibility usually needs an
outline. Free on both frontend paths:

```
SVG      paint-order: stroke fill;  stroke-width: halo.width;  stroke: halo.color
Canvas   ctx.lineWidth = halo.width * 2; ctx.strokeText(…); ctx.fillText(…)
```

**Not free in the video renderer.** glyphon has no glyph-outline primitive.
Penpot gets outlined text from Skia's masked-stroke compositing, which has no
equivalent here. The options are offset copies (cheap, poor at large widths) or
rendering the text to a texture and dilating it (correct, a new pass). Pick one
deliberately — or ship the halo for annotations only in this plan and leave
segments without it, since the need is much weaker over video.

## Files

- `apps/desktop/src/routes/screenshot-editor/AnnotationLayer.tsx` — `TextEditor`
  rewritten; `pause()` around the session
- `apps/desktop/src/utils/text/to-dom.ts`, `from-dom.ts` — new, the round-trip
- `apps/desktop/src/routes/screenshot-editor/AnnotationConfig.tsx` — the panel
- `apps/desktop/src/routes/editor/SegmentConfig.tsx` — the same controls for
  segments, which have carried a single run since 002
- `packages/crates/rendering/src/layers/text.rs` — halo, if it lands here

## Acceptance

- Typing a sentence and pressing Escape produces **one** undo entry, and undoing
  it restores both the text and the box size.
- Creating a text, typing, and committing is one entry; undo removes the
  annotation entirely.
- Committing an empty text deletes the annotation.
- Selecting three words and setting weight 700 produces three runs, and a
  re-open of the editor shows the same three runs — the round-trip is lossless.
- An auto-width annotation grows as you type after commit, and the box hugs the
  text with no trailing space.
- Malformed DOM — a stray `<div>` pasted in — commits as a valid tree rather
  than being rejected or written malformed.
- The `text` field is deleted from `Annotation` and `content` from
  `TextSegment`; `grep -rn "annotation.text\b" apps/desktop/src` returns nothing.

## Risks

- **Paste.** `contentEditable` accepts arbitrary HTML. Intercept `paste`, take
  `text/plain` by default, and only map a restricted subset of HTML to runs. An
  unfiltered paste is how a tree acquires nodes `from_dom` has never seen.
- **IME and press-and-hold.** Penpot's v3 editor carries two specific
  workarounds — clearing the capture surface stops `input` firing after one
  character, and clearing it also breaks the macOS accent menu, which replaces
  the base character in the DOM. Those apply to a keystroke-capture surface, not
  to a real `contentEditable`, so this design should avoid them; verify on macOS
  anyway before calling it done.
- **Rotation.** The `<g>` is un-rotated while editing because a rotated
  `contentEditable` is unusable (`AnnotationLayer.tsx:640`). That hack carries
  over unchanged, and the commit snap will be more visible on a rotated text
  because the box rotates back at the same moment.
- **`ParagraphSet` becomes load-bearing** the moment `to_dom`/`from_dom` encode
  it. If 000's observation stands — that it is inert — collapse it before this
  plan hardens the round-trip around it.
