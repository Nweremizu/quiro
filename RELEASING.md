# Releasing Quiro

Quiro ships as native installers (`.exe`/NSIS on Windows, `.dmg` on macOS)
with in-app auto-update via the Tauri updater. Linux (`.AppImage`/`.deb`) is
in the Tauri bundle config but not currently in the build matrix —
`quiro-recording`/`quiro-rendering`/`quiro-text` don't compile there yet.

## How a change ships

| Size  | Command                | Version move    | Example         |
| ----- | ---------------------- | --------------- | --------------- |
| tiny  | `pnpm release patch`   | `1.4.2 → 1.4.3` | a bug fix       |
| small | `pnpm release minor`   | `1.4.3 → 1.5.0` | new feature, no breakage |
| big   | `pnpm release major`   | `1.5.0 → 2.0.0` | breaking change / major UX shift |
| —     | `pnpm release 1.6.0`   | explicit        | anything specific |

`pnpm release <size>`:

1. bumps the version in `tauri.conf.json`, both `package.json`s, `Cargo.toml`,
   and `Cargo.lock` — the four places that carry it, in lockstep;
2. folds everything under **`## [Unreleased]`** in `CHANGELOG.md` into a dated
   section for the new version;
3. commits `chore(release): vX.Y.Z` and tags `vX.Y.Z`.

It does **not** push. Review the commit, then:

```sh
git push --follow-tags origin main
```

Pushing the tag fires **`.github/workflows/release.yml`**, which builds every
platform, attaches the installers to a GitHub Release, generates the update
manifest, and publishes.

Prefer a dry run first: `pnpm release patch --dry-run`.

## Nightly channel

`nightly.yml` runs at 06:00 UTC (and on demand) if anything landed on `main` in
the last day. It builds a `X.Y.Z-nightly.<timestamp>.<sha>` version onto its own
updater channel. Nightly installs **side by side** with stable — separate
identifier (`com.bronx.quiro.nightly`) and product name ("Quiro Nightly") — so
testers opt in without disturbing stable users. Config overlay:
`apps/desktop/src-tauri/tauri.nightly.conf.json`.

## Build it on your own machine

```sh
pnpm install
pnpm tauri:build          # full release bundle, reads .env for the signing key
pnpm tauri:build:debug    # fast unoptimised bundle, no key needed
```

`scripts/build-local.mjs` loads `.env`, fetches the ONNX runtime, and runs
`tauri build`. The installer lands at
`target/release/bundle/nsis/Quiro_<version>_x64-setup.exe` (Windows) — the
script prints the exact path. That `.exe` installs the app for real; run it to
test the bundled build.

`pnpm tauri:build` needs `TAURI_SIGNING_PRIVATE_KEY` in `.env` because the
config emits updater artifacts. `pnpm setup:signing` creates the key and writes
it there. `pnpm tauri:build:debug` skips all of that.

## One-time setup

### 1. Updater signing key — **done**

`pnpm setup:signing` has been run: the keypair is at `.tauri-signing.key`
(gitignored), the public key is in `tauri.conf.json`, and the private key is in
`.env`. Remaining: back `.tauri-signing.key` up somewhere safe, and add the
GitHub secret `TAURI_SIGNING_PRIVATE_KEY` = its contents (password secret left
empty). Losing this key breaks updates for every shipped installer.

### 2. Cloudflare R2 release host

Full walkthrough: **[docs/RELEASE_INFRA.md](docs/RELEASE_INFRA.md)**. In short:
create an R2 bucket + public domain + API token, then set repo secrets
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`) and
variables (`RELEASE_BASE_URL`, `R2_BUCKET`), and run
`pnpm setup:release-url https://<your-domain>`.

Until `RELEASE_BASE_URL` is set the release still runs — it produces a GitHub
Release and skips the R2 push, so auto-update stays inert.

### 3. OS code signing (optional — builds are unsigned without it)

- **macOS** notarized build: add `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID`. `tauri-action` picks them up and notarizes.
- **Windows** Authenticode: add a `signCommand` under `bundle.windows` in
  `tauri.conf.json` (Azure Trusted Signing or a `signtool` wrapper) and the
  matching secret.

## What CI runs

- **`ci.yml`** on every PR and push to `main`: Biome, `tsc`, the geometry/arrow
  self-checks (`pnpm check`), the frontend build, then `cargo fmt`/`clippy -D
  warnings`/`test`. On `main` only it also does a no-publish `bundle-smoke` on
  Windows and macOS (Linux excluded — see above).
- **`build.yml`** is the reusable engine (`workflow_call`) shared by
  `release.yml` and `nightly.yml`. Don't trigger it directly.
