# Quiro

<p align="center">
  <img width="140" alt="Quiro logo" src="./public/app-icons/quiro-128.png" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-30-47848f?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 30" />
  <img src="https://img.shields.io/badge/React-18-149eca?style=for-the-badge&logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tests-Vitest%20%7C%20Playwright-16a34a?style=for-the-badge" alt="Vitest and Playwright" />
</p>

## Create polished screen recordings, demos, and product videos.

Quiro is a desktop screen recording and editing app built with Electron, React, TypeScript, PixiJS, and FFmpeg. It is designed for product walkthroughs, demos, tutorials, social clips, and internal videos where raw screen capture is not enough.

The app combines recording, timeline editing, cursor polish, zooms, webcam overlays, captions, annotations, frame styling, and MP4/GIF export in one workflow.

---

## What Is Quiro?

Quiro records your screen, opens the recording directly in an editor, and lets you turn it into a finished video without moving between multiple tools.

The editor is built around a visual timeline. You can split clips, trim sections, add zooms, adjust playback speed, style the frame, place webcam footage, add annotations, generate captions, and export the result.

Quiro currently targets:

- **Windows**
- **macOS**
- **Linux**

Platform support depends on the available capture and audio APIs for each OS. Windows has the most native helper coverage in this repository today.

---

## Core Features

### Screen Recording

- Record a display or application window
- Start from a compact launch/HUD window
- Open recordings directly in the editor
- Capture microphone and system audio where supported
- Use native capture helpers on supported platforms
- Save and reopen editor projects

### Timeline Editing

- Split clips into independent regions
- Trim unwanted footage
- Seek and play through edited clips
- Add zoom regions
- Add speed changes
- Add annotation layers
- Add extra audio regions
- Adjust timeline density and layout
- Preserve editor state in project files

### Cursor, Zoom, and Motion

- Render a polished cursor overlay
- Smooth cursor movement
- Control cursor size and visual style
- Add cursor motion blur, sway, and click effects
- Use zoom regions to emphasize important moments
- Suggest zooms from cursor activity
- Keep cursor and zoom behavior consistent during preview and export

### Webcam Overlay

- Add webcam footage as an overlay
- Control size, position, margins, corner radius, and shadow
- Mirror webcam footage
- Crop webcam input
- Use overlay or side-by-side layout modes
- Let webcam placement react to zooms

### Captions and Annotations

- Add text, image, figure, and blur annotations
- Animate annotation state through keyframes
- Generate and parse caption data
- Style caption typography, layout, and animation
- Keep captions and annotations layered with other overlays

### Frame Styling

- Built-in wallpapers and video backgrounds
- Custom background uploads
- Solid color and gradient backgrounds
- Aspect ratio presets
- Frame padding
- Rounded corners
- Background blur
- Drop shadows
- Crop controls

### Export

- Export MP4 videos
- Export GIFs
- Select quality and frame-rate settings
- Use modern or legacy export pipeline modes
- Use FFmpeg-backed export paths where available
- Reveal exported files in the system file manager

---

## Project Structure

```text
electron/                  Electron main process, preload, IPC, native helpers
electron/ipc/              Capture, export, project, ffmpeg, cursor, caption handlers
electron/native/           Platform-specific native helper projects
src/                       React renderer application
src/components/editor/     Editor window, timeline, playback, panels, dialogs
src/lib/exporter/          Video, GIF, frame, audio, and native export logic
src/types/                 Shared editor and Electron API types
public/                    App icons, wallpapers, and static assets
scripts/                   Build, fixture, icon, and native-helper scripts
tests/feature/             Playwright Electron feature tests
```

---

## Requirements

### General

- Node.js 20+
- npm
- Git

### Windows Native Helpers

For native Windows capture/export helper builds:

- Windows 10 or later
- Visual Studio 2022 or Build Tools
- C++ workload
- CMake

### macOS

For local native builds:

```bash
xcode-select --install
```

### Linux

For local native builds on Ubuntu/Debian-style systems:

```bash
sudo apt install build-essential cmake libx11-dev libxtst-dev libxrandr-dev libxt-dev
```

---

## Getting Started

Clone the repository and install dependencies:

```bash
git clone https://github.com/nweremizu/QUIRO.git quiro
cd quiro
npm install
```

Start the development app:

