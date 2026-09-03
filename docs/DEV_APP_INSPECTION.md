# Driving the running app from outside

Tauri on Windows hosts the frontend in **WebView2**, which is Chromium and
therefore speaks the Chrome DevTools Protocol. That makes the live app
inspectable and scriptable from outside the process: read the preview canvas
back as pixels, click through the editor, screenshot a real composition.

macOS and Linux use WKWebView and WebKitGTK, which do not expose CDP. This is a
Windows-only affordance.

## How it is enabled

`enable_webview_remote_debugging` in `apps/desktop/src-tauri/src/lib.rs` sets
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` as the
first statement of `run()`, before Tauri creates the WebView2 environment.

It is behind `#[cfg(all(debug_assertions, windows))]`, so it is **compiled out
of release builds entirely**. That is deliberate and load-bearing: a CDP port
gives anything that can reach localhost full control of the webview — script
execution, DOM access, storage. It is a development affordance and must never
ship. Setting `additionalBrowserArgs` in `tauri.conf.json` would have been
simpler and is the wrong answer, because it would apply to production too.

`QUIRO_CDP_PORT` overrides the port. An existing
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is left alone rather than clobbered.

## Using it

1. `pnpm dev` — the console prints the endpoint on startup.
2. `curl http://127.0.0.1:9222/json/version` to confirm it is up.

`.claude/launch.json` has two entries, and the difference matters:

| Entry | Runs | Gives you |
| --- | --- | --- |
| `desktop` | `vite` alone | The React frontend in a browser tab. **No Tauri IPC**, so no commands and no rendered frames — CSS and layout work only. |
| `desktop-app` | `pnpm dev` → `tauri dev` | The real app: Vite *and* the native window, with the CDP port open. |

Both bind port 1420, so only one can run at a time. `desktop-app` also opens a
browser tab at 1420 as a side effect of how previews work — ignore it. The
surface worth driving is the native window, reached over CDP, not that tab.

The first `desktop-app` run is a full Rust debug build and takes minutes.

The `chrome-devtools` MCP server is configured with
`--browserUrl=http://127.0.0.1:9222`, so it attaches to the running app rather
than launching its own Chrome. **MCP servers connect at session start**, so a
Claude Code session must be restarted after the app is running for the tools to
find it.

## Verified working

Confirmed end to end on 2026-09-02 against a running `desktop-app`:

- `http://127.0.0.1:9222/json/version` → Edge/WebView2 152.0.4191.53, CDP 1.3.
- `/json/list` → two page targets, the launcher and the screenshot editor.
- `Runtime.evaluate` in the screenshot-editor target reached the preview
  canvases (1996x1124, the padded frame) and read real pixels back: a gradient
  background with the capture composited into it, 352 distinct colours across a
  40px sample grid.

That last step is the whole point: those pixels came out of the wgpu renderer,
over the frame socket, into an `ImageBitmap`, onto the canvas. Reading them is
an end-to-end assertion on the real pipeline.

Note the frame is 1996x1124, not 1920x1080 — it is the *padded* frame. That is
the same fact plan 001 turned on, observable directly here.

## What this is and is not for

**Is:** end-to-end checks that cross the IPC boundary — does the mask inspector
actually drive the renderer, does a config change produce a new frame, does the
exported image match the preview. `Preview.tsx` draws the wgpu output into a
`<canvas>`, so `getImageData()` over CDP reads real rendered pixels from the
real pipeline.

**Is not:** the way to test the renderer itself. That is
`packages/crates/rendering/src/gpu_test_harness.rs`, which acquires a headless
wgpu device and asserts on pixels with no app, no window and no browser — see
`mask::gpu_pixel_tests`. Prefer it for anything about shader output: it is
deterministic, runs in CI, and does not depend on a window being open.
