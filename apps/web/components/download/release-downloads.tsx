import Link from "next/link";
import { formatReleaseDate, stableVersion } from "@/lib/release-data";
import { getDownloadData } from "@/lib/releases";
import { EffectRuntime } from "@/lib/server";
import { site } from "@/lib/site";
import PlatformGrid from "./platform-grid";

export type DownloadSearch = Promise<{ version?: string | string[] }>;

export default async function ReleaseDownloads({
	searchParams,
}: {
	searchParams: DownloadSearch;
}) {
	const { version: requested } = await searchParams;
	const version = requested ? stableVersion(requested) : null;
	if (requested && !version)
		return (
			<div className="release-notice">
				<h2>Choose a published version</h2>
				<p>
					That version isn’t valid. Return to the latest download to browse
					available releases.
				</p>
				<Link className="text-link" href="/download">
					View latest release →
				</Link>
			</div>
		);
	const data = await EffectRuntime.runPromise(getDownloadData(version));
	if (version && !data.selected)
		return (
			<div className="release-notice">
				<h2>We couldn’t load version {version}</h2>
				<p>
					It may not be published, or the release service may be temporarily
					unavailable.
				</p>
				<Link href="/download" className="text-link">
					View latest release →
				</Link>
				<a className="text-link" href={`${site.repository}/releases`}>
					Browse GitHub releases →
				</a>
			</div>
		);
	return (
		<>
			<div className="release-toolbar">
				<div>
					<span className="eyebrow">
						{version && version !== data.latestVersion
							? "Previous release"
							: "Latest stable release"}
					</span>
					<h2>
						{data.selected
							? `Quiro ${data.selected.version}`
							: "Download Quiro"}
					</h2>
					{data.selected && (
						<p>
							Published{" "}
							<time dateTime={data.selected.date}>
								{formatReleaseDate(data.selected.date)}
							</time>{" "}
							· <Link href={data.notesUrl}>What changed?</Link>
						</p>
					)}
				</div>
				{data.versions.length > 0 && (
					<form action="/download" method="get" className="version-selector">
						<label htmlFor="download-version">Choose a version</label>
						<div>
							<select
								id="download-version"
								name="version"
								defaultValue={version ?? ""}
							>
								<option value="">
									Latest stable
									{data.latestVersion ? ` · ${data.latestVersion}` : ""}
								</option>
								{data.versions.map((release) => (
									<option key={release.version} value={release.version}>
										Version {release.version}
									</option>
								))}
							</select>
							<button type="submit">Show downloads</button>
						</div>
					</form>
				)}
			</div>
			{!data.selected && (
				<p className="release-notice">
					Version details are temporarily unavailable. The buttons below
					download the current stable installers.
				</p>
			)}
			<PlatformGrid
				release={data.selected}
				fallback={!version && !data.selected}
			/>
			<div className="release-history-link">
				<Link href="/releases">Changelog & older versions →</Link>
				{data.historyUnavailable && (
					<span>
						Version history is temporarily unavailable.{" "}
						<a href={`${site.repository}/releases`}>Check GitHub releases.</a>
					</span>
				)}
				{version && <Link href="/download">Back to latest stable</Link>}
			</div>
		</>
	);
}
