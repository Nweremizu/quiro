# Three.js compositor — prototype findings and future implementation

Status: **prototype validated, not scheduled.** Measured 2026-08-31 on an RTX
2050 (Dx12), debug build with `opt-level = 3` on the render crates, against
recording `2026-08-28 at 08.21.05` (946x1072 source, 956x1080 output, wallpaper
background).

Prototype lives in `apps/desktop/src/routes/editor/spike/` and
`apps/desktop/src-tauri/src/three_spike.rs`. Deleting those two plus the
`start_frame_stream` command removes it entirely.

## The question

Can Three.js own the *visual* layer — camera, depth, lighting, materials, 3D
transforms, particles, shaders, bloom, depth of field, lens effects, motion
blur, film grain — while Rust keeps everything else: codecs, seeking, caching,
timeline evaluation, project persistence, proxy generation and muxing?

The risk was that a JS compositor would be too slow, or would fight the Rust
renderer for the GPU.

## Verdict: yes

Per 1080p frame, measured end to end:

| Stage | Cost |
| --- | --- |
| Three.js scene + bloom | 2.2ms |
| WebCodecs H.264 encode | 0.16ms |
| GPU contention with the Rust renderer | ~3ms |
| **Compositor total** | **~5.4ms** |
| Rust frame production (export path) | 22.0ms |
| Rust frame production (stream path) | 33.3ms |

The compositor is under 15% of the frame budget. Both fears measured false:
Three.js is not slow, and contention is ~3ms rather than the tens of
milliseconds that would have sunk the design.

## What was actually tested

- One scene preset (`tilt-bloom`: perspective tilt + hand-rolled bloom).
- 1080p only.
- 300-frame runs, drained and composited, encoded via WebCodecs to raw `.h264`.
- Frames delivered from Rust over a websocket, consumed strictly in order.

## What was not

- The rest of the effect list: lens flare, parallax, depth of field, motion
  blur, film grain, particles, materials. Standard GPU post, but each adds to
  the 2.2ms. Headroom exists; the exact budget does not.
- 4K — 4x the pixels on both sides of the boundary.
- Muxing. The spike wrote a raw elementary stream; audio and container stay
  Rust's job.
- Integration with the editor's player. The spike is an isolated harness.
- Colour correctness across the boundary (NV12 vs RGBA, range, primaries).

## The structural problem to solve first

Frames currently make a full round trip: Rust renders on the GPU, reads back to
CPU, ships over a socket, and the browser uploads to the GPU again. It works,
but it is the largest remaining cost — roughly 26ms/frame of the stream's wall
clock sits outside the render stages (the export path's equivalent gap is
~14ms).

Options, cheapest first:

1. **NV12 on the wire.** Halves transport bytes (1.5MB vs 4.1MB at 956x1080).
   Needs a YUV to RGB step in the Three.js shader, which is free on a GPU
   compositor. `WSFrameFormat::Nv12` already exists and the stream can already
   emit it (`start_frame_stream(nv12: true)`).
2. **Raw-bytes IPC for encoded chunks.** The spike sends chunks as a JSON array
   (~5 bytes of JSON per byte of payload, measured 8-10ms/chunk). A binary
   channel removes it. This is a binding artifact, not a real cost.
3. **Shared GPU texture.** Skip the round trip entirely. The correct answer and
   the largest change; worth designing only once 1 and 2 are in.

## The decision to make before building

Does Three.js composite **preview only**, or **preview and export**?

- *Preview only* keeps Rust as the single source of truth for output, so what
  ships always matches what Rust renders. The visuals never reach the file.
- *Preview and export* is what makes the effects real in the output, but then
  preview and export must produce identical frames. That is a correctness
  problem, not a performance one, and it is the harder half of this project.

## Bugs this prototype uncovered (all fixed)

Kept here because they explain why the numbers above moved so much.

1. **Windows timer granularity in GPU readback.** `timeBeginPeriod(1)` was held
   only during playback, so export and preview rendering paid a ~15.6ms quantum
   on every readback wait that missed its yield window. Readback measured 28.3ms
   against 3.5ms of real GPU work. Now raised process-wide in `main.rs`.
   Effect: stream 18.3 -> 30.0 fps, export 43.6 -> 45.4 fps.
2. **NV12 buffer pool detach.** `SharedNv12Buffer::into_vec` sets `pool = None`,
   so every frame permanently removed a buffer from an 8-buffer pool. The live
   editor preview did this on every frame. Both callers now copy instead.
3. **Out-of-order frame decode.** `connectFrameSocket` awaited
   `createImageBitmap` inside `onmessage`, so two frames could finish decoding
   out of order. Invisible for a single still, wrong for a stream. Decodes are
   now chained.

## Method note

Eight hypotheses were raised for the frame-rate gap; one was correct. Decode,
GPU contention, pixel format, buffer pooling, GPU device, output resolution and
transport were each proposed with confidence and each falsified by measurement.
Instrument before changing anything in this renderer.
