<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Nweremizu/quiro@main/.github/assets/readme-banner.png" alt="Quiro — beautiful screen recordings, owned by you" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/Nweremizu/quiro/actions/workflows/ci.yml">
    <img src="https://github.com/Nweremizu/quiro/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational" alt="Platforms">
  <img src="https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB" alt="Built with Tauri v2">
</p>

Quiro is a native screen studio for Windows and macOS. It gives you fast
screen, camera, microphone, and system-audio recording together, polished
local editing with zooms, backgrounds, and captions, and clean exports —
without moving your creative workflow into a browser or an account.

Use Quiro for product demos, bug reports, onboarding, tutorials, design
reviews, async updates, client walkthroughs, and any moment where showing
the work is faster than scheduling another call.

## Why Quiro

- **Record, edit, deliver.** Capture your screen, camera, and microphone,
  then export a finished, portable file.
- **One coherent workflow.** Capture and visual editing live in the same
  focused studio, so the result feels intentional from the first frame to
  the last.
- **Guide every eye.** Zooms, cursor emphasis, and framing direct attention
  without distracting from the idea.
- **Add context in the frame.** Captions, text, and annotations sit
  directly on the canvas, so meaning never gets lost off-screen.
- **Design, not decoration.** Backgrounds, crop, spacing, shadows, and
  camera placement — a considered composition, not a raw clip.
- **Finish in the right format.** Export as MP4, MOV, or GIF and publish
  wherever your audience already is.

## Recording Workflow

| Step | Best for | How it works |
| --- | --- | --- |
| Capture | Getting the raw material down without friction | Choose a display, window, or region; bring your camera and audio when they add meaning. |
| Compose | Turning a capture into something worth sending | Refine timing, frame the content, and direct attention with motion and annotation. |
| Deliver | Shipping a result that stays yours | Export a clean, portable file that works anywhere — no account required to open it. |

## Data Ownership

Quiro is designed for people who do not want their recording workflow
locked inside a black box.

- Capture, edit, and export entirely on your own machine.
- No account, sign-in, or upload step required to use the app.
- Recordings save as portable files you control — move them, back them
  up, or delete them yourself.

## Local Development

Quiro is a Turborepo monorepo with Rust, TypeScript, Tauri, React, Next.js,
FFmpeg, and shared media crates.

Requirements:

- Node.js 22.13 or newer
- pnpm 11.22.0
- A stable Rust toolchain
- Platform build tools (Xcode command line tools on macOS; Visual Studio
  Build Tools + WebView2 on Windows)

Install and set up the repo:

```bash
pnpm install
pnpm setup:native   # fetches FFmpeg + ONNX Runtime for your platform
```

Common commands:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop app |
| `pnpm dev:web` | Start the marketing site without the desktop app |
| `pnpm build` | Build the workspace |
| `pnpm lint` | Run Biome linting |
| `pnpm format` | Format with Biome |
| `pnpm typecheck` | Run TypeScript project references across the workspace |
| `pnpm check` | Repo self-checks (geometry/arrow invariants, etc.) |
| `cargo test --workspace` | Run the Rust test suite |

## Repository Map

| Path | What lives there |
| --- | --- |
| `apps/desktop` | Tauri v2 desktop app: React UI + the Rust `src-tauri` backend |
| `apps/web` | Next.js marketing site |
| `packages/crates` | ~40 Rust crates for recording, encoding, rendering, capture, camera, and audio |
| `packages/ui` | Shared React component library |
| `packages/config` | Shared TS/build config |

Capture and export paths are backed by Rust crates for fast recording,
rendering, and platform-specific media access; the desktop UI is React
running inside Tauri's WebView.

## Testing & CI

`cargo test --workspace` and `pnpm check` run on every push via
[`ci.yml`](.github/workflows/ci.yml). The synthetic A/V-sync fuzz matrix
(`packages/crates/recording/tests/sync_matrix.rs`) runs on its own schedule
in [`sync-tests.yml`](.github/workflows/sync-tests.yml) instead, so an
unlucky random seed never blocks an unrelated push — see that file for how
to reproduce a specific failure locally via `CAP_SYNC_MATRIX_SEED`.

## Releasing

See [`RELEASING.md`](./RELEASING.md) for how a change ships: version
bumps, changelog entries, and the nightly channel.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for repository conventions — formatting,
commit style, and how the Rust and TypeScript sides of the codebase are
organized.
