# 005 — Make timing optional and open the static/motion seam

- **Status**: TODO
- **Severity**: MEDIUM
- **Category**: Architecture / product
- **Estimated scope**: renderer visibility test + a mode flag; small
- **Depends on**: 004

## Problem

After 004 the screenshot editor and the video editor share an object model and
a renderer, but nothing yet connects them. The screenshot editor writes
`timing: null` and the compositor ignores timing entirely.

ShotBase's editor is one editor with a `Static | Motion` segmented control in
the header, and the research found that control present on **screenshot**
projects, not only recordings — alongside a paid "Animated screenshots"
feature. Their annotations appear simultaneously as canvas objects and as
trimmable timeline clips with entrance presets (typewriter, slide from each
edge). That is the target this plan opens the door to.

Note the honest limit: whether a ShotBase recording can switch *back* to Static,
and whether one project file holds both states, is recorded as **unverified**
in the research. This plan therefore builds the seam the evidence supports and
does not speculate past it.

## Target

Three small things, deliberately not a mode UI:

**1. The compositor honours `timing`.** One visibility test in the annotation
layer:

```rust
let visible = match &obj.timing {
    None => true,
    Some(t) => time >= t.start && time < t.end,
};
```

with `enter`/`exit` transitions driving an alpha/offset the same way
`fade_duration` already does for `TextSegment`. A static composition renders at
`t = 0` with every object's `timing` null, so this changes nothing for
screenshots — which is the point.

**2. A `mode` field on the project.** `"static" | "motion"`, defaulting from
the source kind (screenshot ⇒ static, recording ⇒ motion). It selects which
panels mount, not which data exists.

**3. Promotion is a pure function.** Switching a static project to motion is
`timing: null` → `timing: { start: 0, end: duration, track: n, enter: none,
exit: none }` per object. Nothing is lost, and demotion is the inverse. Write
it as a tested function in the project crate before any UI calls it.

## What this deliberately does not do

- **No `Static | Motion` toggle in the screenshot editor header.** The seam
  should be proven by a test that promotes a project and renders both ways
  before it becomes a user-facing control.
- **No timeline UI on the screenshot editor.** The `Effects` lane, clip trim
  handles and entrance-preset inspector are video-editor work, and by the
  user's own sequencing that comes after the screenshot editor is sound.
- **No animated export from the screenshot editor.** Animated screenshots are
  a real ShotBase feature and a plausible target, but they need an encoder path
  the screenshot editor does not currently have.

## Done when

- `SceneObject.timing` is honoured by the compositor, with a test rendering the
  same object list at two timestamps and getting different frames.
- `promote_to_motion` / `demote_to_static` exist with round-trip tests.
- A screenshot project still renders byte-identically to its pre-005 output.
