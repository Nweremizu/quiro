# Handoff — editor preview performance

Written 2026-09-05. Branch `editor-timeline-fixes`, last commit `26eb0fd`.

## The open question

Preview frame rate at full quality (1920x1080) **halves after the first
playback and then plateaus**:

| Playback | Preview fps |
| --- | --- |
| First after opening the editor | ~40 |
| Second | ~20 |
| Third | ~20 |

That shape is the strongest clue available, and it rules out most of what was
investigated:

- **Not unbounded accumulation** — a leak or growing cache would make the third
  play worse than the second. It plateaus.
- **Not thermal** — that drifts gradually rather than stepping once.
- **Not video position** — the first play holds ~40fps through the whole 35s
  clip, including the zoom and splitScreen segments in the back half.

A clean 2x, once, then stable looks like **exactly one extra thing existing
after the first playback** — a second render session, NV12 converter, or
readback buffer set alive alongside the first, so frames either do the work
twice or contend for the same GPU resource.

**Cheapest next test:** count live render sessions / `RgbaToNv12Converter`
instances and log it at each playback start. If it goes 1 -> 2 -> 2, that is
the whole answer. Look at what `EditorInstance` and `FrameRenderer` create per
playback versus per editor-open.

The cost lands entirely in `render_ms` (the GPU render call), which goes from
~22ms to 50-75ms. Everything downstream stays flat throughout: encode 2.5ms,
pack 0.02ms, send 0.3ms, callback 1.4ms, and the encoder never drops a frame.

## Two loose ends

**1. The stage breakdown is dead and reads `0.00`.**

`RENDER_LOOP stats` logs `prepare_ms`, `layers_ms`, `wait_prev_ms` and
`submit_readback_ms`, and all four are always zero. Cause: when the render path
moved to NV12 (`65a20de`), `editor.rs` passes
`FrameRenderStageTimings::default()` because `render_immediate_nv12` does not
return timings the way `render_immediate_with_timings` does.

This matters — that breakdown is what would split the 75ms into GPU layer work
versus readback wait, which is the next thing anyone will want. Either plumb
`FrameRenderStageTimings` through `render_nv12` / `render_immediate_nv12`, or
delete the four fields so they stop lying.

**2. Diagnostic logging is still on.**

`RENDER_LOOP stats` (`editor_instance.rs`) and `PREVIEW_ENCODER stats`
(`apps/desktop/src-tauri/src/editor.rs`) each log every 2 seconds during
playback. Useful while investigating, noise for shipping.

## What changed, and why

Five commits. The preview went from 12fps and collapsing to ~40fps stable on
first play; the render pipeline holds 60.0fps with 1 skipped frame where it
previously decayed to 23fps with 1239 skipped.

- `1595909` — timeline context menu with context-aware merging.
- `9ff01d9` — H.264 preview stream. Three separate faults:
  - `YIELD_UNTIL` was 40ms on Windows while a readback takes 20-31ms, so the
    wait spun `yield_now` for the entire transfer on up to three in-flight
    buffers, starving the tokio runtime. The websocket took 355ms to begin a
    4ms send and the ffmpeg decoders dropped receivers.
  - Readback shipped whole pooled buffers: `ensure_size` grows but never
    shrinks, so `slice(..)` sent 8.1MB for a 480x270 preview. This is why
    lowering preview quality did nothing for the frame rate.
  - The wire then became the constraint, so frames are encoded — 8.1MB to
    ~60KB, decoded by `VideoDecoder` in the webview.
- `65a20de` — GPU NV12 rendering. Halves the readback and removes a CPU colour
  conversion inside encode.
- `b28ef0e` — render-loop telemetry (see loose end 1).
- `26eb0fd` — overlap the NV12 readback with the next render. The loop
  previously submitted a GPU->CPU copy and blocked on it immediately, with no
  overlap at all despite two readback buffers being allocated for exactly that.

## Notes for whoever continues

**Measure before changing anything.** Every hypothesis reasoned from code in
this session was wrong, and every fix that landed came from a log line:

- The per-frame `ProjectConfiguration::clone` looked damning; measured at
  **814ns**, 0.005% of a frame.
- Bandwidth looked like the wall; `send_avg_ms` was 4.4ms for 8.1MB (~1.9GB/s)
  and the real cause was CPU starvation.
- Lowering preview quality "proved" bytes did not matter — but `avg_kb` stayed
  pinned at 8100 at every setting, so that test never reduced the payload.

Read `avg_kb` against `dims`, and `send_avg_ms` against `created_to_sent_avg_ms`.
Those two pairings caught two separate wrong conclusions.

**Useful instruments that already exist:**

- `Ctrl+Shift+P` in the editor — preview fps overlay
  (`routes/editor/PerformanceOverlay.tsx`). Its own comment says it exists to
  tell "the renderer is slow" apart from "the preview socket is starved".
- `WS frame stats`, `Playback stats`, `PREVIEW_ENCODER stats`, `RENDER_LOOP
  stats` all log on a 2-second cadence and line up against each other.
- A dev-only DialKit panel for the motion spring lives at `src/dev/`, loaded
  behind `import.meta.env.DEV` so it is absent from production builds.

**A trap worth remembering:** a `tracing` call with a custom `target:` is
filtered out by the default `EnvFilter`, which only allows `info` for the
`quiro_*` module paths. Log under the module path, not a custom target.
