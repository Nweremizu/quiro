# Quiro → Turborepo Monorepo: Migration & Implementation Plan

**Goal:** Convert the current single-package Electron app into a Turborepo monorepo using **npm workspaces**, add a **Next.js** marketing/download website (`apps/web`) with a **smart "detect-my-OS" download button** backed by the **GitHub Releases API**, without breaking the existing native build / electron-builder / auto-update pipeline.

**Decisions locked in:** npm workspaces · Next.js · smart GitHub-API download button.

---

## 0. Target structure

```
quiro/                              ← repo root (workspace manager only)
├── package.json                    ← root: workspaces + turbo, NO app code
├── package-lock.json               ← single lockfile for all workspaces
├── turbo.json
├── .npmrc
├── tsconfig.base.json              ← shared compiler options (optional)
├── .github/workflows/
│   ├── release.yml                 ← desktop release (paths updated)
│   ├── test.yml                    ← desktop tests (workspace-scoped)
│   └── web.yml                     ← NEW: web build/deploy
├── apps/
│   ├── desktop/                    ← the ENTIRE current app, moved verbatim
│   │   ├── package.json            ← was the root package.json
│   │   ├── electron/
│   │   ├── src/
│   │   ├── public/
│   │   ├── icons/
│   │   ├── build/                  ← entitlements
│   │   ├── scripts/
│   │   ├── tests/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── electron-builder.json5
│   │   ├── tsconfig.json
│   │   ├── playwright.config.ts
│   │   └── vitest.config.ts
│   └── web/                        ← NEW Next.js site
│       ├── package.json
│       ├── next.config.ts
│       ├── app/                    ← App Router
│       └── ...
└── packages/
    └── shared/                     ← NEW: shared types + release metadata
        ├── package.json
        └── src/index.ts            ← @quiro/shared
```

**Guiding principle:** `apps/desktop` is moved *verbatim and stays self-contained*. Every path inside it (`__dirname` aliases, relative `electron-builder.json5` entries, `scripts/`) keeps working because the whole directory tree moves together. The work is at the **boundaries**: root config, CI paths, and dependency hoisting.

---

## 1. Risks & mitigations (read first)

| # | Risk | Why it matters | Mitigation |
|---|------|----------------|------------|
| **R1** | **Dependency hoisting breaks electron-builder** | npm workspaces hoist deps to root `node_modules`. `electron-builder.json5` globs like `node_modules/ffmpeg-static/**` and `asarUnpack` are resolved relative to `apps/desktop`. If hoisted, packaging may miss them. | electron-builder ≥24 walks up for hoisted modules; this repo uses ^26. **Validate with a real `electron-builder` packaged build at the end of Phase 2 before doing anything else.** Fallback: pin problem deps to the desktop workspace via `.npmrc` `install-strategy` / `nohoist`-style placement, or run electron-builder with the app dir as cwd (we already do). |
| **R2** | **`postinstall` native build runs for every workspace** | Root `npm install` triggers each workspace's install scripts. The desktop `postinstall` does `copy:wasm` + `rebuild:native` + `build:platform-native-helpers` — slow and irrelevant to `web`. | Keep `postinstall` only in `apps/desktop/package.json`. In CI use `npm ci --ignore-scripts` (release.yml already does) then explicit native steps. For local web-only work, document `npm install --ignore-scripts`. |
| **R3** | **`uiohook-napi` rebuilt against wrong location** | Native module must match Electron ABI and live where electron-builder expects. | `npx electron-builder install-app-deps` is already in release.yml; run it scoped to `apps/desktop`. The "remove stale uiohook build" step still applies. |
| **R4** | **CI path drift** | `release.yml`/`test.yml` reference `release/`, `icons/...`, `./package.json`, `npm run ...` at root. | Phase 7 rewrites every path to `apps/desktop/...` and scopes scripts with `npm run -w apps/desktop` or `turbo run --filter`. |
| **R5** | **Git history loss on move** | Reviewers lose blame across the move. | Use `git mv` (preserves rename detection). Do the move in **one dedicated commit** with no content edits. |
| **R6** | **`npm version` in release.mjs** | It now bumps the desktop workspace version, but the git tag/commit is repo-wide. | Fine as-is — run `release:*` inside `apps/desktop`. Update release.yml's version-match check to read `apps/desktop/package.json`. |

---

