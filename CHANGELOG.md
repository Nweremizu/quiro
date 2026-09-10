# Changelog

All notable changes to Quiro are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

`scripts/version.mjs` moves everything under **[Unreleased]** into a dated
version section when you cut a release, so keep adding entries there as you land
changes.

## [Unreleased]

## [0.1.2] - 2026-09-10

- Maintenance release.

## [0.1.1] - 2026-09-09

### Added

- Release engineering: reproducible multi-platform bundling, `pnpm release`
  version tooling, CI on every push/PR, and tag-triggered release + nightly
  workflows with Tauri auto-update manifests published to Cloudflare R2.

### Fixed

- Installed Windows app failed to start: the FFmpeg 7.1 runtime DLLs
  (`avcodec-61`, `avformat-61`, …) were never bundled. They now ship beside the
  executable.
- Launch window crashed with "Cannot read properties of null (reading
  'variant')" after choosing a capture target, when a stale persisted
  `captureTarget: null` was loaded. Null is now coalesced to the default at
  every load path.

## [0.1.0] - 2025-09-01

### Added

- Initial internal build: screen + camera recording, studio editor,
  screenshot editor with arrow / shape / text / mask / focus annotations.
