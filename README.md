<p align="center">
  <img width="120" height="120" src=".github/assets/logo-badge.png" alt="Quiro logo">
</p>

<h1 align="center">Quiro</h1>

<p align="center">
  Beautiful screen recordings, owned by you.<br />
  A native screen studio for Windows and macOS — capture, compose, and deliver without leaving your desktop.
</p>

<p align="center">
  <a href="https://github.com/Nweremizu/quiro/actions/workflows/ci.yml">
    <img src="https://github.com/Nweremizu/quiro/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational" alt="Platforms">
  <img src="https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB" alt="Built with Tauri v2">
</p>

<img src=".github/assets/readme-banner.png" alt="" width="100%" />

Quiro turns a raw screen capture into a polished, portable story. Record your
screen, camera, microphone, and system audio together, then shape the result
on a focused timeline — with zooms, framing, captions, and backgrounds — all
without an account or a browser tab.

Use it for product demos, bug reports, tutorials, design reviews, async
updates, and any moment where showing the work beats another meeting.

## Why Quiro

- **Capture the whole story.** Screen, camera, microphone, and system audio,
  recorded together in one native workflow.
- **Shape the pacing.** Trim the noise, arrange the moment, and make every
  second earn its place on the timeline.
- **Guide every eye.** Zooms, cursor emphasis, and framing direct attention
  without distracting from the idea.
- **Add context in the frame.** Captions, text, and annotations sit directly
  on the canvas, so meaning never gets lost off-screen.
- **Design, not decoration.** Backgrounds, crop, spacing, shadows, and camera
  placement — a considered composition, not a raw clip.
- **Finish in the right format.** Export as MP4, MOV, or GIF and publish
  wherever your audience already is.
- **Local by default.** Capture, edit, and export on your own machine — your
  work stays in files you control, not an account you have to maintain.

## How it works

| Step | What happens |
| --- | --- |
| **01 · Capture** | Choose a display, window, or region. Bring your camera and audio when they add meaning. |
| **02 · Compose** | Refine timing, frame the content, and direct attention with motion and annotation. |
| **03 · Deliver** | Export a clean, portable file that stays yours and works anywhere. |

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | [Tauri v2](https://v2.tauri.app/) + React |
| Recording pipeline | Rust, FFmpeg, native OS capture APIs |
| Rendering & editor | Rust (`packages/crates/rendering`, `quiro-text`) |
| Marketing site | Next.js (`apps/web`) |
| Tooling | pnpm workspaces + Turborepo, Biome |

## Getting started

**Prerequisites:** Node `>= 22.13`, [pnpm](https://pnpm.io) `11.22.0`, a
stable Rust toolchain, and platform build tools (Xcode command line tools on
macOS; Visual Studio Build Tools + WebView2 on Windows).

```bash
pnpm install
pnpm setup:native   # fetches FFmpeg + ONNX Runtime for your platform
pnpm dev            # launches the desktop app
```

<details>
<summary>Other useful commands</summary>

```bash
pnpm dev:web        # marketing site, local dev
pnpm lint           # Biome
pnpm typecheck      # turbo run typecheck across the workspace
pnpm check          # repo self-checks (geometry/arrow invariants, etc.)
cargo test --workspace
```

</details>

## Repository map

| Path | What lives there |
| --- | --- |
| `apps/desktop` | Tauri app: React UI + the `src-tauri` Rust backend |
| `apps/web` | Next.js marketing site |
| `packages/crates` | ~40 Rust crates: recording, encoding, rendering, capture, camera, audio… |
| `packages/ui` | Shared React component library |
| `packages/config` | Shared TS/build config |

## Testing & CI

`cargo test --workspace` and `pnpm check` run on every push via
[`ci.yml`](.github/workflows/ci.yml). The synthetic A/V-sync fuzz matrix
(`packages/crates/recording/tests/sync_matrix.rs`) runs on its own schedule
in [`sync-tests.yml`](.github/workflows/sync-tests.yml) instead, so an
unlucky random seed never blocks an unrelated push — see that file for how
to reproduce a specific failure locally via `CAP_SYNC_MATRIX_SEED`.

## Releasing

See [`RELEASING.md`](./RELEASING.md) for how a change ships: version bumps,
changelog entries, and the nightly channel.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for repository conventions — formatting,
commit style, and how the Rust and TypeScript sides of the codebase are
organized.
