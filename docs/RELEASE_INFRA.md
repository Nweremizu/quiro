# Release infrastructure — Cloudflare R2

Quiro's auto-updater fetches a JSON manifest and downloads installers from a
public URL. That URL is a Cloudflare R2 bucket behind a custom domain. This is a
**one-time setup**; after it, `pnpm release <size>` + `git push --follow-tags`
ships an update.

## Layout

```
<RELEASE_BASE_URL>/
  stable/
    latest.json                       # updater manifest, fetched fresh every check
    downloads.json                    # public installer metadata
    downloads/
      quiro-windows-x64.exe           # stable website download alias
      quiro-macos-arm64.dmg           # stable website download alias
    1.4.0/
      Quiro_1.4.0_x64-setup.exe       # Windows installer (updater downloads this)
      Quiro_1.4.0_x64-setup.exe.sig   # its signature
      Quiro_1.4.0_aarch64.dmg         # macOS installer
      Quiro_1.4.0_aarch64.app.tar.gz  # macOS updater payload + .sig
      Quiro_1.4.0_amd64.AppImage      # Linux, + .sig
      ...
  nightly/
    latest.json
    1.5.0-nightly.<ts>.<sha>/ ...
```

`stable/latest.json`, `stable/downloads.json`, and the website download aliases
are served `Cache-Control: no-cache`; everything under a version folder is
immutable and cached forever. The release workflow replaces the aliases only
after both platform installers have been collected.

## 1. Create the bucket

Cloudflare dashboard → **R2** → **Create bucket**.

- Name: `quiro-releases` (any name; you'll set it as `R2_BUCKET`)
- Location: Automatic

## 2. Give it a public URL

Bucket → **Settings** → **Public access**.

**Recommended — custom domain:** *Connect Domain* → `downloads.quiro.app` (a
subdomain of a zone already on Cloudflare). Cloudflare adds the DNS + TLS. This
is `RELEASE_BASE_URL`.

**Quick start — r2.dev:** enable *Allow Access* under "Public Development URL".
You get `https://pub-<hash>.r2.dev`. Rate-limited and uncached — fine for
testing, switch to a custom domain before real users.

## 3. Cache rules for mutable release files

R2 objects are uploaded with `Cache-Control` headers by the release workflow, so
nothing extra is required. If you front the bucket with extra Cloudflare caching,
add a **Cache Rule** for `/stable/latest.json`, `/stable/downloads.json`, and
`/stable/downloads/*` → *Bypass cache* (or Edge TTL 60s). The updater and public
website must see a new release within minutes.

## 4. API token for CI

R2 → **Manage R2 API Tokens** → **Create API token**.

- Permissions: **Object Read & Write**
- Scope: the `quiro-releases` bucket
- TTL: forever

Copy from the result screen:

- **Access Key ID**
- **Secret Access Key**
- **Account ID** (also shown on the R2 overview page)

## 5. GitHub repo settings

**Settings → Secrets and variables → Actions.**

Secrets:

| Secret | Value |
| ------ | ----- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `.tauri-signing.key` (from `pnpm setup:signing`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty (unless you set one) |
| `AWS_ACCESS_KEY_ID` | R2 token Access Key ID |
| `AWS_SECRET_ACCESS_KEY` | R2 token Secret Access Key |
| `CLOUDFLARE_ACCOUNT_ID` | R2 Account ID |

Variables:

| Variable | Value |
| -------- | ----- |
| `RELEASE_BASE_URL` | `https://downloads.quiro.app` (no trailing slash) |
| `R2_BUCKET` | `quiro-releases` |

If `RELEASE_BASE_URL` is unset the release still runs — it just produces a
GitHub Release and skips the R2 push.

## 6. Bake the URL into the app

The version committed to `tauri.conf.json` carries a placeholder host; CI
overrides it per build, but local builds and clarity want the real value:

```sh
pnpm setup:release-url https://downloads.quiro.app
```

Commit the change. Also put the same URL in your local `.env` as
`RELEASE_BASE_URL` so `pnpm tauri:build` bakes it in.

## 7. Ship

```sh
pnpm release patch          # bump + changelog + tag
git push --follow-tags origin main
```

`release.yml` builds all platforms, uploads to R2, publishes the GitHub Release,
writes both manifests, and refreshes the stable website download aliases.
Installed apps pick up `stable/latest.json` on next launch; the website buttons
resolve to the same release's `.exe` and `.dmg`.

## 8. Publish the website

Create a Cloudflare Pages project for this repository, then add:

| Setting | Value |
| ------- | ----- |
| Secret `CLOUDFLARE_API_TOKEN` | Cloudflare token with Pages edit access |
| Variable `CLOUDFLARE_PAGES_PROJECT` | Pages project name |
| Variable `SITE_URL` | `https://quiro.app` |

The existing `CLOUDFLARE_ACCOUNT_ID` secret and `RELEASE_BASE_URL` variable are
reused. `.github/workflows/web.yml` builds a static artifact for every website
change and deploys `apps/web/out` on pushes to `main` when the Pages settings
are present.
