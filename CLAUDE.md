# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Quiro is a Turborepo + npm-workspaces monorepo (Node >= 22):

- `apps/desktop` (`@quiro/desktop`) — the product: an Electron screen recorder/editor (React 19, TypeScript, Vite, PixiJS, FFmpeg). Almost all work happens here.
- `apps/web` (`@quiro/web`) — Next.js marketing/download site.
- `packages/shared` (`@quiro/shared`) — shared types (GitHub release types, platform detection).

React 19 is pinned via root `overrides`; the desktop app's `@types/react` are still v18 — don't "fix" that mismatch casually, hoisting is deliberate.

Note: the root `README.md` predates the monorepo move and still shows paths like `electron/`, `src/` — those now live under `apps/desktop/`.

## Commands

Root (turbo wrappers): `npm run dev:desktop`, `build:desktop`, `typecheck`, `test`, `lint`.

Inside `apps/desktop` (preferred for iteration):

```bash
npm run dev            # Vite + Electron dev app
npm run typecheck      # tsc --noEmit
npm run test:unit      # all Vitest unit tests
npx vitest run src/components/editor/videoPlayback/videoEventHandlers.test.ts   # single test file
npm run test:feature   # Playwright Electron tests (runs build:app first; slow)
npm run lint           # eslint, --max-warnings 0
npm run build:app      # typecheck + vite build, no packaging
npm run build          # full packaged build (electron-builder → release/<version>/)
```

Unit tests are colocated `*.test.ts` next to sources. Feature tests live in `apps/desktop/tests/feature/` and generate fixtures under `tests/fixtures/generated/`.

Native Windows helpers (cursor monitor, WGC capture, GPU export, hud-topmost-guard, whisper runtime) have prebuilt binaries **committed** at `electron/native/bin/win32-x64/`. Only rebuild them (`npm run build:platform-native-helpers`, needs VS2022 + CMake) if you changed their C++ sources; otherwise leave the binaries alone. Each has a build script under `scripts/build-*.mjs` that also refreshes `electron/native/bin/win32-x64/helpers-manifest.json` (sha256 + source fingerprint) — commit the rebuilt binary and the manifest together; if only `updatedAt` timestamps changed, revert the manifest (churn).

## Architecture

### Process split

- `electron/` — main process. IPC handlers live in `electron/ipc/` and are registered via `electron/ipc/register/*`; `electron/ipc/handlers.ts` is the hub. Media files are served to the renderer over local HTTP servers (`electron/utils/mediaServer.ts`, `electron/renderer-server.ts`), not `file://`.
- `electron/preload.ts` exposes the API as `window.electronAPI`. Its type lives in **two places that must stay in sync**: `electron/electron-env.d.ts` and `src/types/electron-env.d.ts`. Adding an IPC channel means touching: handler, register file, preload, both d.ts files.
- `src/` — renderer. Two windows: launch/HUD (`src/components/launch/`) and the editor (`src/components/editor/`).
- The launch/HUD is a transparent `alwaysOnTop` window. On Windows `alwaysOnTop` is only best-effort (the OS reorders within the single topmost band, and activating another window via Alt+Tab/taskbar can leave it underneath), so `electron/window.ts` spawns a native `hud-topmost-guard` helper with the HUD's HWND. The guard re-asserts `HWND_TOPMOST` on `EVENT_SYSTEM_FOREGROUND` (via `SetWinEventHook`) using `SetWindowPos(..., SWP_NOACTIVATE|NOMOVE|NOSIZE)` **without** `SWP_SHOWWINDOW` — reclaiming top instantly (no flash) without corrupting the `WS_EX_TRANSPARENT` mouse pass-through. Don't regress this to `moveTop()` polling (too slow/weak, and it was suppressed during interaction) or to a `setAlwaysOnTop(false→true)` toggle (flashes + breaks pass-through on Win11). It falls back to a JS `moveTop()` poll only if the helper binary is missing.

### The editor (where most complexity lives)

`src/components/editor/window.tsx` (~7k lines, `EditorWindow`) owns nearly all editor state — regions (zoom/trim/clip/speed/audio/annotation), settings, project persistence — and passes it down to:

- `playback.tsx` (`VideoPlayback`) — PixiJS preview: WebGL app, video texture, zoom/camera springs, cursor overlay, motion-blur filters. Per-frame work happens in the Pixi ticker, not React.
- `timeline/TimelineEditor.tsx` — dnd-timeline based timeline.
- `SettingsPanel.tsx` — right-hand settings.

Playback time flows through `videoPlayback/videoEventHandlers.ts`: `requestVideoFrameCallback` drives time updates and applies trim-skips and speed regions there.

Export is a **separate** pipeline from preview: `src/lib/exporter/` (frame renderers, MP4/GIF, audio muxing) plus FFmpeg/native paths via IPC.

Other subsystems: extensions host (`src/lib/extensions/` + `electron/extensions/` marketplace), captions (whisper.cpp runtime; model auto-downloaded from Hugging Face per `electron/utils/constants.ts` to `<userData>/whisper/`).