```bash
npm run dev
```

Build the renderer and Electron app code without packaging:

```bash
npm run build:app
```

Create a packaged desktop build:

```bash
npm run build
```

Packaged output is written under:

```text
release/<version>/
```

---

## Native Helper Builds

Build all platform/native helper targets:

```bash
npm run build:platform-native-helpers
```

Individual helper commands:

```bash
npm run build:native-helpers
npm run build:windows-capture
npm run build:windows-gpu-export
npm run build:nvidia-cuda-compositor
npm run build:cursor-monitor
npm run build:whisper-runtime
```

Rebuild the native `uiohook-napi` dependency for Electron:

```bash
npm run rebuild:native
```

---

## Testing

Quiro uses Vitest for unit tests and Playwright Electron for feature tests.

Run unit tests:

```bash
npm run test:unit
```

Run unit tests in watch mode:

```bash
npm run test:watch
```

Run coverage:

```bash
npm run test:coverage
```

Run Electron feature tests:

```bash
npm run test:feature
```

Run the CI test gate locally:

```bash
npm run test:ci
```

`test:ci` runs:

- TypeScript typecheck
- Vitest unit tests
- Production app build
- Playwright Electron feature tests

Feature tests generate deterministic media fixtures under `tests/fixtures/generated/`. That directory is ignored by Git.

---

## Quality Gates

Use these before opening a pull request:

```bash
npm run typecheck
npm run test:unit
npm run test:feature
```

Linting is available with:

```bash
npm run lint
```

---

## Usage

### Record

1. Launch Quiro.
2. Select a screen or window.
3. Choose microphone, webcam, and countdown options.
4. Start recording.
5. Stop recording to open the editor.

### Edit

Inside the editor you can:

- split and trim clips
- seek through the edited timeline
- add zooms and speed regions
- tune cursor appearance and motion
- add webcam overlay footage
- add annotations and captions
- style the frame and background
- crop and resize the final composition
- save the project state

### Export

Export options include:

- **MP4** for standard video output
- **GIF** for lightweight loops and previews

Export settings include quality, frame rate, format, pipeline mode, and output dimensions.

---

## Platform Notes

### Windows

Windows has native helper support for capture, cursor monitoring, GPU export probing, and CUDA compositor experiments. Some native paths require supported hardware, drivers, and build tooling.

### macOS

macOS support depends on Electron and platform capture permissions. Users may need to grant screen recording, camera, and microphone permissions.

### Linux

Linux recording behavior depends heavily on the desktop environment, display server, and audio stack. PipeWire is generally required for modern screen/audio capture workflows.

---

## Known Limitations

- Platform capture behavior varies between Windows, macOS, and Linux.
- Cursor hiding depends on OS and capture backend support.
- System audio availability depends on platform permissions and audio APIs.
- Native helper builds require local compiler/toolchain setup.
- Packaged app metadata in `electron-builder.json5` should be finalized before public distribution.
- No license file is currently declared in this repository.

---

## Architecture

Quiro is split into three main layers.

**Electron main process**

- Window lifecycle
- IPC registration
- Recording orchestration
- Project file handling
- Local media and asset access
- Native helper integration
- Export file streaming and finalization

**React renderer**

- Launch/HUD windows
- Editor UI
- Timeline editing
- Settings panels
- Preview playback
- Project state
- Export controls

**Rendering and export**

- PixiJS preview composition
- Cursor, webcam, caption, annotation, and frame rendering
- MP4/GIF export pipelines
- FFmpeg/native export integration
- Audio muxing and edited-track handling

---

## CI

The repository includes a GitHub Actions workflow at:

```text
.github/workflows/test.yml
```

The workflow runs on Windows and executes:

```bash
npm ci
npm run test:ci
```

Playwright traces and reports are uploaded as artifacts when available.

---

## Contributing

Contributions should be focused and testable.

Useful areas for improvement:

- Capture reliability across platforms
- Export performance
- Timeline editing behavior
- Cursor and zoom polish
- Caption workflows
- Project persistence
- Accessibility and keyboard navigation
- Test coverage
- Packaging metadata and release automation

Before submitting changes, run the local quality gates and include notes for any platform-specific behavior you could not verify.

---

## License

No license file is currently included in this repository. Add a license before distributing or accepting external contributions.
