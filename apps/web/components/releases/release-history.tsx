import { Effect } from "effect";
import Link from "next/link";
import { getChangelog } from "@/lib/changelog";
import {
	formatBytes,
	formatReleaseDate,
	parseChangelog,
} from "@/lib/release-data";
import { getReleaseCatalog } from "@/lib/releases";
import { EffectRuntime } from "@/lib/server";
import { site } from "@/lib/site";
import ReleaseNotes from "./release-notes";

export default async function ReleaseHistory({
	searchParams,
}: {
	searchParams: Promise<{ page?: string | string[] }>;
}) {
	const { page: rawPage } = await searchParams;
	const page =
		typeof rawPage === "string" && /^[1-9]\d{0,3}$/.test(rawPage)
			? Number(rawPage)
			: 1;
	const [catalog, markdown] = await EffectRuntime.runPromise(
		Effect.all(
			[
				getReleaseCatalog(page),
				getChangelog.pipe(Effect.catchAll(() => Effect.succeed(null))),
			],
			{ concurrency: "unbounded" },
		),
	);
	const notes = markdown ? parseChangelog(markdown) : [];
	const unreleased = notes.find(
		(entry) => entry.version.toLowerCase() === "unreleased",
	);
	return (
		<>
			{page === 1 && unreleased && (
				<details className="upcoming-release">
					<summary>
						In development <span>Not released yet</span>
					</summary>
					<ReleaseNotes entry={unreleased} />
				</details>
			)}
			{catalog.unavailable && (
				<div className="release-notice">
					<h2>Release downloads are temporarily unavailable</h2>
					<p>
						You can still read the bundled changelog below or{" "}
						<a href={`${site.repository}/releases`}>
							browse releases on GitHub
						</a>
						.
					</p>
				</div>
			)}
			{markdown === null && (
				<p className="release-notice">
					The changelog couldn’t be loaded. Each published release links to its
					notes on GitHub.
				</p>
			)}
			<div className="release-list">
				{catalog.releases.map((release) => {
					const entry = notes.find((item) => item.version === release.version);
					return (
						<article
							className="release-entry"
							key={release.version}
							id={`v${release.version}`}
						>
							<div className="release-entry-meta">
								<span className="eyebrow">Stable release</span>
								<h2>Version {release.version}</h2>
								<time dateTime={release.date}>
									{formatReleaseDate(release.date)}
								</time>
								<a href={release.url} className="text-link">
									View on GitHub ↗
								</a>
							</div>
							<div>
								{entry ? (
									<ReleaseNotes entry={entry} />
								) : (
									<p className="release-notice">
										Read the notes for this version{" "}
										<a href={release.url}>on GitHub</a>.
									</p>
								)}
								<nav
									className="release-installers"
									aria-label={`Installers for version ${release.version}`}
								>
									{release.installers.map((installer) => (
										<a key={installer.platform} href={installer.url}>
											<span>{installer.platform}</span>
											<small>{formatBytes(installer.bytes)} ↓</small>
										</a>
									))}
									{release.installers.length === 0 && (
										<p>
											No supported installers were published for this release.
										</p>
									)}
								</nav>
								<Link
									className="text-link"
									href={`/download?version=${release.version}`}
								>
									Download options →
								</Link>
							</div>
						</article>
					);
				})}
			</div>
			{catalog.unavailable &&
				notes
					.filter((entry) => entry.version.toLowerCase() !== "unreleased")
					.map((entry) => (
						<article
							className="release-entry"
							key={entry.version}
							id={`v${entry.version}`}
						>
							<div>
								<span className="eyebrow">Bundled release notes</span>
								<h2>Version {entry.version}</h2>
							</div>
							<ReleaseNotes entry={entry} />
						</article>
					))}
			{!catalog.unavailable && catalog.releases.length === 0 && (
				<p className="release-notice">
					No published stable releases on this page.
				</p>
			)}
			<nav className="release-pagination" aria-label="Release history pages">
				{page > 1 && (
					<Link href={page === 2 ? "/releases" : `/releases?page=${page - 1}`}>
						← Newer releases
					</Link>
				)}
				{catalog.hasMore && (
					<Link href={`/releases?page=${page + 1}`}>Older releases →</Link>
				)}
			</nav>
		</>
	);
}
