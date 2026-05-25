# Release Command Guide

Quiro currently publishes Windows releases only.

The release helper bumps the app version, creates a Git commit, creates a `vX.Y.Z` tag, pushes both to GitHub, and publishes a GitHub Release. Publishing that GitHub Release starts `.github/workflows/release.yml`, which builds the Windows installer and uploads the assets back to the release.

## Requirements

Install and authenticate the GitHub CLI:

```bash
gh auth login
```

Make sure your working tree is clean before releasing:

```bash
git status
```

The script will stop if there are uncommitted files.

## Release Types

Use patch releases for fixes:

```bash
npm run release:patch
```

Example: `1.0.0` becomes `1.0.1`.

Use minor releases for backward-compatible features:

```bash
npm run release:minor
```

Example: `1.0.0` becomes `1.1.0`.

Use major releases for breaking changes:

```bash
npm run release:major
```

Example: `1.0.0` becomes `2.0.0`.

## What The Script Does

Each release command:

1. Checks that the git working tree is clean.
2. Runs `npm run test:ci`.
3. Bumps `package.json` and `package-lock.json`.
4. Creates a commit like `chore(release): v1.0.1`.
5. Creates a Git tag like `v1.0.1`.
6. Pushes the current branch.
7. Pushes the version tag.
8. Creates and publishes a GitHub Release with generated release notes.

After the GitHub Release is published, the Windows release workflow builds the installer and uploads:

- the `.exe` installer
- `.blockmap` update files
- `latest*.yml` update metadata
- `SHA256SUMS-windows-x64.txt`

## Useful Options

Create the version commit and tag locally without pushing:

```bash
npm run release:patch -- --no-push
```

Push the branch and tag manually later:

```bash
git push origin HEAD
git push origin v1.0.1
```

Push the tag but do not create a GitHub Release:

```bash
npm run release:patch -- --no-github-release
```

Create the GitHub Release as a draft:

```bash
npm run release:patch -- --draft
```

Draft releases do not start the workflow until you publish them in GitHub.

Mark the GitHub Release as a prerelease:

```bash
npm run release:patch -- --prerelease
```

Skip the local test step:

```bash
npm run release:patch -- --skip-tests
```

Use this only when tests have already passed elsewhere.

## Rebuild An Existing Release

Use the manual dispatch for `.github/workflows/release.yml` and provide the existing tag name, for example:

```text
v1.0.1
```

The workflow validates that the tag version matches `package.json`, rebuilds Windows, and replaces release assets with the new ones.

## Signing

Windows signing is optional. If these repository secrets are missing, the workflow builds an unsigned installer:

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

Unsigned installers still publish, but Windows SmartScreen may warn users.
