# Penpot — text system architecture

Source-code research note. Subject: **Penpot** (open-source design tool, [penpot.app](https://penpot.app/), MPL-2.0), read at version **2.19.0** (unreleased; `CHANGES.md` head). Read directly from a full checkout — `common/`, `frontend/`, `render-wasm/`, `exporter/`, `backend/`.

**Confidence:** *High* throughout. Every claim below is read from source, and every `path:line` citation was verified against the checkout. Where something is inference from call sites rather than a direct reading it is marked **[inferred]**.

**Paths** in this note are relative to a Penpot checkout, not to this repository. Penpot is ClojureScript + Rust/WASM; the Rust renderer uses **Skia** (`skia_safe::textlayout`), not cosmic-text, and section 5 is where that difference matters most.

**Why this note exists.** Penpot solved, in production and at scale, the exact problem [`plans/text-engine/`](../../plans/text-engine/README.md) exists to solve: two engines measuring the same string and disagreeing. Section 11 maps what was adopted against what was deliberately rejected.

---

## 1. Architecture in one page

A text object in Penpot is an ordinary shape record with `:type :text`. It shares every generic attribute with rectangles and frames; two are its own (`common/src/app/common/types/shape.cljc:370`):

```clojure
(def ^:private schema:text-attrs
  [:map {:title "TextAttrs"}
   [:position-data {:optional true} [:maybe ctsx/schema:position-data]]
   [:content       {:optional true} [:maybe ctsx/schema:content]]])
```

Three concerns are kept apart, and the separation is the whole design:

| | What it is | Who writes it |
|---|---|---|
| `:content` | The authored four-level tree. Source of truth. | The editor |
| shape geometry | `:x/:y/:width/:height`, `:selrect`, `:points`, `:transform` | The generic geometry machinery, identical to every other shape |
| `:position-data` | A flat vector of **measured, laid-out text fragments** | The layout engine only — never authored, aggressively invalidated |

`:position-data` is what lets everything downstream — hit-testing, bounds, SVG export — consume text without re-measuring it. It is the direct ancestor of the `Fragment` type in [`plans/text-engine/001`](../../plans/text-engine/001-quiro-text-crate.md).

---

## 2. The content model

Exactly four levels, each requiring at least one child (`{:min 1}` in `common/src/app/common/types/shape/text.cljc`):

```
root                    :type "root"          — :vertical-align
└── paragraph-set       :type "paragraph-set" — carries nothing
    └── paragraph       :type "paragraph"     — align, direction, + node attrs
        └── span        no :type, has :text   — node attrs
```

A span is identified **structurally**, not by a tag:

```clojure
(defn is-text-node? [node]
  (and (nil? (:type node)) (string? (:text node))))
```

### paragraph-set is inert

Worth stating plainly, because it is the level most likely to be copied without thought. Its schema declares no style keys; `is-content-node?` explicitly excludes it ("Only matches content nodes, ignoring the paragraph-set nodes"); and a repair migration does `(transform-nodes is-paragraph-set-node? #(dissoc % :fills))` to strip fills that an earlier broken migration put there. Every document has exactly one.

### Attribute vocabularies

Declarative vectors that the rest of the system reads, in `common/src/app/common/types/text.cljc`:

| Vocabulary | Attributes | Level |
|---|---|---|
| `root-attrs` | `:vertical-align` | root |
| `paragraph-attrs` | `:text-align`, `:text-direction` | paragraph |
| `text-node-attrs` | `:typography-ref-id/-file` · `:font-id/-family/-variant-id/-size/-weight/-style` · `:line-height`, `:letter-spacing` · `:text-decoration` · `:text-transform` · `:fills` | paragraph **and** span |
| `text-span-attrs` | `text-node-attrs` minus `:line-height` | span |

The comment on `text-span-attrs` is the operative statement about line-height: *"Line-height is paragraph-level in the DOM editor; it may still be stored redundantly on span nodes."* The renderer takes the larger of the two.

### Defaults (`types/text.cljc:107`)

`vertical-align "top"` · `text-align "left"` · `text-direction "ltr"` · `font-id/family "sourcesanspro"` · `font-variant-id "regular"` · `font-size **"14"**` · `font-weight **"400"**` · `font-style "normal"` · `line-height "1.2"` · `letter-spacing "0"` · `text-transform "none"` · `text-decoration "none"` · fills `[{black, 1}]`.

**Every numeric text attribute is a string.** Legacy files stored numbers; a migration converts them; and `compare-text-attr` normalises numbers to strings before comparing. Anything that unifies with a numeric renderer has to convert at the boundary, in both directions.

---

## 3. `position-data` — the derived cache

Required keys `:x :y :width :height :fills`; optional font/decoration/transform/`:rtl`/`:text`. The critical convention (`common/src/app/common/geom/shapes/text.cljc:14`):

```clojure
(defn position-data->rect [{:keys [x y width height]}]
  (grc/make-rect x (- y height) width height))
```

**`:y` is the fragment's bottom, not its top.** Both producers agree: the DOM path adds the height explicitly (`(assoc position :y (+ y height))` in `frontend/src/app/util/text_svg_position.cljs`), and the SVG renderer consumes it as `dominantBaseline="ideographic"`. Safari gets its own branch using `"hanging"` and `y − height`.

The Rust equivalent carries provenance as well, which is what makes it usable for hit-testing back into the tree:

```rust
// render-wasm/src/shapes/text.rs
pub struct PositionData {
    paragraph: u32, span: u32,
    start_pos: u32, end_pos: u32,     // glyph range within the span
    x: f32, y: f32, width: f32, height: f32,
    direction: u32,                    // 0 = RTL, 1 = LTR
}
```

---

## 4. Layout — and the two-pass problem

Layout lives in `render-wasm/src/shapes/text.rs` (2143 lines). Three functions, one per grow type, dispatched from `update_layout` (`:1011`).

### Auto-width costs two passes in Skia

`text_layout_auto_width` (`:844`) forces `TextAlign::Left` and lays out at `f32::MAX` to read `longest_line()`, then re-lays out at that width with the real alignment. The comment says why: *"AutoWidth paragraphs are laid out with f32::MAX, so line metrics (line.left) reflect alignment within that huge width and are unusable."*

**This does not transfer to cosmic-text.** `cosmic-text-0.14.2/src/shape.rs:1456` sets `line_width = max(visual_line.w)` when no width is given — `None` means shrink-to-fit, not infinite width — so alignment is correct on the first pass. Auto-width costs the same as auto-height there. This is why [`plans/text-engine/001`](../../plans/text-engine/001-quiro-text-crate.md) specifies a single pass.

### Layout is versioned, not invalidated by hand

```rust
content_version: u64,   // bumped on every content mutation
layout_version: u64,    // the content_version the layout was built for
layout_width: Option<f32>,
```

`update_layout` early-returns when both the version and the container width still match. `force_next_layout_update` clears the cache **and bumps `content_version`**, with a comment explaining why the bump is needed: an auto-width shape always "matches its container", so clearing alone would let a late font resolution be skipped.

### Empty text gets a measured placeholder

`placeholder_dimensions` (`:1086`) asks Skia to lay out a single `"0"` in the span's own typography, so a freshly created empty text has a caret-sized box that reflects the chosen font rather than a hardcoded default. `is_empty()` gates it: exactly one paragraph, one span, empty string.

---

## 5. Bounding boxes

Four rectangles coexist:

| Rect | Meaning |
|---|---|
| `selrect` | the shape's own box |
| `content_rect` | where the text block sits after vertical alignment |
| **extrect** | tight glyph bounds |
| `position-data` union | per-fragment boxes, for SVG output and hit-testing |

`rect_from_paragraphs` (`:515`) computes the tight box asymmetrically, which is a detail worth stealing:

```rust
min_y = min_y.min(line_baseline + fm.top);       // per-glyph overshoot — tight top
max_y = max_y.max(line_baseline + line.descent); // line-level descent — stable bottom
```

Per-glyph top gives a line of lowercase letters a tight top; line-level descent stops the bottom jittering as the glyphs change.

`compute_and_cache_extrect` (`:572`) stores it as **offsets from the selrect origin**, so it is position-independent and moving a shape reuses it verbatim; only a size or vertical-align change beyond 0.1 recomputes. Auto-width bypasses the tight path entirely and falls back to `content_rect`, for the `f32::MAX` reason above.

---

## 6. Measurement authority and the three editors

| Generation | Where the caret lives | Flag |
|---|---|---|
| v1 | DraftJS; styles encoded as `PENPOT$$$<attr>$$$<transit>` style names | default |
| v2 | `contenteditable` DOM (`@penpot/text-editor`, plain JS) — the tree round-trips via `dom->cljs`/`cljs->dom` | `text-editor/v2` |
| v3 | **Rust owns caret, selection and mutation**; a 1-element contenteditable only captures keystrokes and IME | `text-editor-wasm/v1` |

The flags are coupled (`frontend/src/app/main/features.cljs:62`): enabling `render-wasm/v1` forces `text-editor/v2` on; disabling it forces both off.

### The finding that shaped our plan

Penpot's WASM measures **synchronously in the same JS thread** — and it *still* refuses to reflow per keystroke (`frontend/src/app/main/data/workspace/texts.cljs:1358`):

> *"Only measure/resize the shape on finalize. While the user is actively typing, the WASM editor already renders the growing text … and, going through the interactive-transform modifier machinery, made auto-width typing very laggy."*

That is the licence for our async boundary. Tauri IPC costs us a frame; Penpot pays nothing for synchrony and declines to spend it anyway.

### Two measuring paths, still

The DOM path is not dead. `frontend/src/app/util/text_position_data.js` measures by walking a text node one character at a time with a `Range`, emitting a fragment every time `getClientRects()` returns more than one rect — that is the line break. A `safeguard` flag prevents an infinite loop when the range cannot advance. Justified text additionally splits at whitespace.

The DOM being a *measuring* device is what forces the ugly parts: paragraphs are given `font-size: 0` whenever any child has text, because a non-zero value perturbs the browser's height calculation, and the real value is stashed in `data-saved-font-size` for `from_dom` to recover. **[inferred]** — the hack class disappears entirely if the DOM only ever edits.

---

## 7. The wire format

One call per paragraph, `common/src/app/common/render_wasm/text_content.cljs:169`. The CLJS writer and the Rust `#[repr(C)]` structs are two views of the same bytes; Rust decodes by `transmute`, so the layouts must match exactly.

```
[u32 num_spans]
[paragraph attrs : 12 bytes]  align u8 · direction u8 · decoration u8 · transform u8
                              line_height f32 · letter_spacing f32
[per span : 64 B attrs + 8 × 160 B fills = 1344 B]
[paragraph text : UTF-8, spans concatenated]
```

Three findings inside that struct, all verified against `render-wasm/src/wasm/text.rs:129`:

- **`font_family: [u8; 4]` is written and never read.** CLJS emits `(hash font-family)` into it; `impl From<RawTextSpan> for TextSpan` builds identity from `font_id`, `font_weight` and `font_style` and never touches the field. Four bytes of padding.
- **`font_variant_id` is always `uuid/zero`.** The writer keeps it only `(if (uuid? …))`, and the workspace's `normalize-span-font` sets it to a *string* like `"regular"`. The style readback names it: *"Unused: the variant id is stored as a zero uuid for every span"* (`frontend/src/app/render_wasm/text_editor.cljs:303`).
- **`serialize-font-weight` (`text_content.cljs:44`) tests `"bold"` before `"extrabold"` and `"semibold"`.** Both contain the substring, so those named weights serialise as **700**. Numeric strings match the leading `#"\d+"` branch and are unaffected, and the stored default is the numeric string `"400"` — so it only bites content carrying named weights.

Effective font identity across the boundary is therefore **uuid + weight + style**, formatted by `FontFamily::Display` as `"{uuid} {weight} {style}"` and registered under that alias in Skia's `TypefaceFontProvider`.

---

## 8. Fonts

Font identity is explicit rather than name-based. `font-id->uuid` maps `gfont-<slug>` through a catalog baked at compile time from `common/resources/fonts/gfonts.*.json`, `custom-<uuid>` to that uuid, and **everything else — including the default `"sourcesanspro"` — to `uuid/zero`**, which the engine resolves to its bundled default. Unknown and malformed ids share that bucket, so a typo renders as the default rather than failing.

Catalog uuids are `(uuid/random)` at macro-expansion: stable within a build, different across builds. Nothing may persist them.

Fallback coverage is computed from the text itself: `collect-used-languages` scans against 50 Unicode-range regexes and `contains-emoji?` against an emoji pattern; the matching Noto families are appended to each span's font list at weight 400. Only **TTF** can enter the WASM font store.

`closest-variant` resolves a target weight by nearest distance, **preferring the heavier on a tie**, and falls back to `(first variants)` — which for Source Sans Pro is 200 extralight, not regular.

---

## 9. Selection and hit-testing

Three separate tests, one per surface.

**Marquee**, shared CLJC (`common/src/app/common/geom/shapes/intersect.cljc:290`): each `position-data` fragment becomes a rect, rotated about the shape centre by `:transform` at test time, and tested against the selection rect. Falls back to the plain `:points` rectangle when the cache is empty.

**Pointer hover** under WASM: text is dropped from the hover set unless the cursor is over rendered glyphs, so clicks pass through the empty parts of a box. The exemption is the interesting part (`frontend/src/app/main/ui/workspace/viewport/hooks.cljs:337`):

```clojure
(and (features/active-feature? @st/state "render-wasm/v1")
     (cfh/text-shape? (get objects %))
     (not (contains? selected %))        ; already-selected text is exempt
     (not (wasm.api/intersect-position-in-shape % @last-point-ref)))
```

Without it, the first click of a double-click on an already-selected text falls through the letter gaps and reselects the parent. Adopted directly in [`plans/text-engine/003`](../../plans/text-engine/003-fragments-ipc-fonts.md).

**Caret placement** walks laid-out paragraphs by accumulated height and asks Skia for the glyph position, returning a `TextPositionWithAffinity` carrying paragraph index, character offset and affinity.

### The offset trap

Skia indexes **UTF-16 code units of the transformed text**; the model indexes **characters of the raw text**. They diverge on astral characters and whenever a text transform changes length (`ß` → `SS`). `Paragraph` carries an explicit conversion pair (`render-wasm/src/shapes/text.rs:1271`): `char_offset_to_utf16`, `utf16_offset_to_char` (binary search, rounds up inside a character so it never splits a glyph), and `char_utf16_len_at`.

---

## 10. Transforms, scaling, persistence

**`transform-position-data` uses only translation.** `common/src/app/common/geom/shapes/transforms.cljc:67` reads `:e` and `:f` from the matrix and discards scale, shear and rotation. Rotation still hit-tests correctly because `overlaps-text?` re-applies `:transform` at test time; a scale does not, which is why the sync code nulls `:position-data` rather than transforming it. The delta-vector variant is annotated `FIXME: deprecated`.

**Scaling rewrites typography, in the renderer only.** `Paragraph::scale_content` (`:1344`) multiplies `letter_spacing`, `TextSpan::scale_content` (`:1583`) multiplies `font_size`, and **line height is deliberately untouched** because it is a multiplier and already proportional. Reached through a `:scale-content` structure modifier applied to a shape clone; the stored tree is never touched.

**Ten migrations** touch text, in four families: flattening old per-attribute fills into fill vectors; coercing numbers to strings and blanks to defaults after tightening a schema; back-filling override flags after changing the override model; and discarding or repairing the layout cache after changing how it is computed. `0025-repair-empty-text-content` re-seeds any of the three levels that lost its children, preserving root attributes, and is idempotent.

**Component overrides are partial**, via three touched sub-groups (`:text-content-text`, `:text-content-attribute`, `:text-content-structure`) produced by `get-diff-type` (`types/text.cljc:322`) and unioned into `:content-group` by `set-shape-attr`. `text-change-value` then merges main and copy content per case — text-only grafts the copy's strings onto the main's attribute tree, attribute-only does the reverse, structure-only keeps the copy when both trees are uniformly styled. `compare-text-attr` (`:214`) makes nil, empty string, empty collection and the attribute's default all equal, and compares numeric strings with float tolerance, with a docstring naming the motivating case: `"1.3333333333333333"` vs `"1.33333"` after an editor/WASM round trip.

---

## 11. What we took, and what we rejected

Mapped against [`plans/text-engine/`](../../plans/text-engine/README.md).

### Adopted

| Idea | Where |
|---|---|
| One measurement authority; everything downstream consumes fragments | 001, 002, 003 |
| `position-data` as derived state — never in the project file, invalidated aggressively | 003 |
| `y` = baseline, not top | 001, 003 |
| Four-level content tree | 000 |
| Fragments carry resolved style so the painter needs nothing else | 001, 003 |
| Explicit font identity, and shipping the resolved face rather than trusting a name | 003 |
| Measure on commit, never per keystroke | 003, 004 |
| One undo entry per editing session, with geometry folded in | 004 |
| The already-selected hit-test exemption | 003 |
| Schema-versioned, load-time migrations | 000 |
| Tight bounds from per-glyph top and line-level descent | 001 |

### Rejected

| Idea | Why not |
|---|---|
| Typography library assets (`typography-ref-id/-file` + sync) | An entire subsystem — asset CRUD, staleness, remap on cross-file paste, detach-on-edit. No library concept in this product to hang it on. |
| Up to 8 fills per span, gradients | 160 bytes per fill on the wire and a separate SVG paint pass per layer. One colour per run plus a halo covers the use. |
| `content_version` / `layout_version` on the model | Penpot re-lays out large documents during paint. Ours are labels and titles measured on commit; a memo keyed on the input is enough. |
| Two-pass auto-width | A Skia artefact. cosmic-text's `None` width is shrink-to-fit, so one pass suffices. |
| The DOM as a measuring device | Ours only edits, which removes the `font-size: 0` / `data-saved-font-size` hack class outright. |
| A Rust-owned caret (v3) | Penpot can afford it because WASM is synchronous and in-thread. Ours would put a socket frame in every keypress. |
| `paragraph-set` as a meaningful level | Kept for structural parity, but it is inert in Penpot too. Flagged in 000 and 004 as a candidate to collapse. |

### Where we should be better than Penpot

- **Font identity.** Penpot ships face bytes for google and custom fonts, but every builtin, unknown or malformed id collapses to `uuid/zero` and renders as the default. Our position is worse today — generic-family pinning in `rendering/src/layers/mod.rs:30` covers three names and nothing else — and 003's answer is stronger than either: ship the resolved face bytes for *every* family, including whatever the user typed.
- **Dead wire fields.** `font_family` as an unread hash and a permanently-zero `font_variant_id` are the kind of drift that a struct written in one language and `transmute`d in another accumulates. Ours should assert the round trip in a test, not in review.
