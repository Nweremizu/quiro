# Release Command Guide

This project releases from Git tags. The helper commands below bump the app version, create a release commit, create a `vX.Y.Z` tag, and push the tag to GitHub.

Pushing the tag starts `.github/workflows/release.yml`, which builds the installer and uploads it to GitHub Releases when the workflow is not a dry run.

## Before Releasing

Make sure your working tree is clean:

```bash
git status
```

Commit or stash any changes before running a release command. The release script will stop if there are uncommitted files.

Also make sure you are on the branch you want to release from, usually `main`:

```bash
git branch --show-current
```

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

After the tag is pushed, GitHub Actions runs the release workflow and publishes the installer to GitHub Releases.

## Useful Options

Create the version commit and tag locally without pushing:

```bash
npm run release:patch -- --no-push
```

When ready, push manually:

```bash
git push origin HEAD
git push origin v1.0.1
```

Skip the local test step:

```bash
npm run release:patch -- --skip-tests
```

Use this only when tests have already passed elsewhere.

## Manual GitHub Release Dry Run

The release workflow can also be run manually from GitHub Actions.

For a test build, keep `dry_run` set to `true`. This builds installers and uploads them as workflow artifacts, but does not publish to GitHub Releases.

For a real manual publish, set `dry_run` to `false`.

## Troubleshooting

If the script says the working tree is dirty, run:

```bash
git status
```

Then commit or stash the listed files.

If the GitHub workflow does not start, confirm the tag was pushed:

```bash
git ls-remote --tags origin
```

The workflow only runs for tags that look like `v1.2.3` or `v1.2.3-beta.1`.
