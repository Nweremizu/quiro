# Quiro website

Static public website for Quiro. It contains the marketing, download, release, support, privacy, and terms pages only; desktop application and account functionality stay outside this app.

## Local commands

```bash
pnpm dev:web
pnpm build:web
```

The production build is exported to `apps/web/out` for static hosting.

## Configuration

- `NEXT_PUBLIC_SITE_URL` is the canonical website origin.
- `NEXT_PUBLIC_RELEASE_BASE_URL` is the public release host with no trailing slash.

Download buttons use stable aliases below that release host. The desktop release workflow refreshes those aliases and `stable/downloads.json` whenever a release is published.

## Cloudflare Pages

The website workflow always builds and uploads a static artifact. It deploys to Cloudflare Pages when these repository settings exist:

- Secret: `CLOUDFLARE_API_TOKEN`
- Secret: `CLOUDFLARE_ACCOUNT_ID`
- Variable: `CLOUDFLARE_PAGES_PROJECT`
- Variable: `SITE_URL`
- Variable: `RELEASE_BASE_URL`
