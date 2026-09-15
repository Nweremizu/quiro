import "server-only";
import { Effect } from "effect";
import { cache } from "react";
import {
	compareReleases,
	parseDownloadManifest,
	parseGitHubRelease,
	type Release,
} from "./release-data";
import { downloads, releaseBaseUrl, site } from "./site";

const repositoryPath = new URL(site.repository).pathname;
const githubBase = `https://api.github.com/repos${repositoryPath}`;
export const RELEASE_PAGE_SIZE = 30;

async function fetchJson(url: string): Promise<unknown> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "Quiro-Web",
	};
	if (url.startsWith(`${githubBase}/`) && process.env.GITHUB_RELEASES_TOKEN)
		headers.Authorization = `Bearer ${process.env.GITHUB_RELEASES_TOKEN}`;
	const response = await fetch(url, {
		headers,
		next: { revalidate: 600 },
		signal: AbortSignal.timeout(8000),
	});
	if (!response.ok)
		throw new Error(`Release source returned HTTP ${response.status}`);
	return response.json();
}

const loadCatalog = cache(async (page: number) => {
	const data = await fetchJson(
		`${githubBase}/releases?per_page=${RELEASE_PAGE_SIZE}&page=${page}`,
	);
	if (!Array.isArray(data)) throw new Error("Invalid release catalog");
	const releases = data
		.flatMap((item) => {
			const release = parseGitHubRelease(item, site.repository);
			return release ? [release] : [];
		})
		.sort(compareReleases);
	return { releases, hasMore: data.length === RELEASE_PAGE_SIZE };
});

const loadLatest = cache(async () => {
	const result = parseDownloadManifest(
		await fetchJson(downloads.manifest),
		releaseBaseUrl,
	);
	if (!result) throw new Error("Invalid download manifest");
	return result;
});

const loadVersion = cache(async (version: string) => {
	const release = parseGitHubRelease(
		await fetchJson(`${githubBase}/releases/tags/v${version}`),
		site.repository,
	);
	if (!release || release.version !== version)
		throw new Error("Release unavailable");
	return release;
});

export function getReleaseCatalog(page = 1) {
	return Effect.tryPromise(() => loadCatalog(page)).pipe(
		Effect.catchAll(() =>
			Effect.succeed({
				releases: [] as Release[],
				hasMore: false,
				unavailable: true,
			}),
		),
		Effect.map((result) => ({
			...result,
			unavailable: "unavailable" in result,
		})),
	);
}

export function getDownloadData(version: string | null) {
	return Effect.gen(function* () {
		const [catalog, latest] = yield* Effect.all(
			[
				getReleaseCatalog(),
				Effect.tryPromise(loadLatest).pipe(
					Effect.catchAll(() => Effect.succeed(null)),
				),
			],
			{ concurrency: "unbounded" },
		);
		let selected: Release | null = latest ?? catalog.releases[0] ?? null;
		if (version) {
			selected =
				catalog.releases.find((item) => item.version === version) ??
				(latest?.version === version ? latest : null);
			if (!selected)
				selected = yield* Effect.tryPromise(() => loadVersion(version)).pipe(
					Effect.catchAll(() => Effect.succeed(null)),
				);
		}
		const versions = [...catalog.releases];
		for (const entry of [latest, selected]) {
			if (entry && !versions.some((item) => item.version === entry.version))
				versions.push(entry);
		}
		return {
			selected,
			notesUrl:
				selected &&
				catalog.releases.some((item) => item.version === selected.version)
					? `/releases#v${selected.version}`
					: selected?.url || `${site.repository}/releases`,
			versions: versions.sort(compareReleases),
			historyUnavailable: catalog.unavailable,
			hasMore: catalog.hasMore,
			latestVersion: latest?.version ?? catalog.releases[0]?.version ?? null,
		};
	});
}