### Performance-critical render architecture — do not break

The editor had severe playback stutter caused by React re-rendering the whole `EditorWindow` tree (~30ms+ render, ~100ms with effects/layout) on high-frequency updates. The current design that fixed it:

1. **`src/lib/playbackTimeStore.ts` is the live time channel.** During playback the React `currentTime` state in window.tsx is **frozen** — `handlePlaybackTimeUpdate` writes only to the store; state is flushed on pause/seek. Never reintroduce per-frame (or even throttled) `setCurrentTime` while playing.
2. Per-frame consumers subscribe to the store individually (`useSyncExternalStore`): the timeline playhead, `LiveTimecode` (header clock), and `VideoPlayback` itself (`effectiveCurrentTime` = live store value, falling back to the prop when paused — drives captions, bg/webcam drift sync, annotations). Audio drift correction in window.tsx ticks on a 250ms interval while playing, since it gets no time-driven re-runs.
3. Anything reading "the playhead position" inside an interaction handler must read the store at call time (see `getPlayheadMs()` in TimelineEditor), because React time props are stale during playback.
4. **`SettingsPanel` and `TimelineEditor` are wrapped in `React.memo`** and their call sites in window.tsx keep every callback prop referentially stable (`useCallback`). A single new inline arrow/object prop at those call sites silently disables the memo. Handlers like `handleZoomDepthChange` guard internally against missing selection — don't re-add wrapper closures.
5. High-frequency input is coalesced: the `Scrubber` slider and timeline playhead scrub commit at most once per animation frame; zoom-focus dragging in `playback.tsx` updates the overlay locally and commits region state only on pointer-up.

Debug tooling (dev-only, safe to leave in): `src/lib/playbackSessionDebug.ts` logs per-playback-session stats (presented-frame gaps, decoder drops, long tasks, per-phase ticker timing, `react:*` Profiler probe costs) to the console; toggle with `window.__PLAYBACK_DEBUG = false/true`. `PerfOverlay` (Ctrl+Shift+P) shows live FPS/CPU/IPC. After any change to playback, preview rendering, or window.tsx state flow, play a clip and check the session summary — `stalls ≥80ms` should stay at none and `react:settings-panel` should stay near zero during playback.

The preview Pixi ticker (`playback.tsx`) runs every frame; keep its idle cost low. The per-frame extension effects-canvas pass (clear + `hookParams` build) is gated behind `extensionHost.hasAnyRenderHooks() || hasCursorEffects()` — don't move work out of that guard, and don't reintroduce per-frame writes that already persist (e.g. `preservesPitch`, or `playbackRate` when unchanged) in `videoEventHandlers.ts`.

## CI & release

Two workflows: `.github/workflows/test.yml` (Windows + macOS matrix on every PR/push — desktop `test:ci` = typecheck + vitest, plus `@quiro/web` typecheck) and `.github/workflows/release.yml`.

**Releasing** is triggered by pushing a `v*` tag (e.g. `v1.2.0`). `prepare-release` fails unless the tag version equals `apps/desktop/package.json` version (the only versioned workspace), so bump that, land it on `main`, then tag `main`. The pipeline builds signed Windows + notarized macOS installers, checksums them, and uploads to the GitHub Release, which shipped clients auto-update from (~90 min). `release.yml` runs desktop unit tests on the Windows build job but **not** the web typecheck, so a red web typecheck in `test.yml` does not block a release build.

Known CI gotchas — these fail **only in CI** (clean `npm ci`), pass in local dev, and are already fixed; don't reintroduce them:

- **macOS Electron-install race.** `test.yml` installs with `npm ci --ignore-scripts`, so Electron's binary isn't extracted at install. vitest runs test files in parallel, so the first tests to `import "electron"` (`electron/ai/*`) race to extract into `node_modules/electron/dist` and collide creating the macOS-only `Electron Framework` symlink → `EEXIST` / "Electron failed to install correctly". Fixed by a serial `node node_modules/electron/install.js` step before the tests — **keep it**. Windows has no such symlink, so it never broke there.
- **`apps/web` two `@types/react` copies.** Web uses React 19 types while the root hoists `@types/react@18` for desktop (see repo-layout note). Under clean install, `motion` and the global JSX namespace resolve the root v18 while web source uses v19, so `@quiro/web` typecheck fails with `Provider cannot be used as a JSX component` / `ReactNode not assignable to ReactNode`. `motion` doesn't declare `@types/react`, so npm `overrides` can't fix it — it's a TS resolution issue. Fixed by pinning `react`/`react-dom` type resolution to the web copy via `paths` in `apps/web/tsconfig.json` — **keep those entries**. Next force-aliases react at runtime, so `next build` is unaffected. To reproduce locally you must do a clean `npm ci` (a stale local `node_modules` dedupes and hides it).

## Agent skills

### Issue tracker

GitHub Issues in `Nweremizu/quiro`, via the `gh` CLI. External PRs are **not** a
triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root, both created lazily
by `/domain-modeling`. See `docs/agents/domain.md`.
