This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Releases and downloads

`/download` reads the stable `downloads.json` manifest and offers a server-rendered version selector. `/download?version=0.1.2` selects a specific published release. Installers link directly to immutable versioned assets; missing platforms are shown as unavailable. If metadata services fail, the latest download page retains stable installer links. Explicit older versions never fall back to latest installers.

`/releases` combines published GitHub releases with the repository root `CHANGELOG.md`. History is paginated in batches of 30 upstream releases, excluding drafts and prereleases. Older pages link to their version-specific downloads. Unreleased notes appear separately without download buttons.

The existing publishing workflow supplies the manifest and GitHub assets. No database or client-side release fetch is required. Successful upstream responses use Next.js's data cache with a ten-minute revalidation interval and an eight-second request timeout. An optional server-only `GITHUB_RELEASES_TOKEN` increases the GitHub API rate limit. `NEXT_PUBLIC_RELEASE_BASE_URL` overrides the download host.

`/api/changelog` preserves the desktop app's `{ "markdown": "..." }` response through the Effect HTTP API. The root changelog is included in deployment file tracing. Deploy the website after updating `CHANGELOG.md`; it is bundled content, not fetched from GitHub at runtime.

Run release parser checks from the repository root with Node 22.6 or newer:

```sh
node --experimental-strip-types --test apps/web/lib/release-data.test.mjs
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