## 2. Phase plan (each phase ends with a verification gate)

### Phase 0 — Safety net
1. `git checkout -b chore/turborepo-migration`
2. Confirm clean tree, working build baseline:
   ```powershell
   npm run typecheck
   npm run test:unit
   npm run build:app
   ```
   (Optionally a full `npm run build` packaged build to capture a known-good electron-builder baseline.)
3. Record current `release/<version>/` artifact names — you'll compare after.

**Gate:** baseline builds green. Tag this commit mentally as the rollback point.

---

### Phase 1 — Move the app into `apps/desktop` (one commit, no edits)
Move everything app-related with `git mv`. From repo root:

```powershell
New-Item -ItemType Directory apps\desktop -Force
# move app dirs/files (use git mv to preserve history)
git mv electron apps/desktop/electron
git mv src apps/desktop/src
git mv public apps/desktop/public
git mv icons apps/desktop/icons
git mv build apps/desktop/build
git mv scripts apps/desktop/scripts
git mv tests apps/desktop/tests
git mv index.html apps/desktop/index.html
git mv vite.config.ts apps/desktop/vite.config.ts
git mv vitest.config.ts apps/desktop/vitest.config.ts
git mv playwright.config.ts apps/desktop/playwright.config.ts
git mv electron-builder.json5 apps/desktop/electron-builder.json5
git mv tsconfig.json apps/desktop/tsconfig.json
git mv tsconfig.node.json apps/desktop/tsconfig.node.json
git mv components.json apps/desktop/components.json
git mv .eslintrc.cjs apps/desktop/.eslintrc.cjs
git mv package.json apps/desktop/package.json
git mv RELEASE_COMMAND_GUIDE.md apps/desktop/RELEASE_COMMAND_GUIDE.md
# delete the now-stale root lockfile (regenerated in Phase 3)
git rm package-lock.json
```

Leave at root: `.git`, `.github`, `.gitignore`, `README.md`, `dist*`/`release`/`node_modules` (gitignored build output — they regenerate).

**Do NOT edit any file content in this commit.** Because all app paths are relative/`__dirname`-based, nothing inside `apps/desktop` needs changing.

**Gate:** `cd apps/desktop; npm install; npm run build:app` works exactly as before (still a standalone package at this point — workspaces come next).

---

### Phase 2 — Validate packaging from the new location
Before adding workspace machinery, prove electron-builder still produces a working installer from `apps/desktop` (de-risks **R1** while the package is still standalone):

```powershell
cd apps/desktop
npm run build        # tsc && vite build && electron-builder
```

Confirm `apps/desktop/release/<version>/` contains the same artifact set as the Phase 0 baseline (NSIS `.exe`, `latest.yml`, blockmap). Launch the installed app; confirm recording + export + auto-update check still work.

**Gate:** packaged desktop build identical in shape to baseline and runs. **This is the most important gate in the plan.** If it fails here (standalone), it's a path issue in the move; if it only fails after Phase 3, it's a hoisting issue (R1).

---

### Phase 3 — Workspace root + Turborepo
Create the root `package.json`:

```jsonc
{
  "name": "quiro-monorepo",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "dev:desktop": "npm run dev -w apps/desktop",
    "dev:web": "npm run dev -w apps/web",
    "build:desktop": "npm run build -w apps/desktop",
    "build:web": "npm run build -w apps/web",
    "release:patch": "npm run release:patch -w apps/desktop",
    "release:minor": "npm run release:minor -w apps/desktop",
    "release:major": "npm run release:major -w apps/desktop"
  },
  "devDependencies": {
    "turbo": "^2.3.0"
  },
  "engines": { "node": ">=20" }
}
```

`turbo.json` (Turbo v2 `tasks` schema):

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist-electron/**", ".next/**", "!.next/cache/**"]
    },
    "build:app": { "dependsOn": ["^build"], "outputs": ["dist/**", "dist-electron/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

`.npmrc` at root:

```ini
# Keep installs deterministic; native rebuilds are explicit, not on web installs.
save-exact=false
# If R1 hoisting bites electron-builder, scope native deps locally here.
```

Regenerate the single lockfile from root:
```powershell
npm install
```

**Gate:**
- `npm run build:desktop` (via turbo) reproduces the Phase 2 packaged build.
- `npm run dev:desktop` launches the app in dev.
- A second `npm install` is a no-op (lockfile stable).

---

### Phase 4 — Shared package `@quiro/shared`
Holds types/constants both the app and website import (release payload shape, supported-platform enum, product metadata, download asset-name patterns). This is also where you formalize the asset naming so the web download logic and electron-builder `artifactName` can't drift.

`packages/shared/package.json`:
```jsonc
{
  "name": "@quiro/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/shared/src/index.ts` (illustrative):
```ts
export type Platform = "windows" | "macos" | "linux";
export type Arch = "x64" | "arm64";

export const GITHUB_OWNER = "Nweremizu";
export const GITHUB_REPO = "quiro";

// Mirror electron-builder artifactName so web + builder stay in sync.
export const ASSET_PATTERNS: Record<Platform, RegExp> = {
  windows: /Quiro-windows-.*\.exe$/i,    // artifactName: Quiro-windows-${arch}.exe
  macos: /Quiro-.*\.dmg$/i,              // artifactName: Quiro-${arch}.dmg
  linux: /Quiro-linux-.*\.AppImage$/i,
};

export interface ReleaseAsset { name: string; browser_download_url: string; size: number; }
export interface LatestRelease { version: string; tag: string; publishedAt: string; assets: ReleaseAsset[]; }
```

Consume it from `apps/desktop` and `apps/web` as a normal workspace dep: add `"@quiro/shared": "*"` to each app's `dependencies`. Desktop already bundles via Vite/Rollup (handles TS source). For Next.js add `transpilePackages: ["@quiro/shared"]` in `next.config.ts`.

**Gate:** both apps `typecheck` with a shared import resolving.

---

### Phase 5 — `apps/web` (Next.js)
Scaffold:
```powershell
cd apps
npx create-next-app@latest web --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*"
```
Trim the boilerplate. Minimum pages:
- `/` — landing: hero, feature highlights (pull copy from README), screenshots, smart download button, footer.
- `/download` — all-platforms table (every asset for the latest release) + checksums (`SHA256SUMS-*.txt`) + GitHub Releases link.
- `/changelog` (optional) — render GitHub release notes.

`next.config.ts`:
```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@quiro/shared"],
  // images.remotePatterns if loading GitHub-hosted screenshots
};
export default config;
```

**Gate:** `npm run dev:web` serves the landing page locally; `npm run build:web` succeeds.

---

### Phase 6 — Smart download button (GitHub Releases API)
Two server pieces in `apps/web`:

**(a) Latest-release fetch (cached).** A server util that calls
`GET https://api.github.com/repos/{owner}/{repo}/releases/latest`,
maps assets via `ASSET_PATTERNS` from `@quiro/shared`, and revalidates periodically:

```ts
// app/lib/releases.ts
import { GITHUB_OWNER, GITHUB_REPO, ASSET_PATTERNS, type LatestRelease } from "@quiro/shared";

export async function getLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 }, // ISR: refresh every 10 min, no rebuild needed
    },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return {
    version: String(data.tag_name).replace(/^v/, ""),
    tag: data.tag_name,
    publishedAt: data.published_at,
    assets: data.assets.map((a: any) => ({
      name: a.name, browser_download_url: a.browser_download_url, size: a.size,
    })),
  };
}
```

**(b) OS-detecting redirect route.** A Route Handler that picks the right asset for the visitor's User-Agent and 302s to GitHub's CDN — the button just links to `/api/download`:

```ts
// app/api/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ASSET_PATTERNS, type Platform } from "@quiro/shared";
import { getLatestRelease } from "@/app/lib/releases";

function detectPlatform(ua: string): Platform {
  if (/windows/i.test(ua)) return "windows";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  return "linux";
}

export async function GET(req: NextRequest) {
  const forced = req.nextUrl.searchParams.get("platform") as Platform | null;
  const platform = forced ?? detectPlatform(req.headers.get("user-agent") ?? "");
  const release = await getLatestRelease();
  const asset = release.assets.find((a) => ASSET_PATTERNS[platform].test(a.name));
  if (!asset) {
    return NextResponse.redirect(
      `https://github.com/Nweremizu/quiro/releases/latest`, 302,
    );
  }
  return NextResponse.redirect(asset.browser_download_url, 302);
}
```

UI: a primary button labeled for the detected OS (`Download for Windows`) + a small "other platforms" link to `/download`. Use `?platform=macos` overrides for the explicit links.

**Notes / hardening:**
- Unauthenticated GitHub API = 60 req/hr/IP. ISR `revalidate` + caching the redirect target keeps you well under it; for safety add an optional `GITHUB_TOKEN` env (5000 req/hr) read server-side only.
- macOS arm64 vs x64: if you can't reliably detect from UA, link the macOS button to `/download` (show both) rather than guessing.

**Gate:** `/api/download` 302s to the correct asset per `?platform=`; landing button reflects detected OS.

---

### Phase 7 — Rewire CI/CD
**`test.yml`** (desktop) — scope to the workspace and keep `npm ci`:
- `run: npm run test:ci -w apps/desktop` (or `npx turbo run test --filter=apps/desktop`).
- Native deps still rebuild via the desktop `postinstall` unless you switch to `--ignore-scripts` + explicit steps.

**`release.yml`** — update every root-relative path to `apps/desktop`:
- Version match: `node -p "require('./apps/desktop/package.json').version"`.
- Build steps run inside `apps/desktop` (add `working-directory: apps/desktop` to the build/checksum steps, or prefix `-w apps/desktop`).
- Artifact globs: `release/...` → `apps/desktop/release/...`; icon path `icons/icons/png/...` → `apps/desktop/icons/icons/png/...`.
- Keep `npm ci --ignore-scripts` at root (installs all workspaces), then `npx electron-builder install-app-deps` and native build steps **inside `apps/desktop`**.
- `electron-builder.json5` `publish` block is unchanged (still publishes to the same GitHub repo); auto-update `latest.yml` semantics are unaffected because the app still ships the same `appId`/feed.

**`web.yml`** (new) — build/typecheck the site on PRs; deploy handled by Vercel's Git integration (Phase 8) or via `vercel` CLI. Use `--filter=apps/web` so web CI doesn't drag in native desktop builds.

**Turbo remote cache (optional):** wire `turbo` to Vercel Remote Cache or self-host to speed CI; not required for correctness.

**Gate:** push a throwaway tag (e.g. `v1.0.6-rc.1`, prerelease) → release workflow produces the same assets at the new paths and uploads them. Desktop auto-updater on an installed `1.0.5` sees and downloads it.

---

### Phase 8 — Deploy the website
- Import the repo into **Vercel**, set **Root Directory = `apps/web`**. Vercel auto-detects Next.js and respects the monorepo (it installs from repo root, builds the selected app).
- Set `GITHUB_TOKEN` (read-only, public-repo scope) as a Vercel env var if you want the higher API rate limit.
- Custom domain (e.g. `quiro.app`) → CNAME to Vercel.
- Confirm the production smart-download button hits live GitHub assets.

**Gate:** production site live, download button serves the current release, Lighthouse SEO/perf acceptable.

---

## 3. Sequencing summary (smallest-risk order)
1. **Phase 0–2 first and standalone** — move + prove packaging *before* adding workspace hoisting. This isolates "did the move break paths?" from "did hoisting break electron-builder?".
2. **Phase 3** — turn on workspaces; re-validate packaging immediately.
3. **Phases 4–6** — additive (shared pkg + web); cannot break the desktop app.
4. **Phase 7–8** — CI/deploy last, once local builds are proven.

Each phase is independently committable and (1–3) independently revertable.

## 4. Rollback
- Phases 1–3 are a few commits on `chore/turborepo-migration`. If packaging can't be made to work under hoisting (R1) and the `.npmrc` scoping fails, revert to the Phase 2 standalone state (app in `apps/desktop`, no root workspace) — the website can still live in the same repo as a separate non-workspace install. Worst case, `git reset` to the Phase 0 baseline.

## 5. Definition of done
- [ ] `npm install` at root sets up all workspaces; second run is a no-op.
- [ ] `npm run build:desktop` produces a working signed-where-configured installer identical in shape to pre-migration.
- [ ] Desktop auto-update still detects new GitHub releases.
- [ ] `npm run dev:web` / `build:web` work; site deployed on Vercel.
- [ ] Smart download button serves correct per-OS latest asset via GitHub API.
- [ ] `release.yml` + `test.yml` pass from new paths; new `web.yml` green.
- [ ] Git history preserved across the move (`git log --follow` works on moved files).
- [ ] README updated with monorepo dev instructions.
```
