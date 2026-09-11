import type { Metadata } from "next";
import { PageIntro } from "@/components/content";
import { Icon } from "@/components/icons";
import { downloads, site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Releases",
	description: "Quiro release channels, update information, and release notes.",
};

export default function ReleasesPage() {
	return (
		<>
			<PageIntro
				eyebrow="Releases"
				title="One trustworthy path from build to desktop."
				copy="Quiro publishes versioned installers and signed update metadata from the same release workflow, keeping manual downloads and in-app updates aligned."
			/>
			<section className="release-grid section-shell">
				<article className="release-card featured">
					<div className="release-status">
						<span /> Stable channel
					</div>
					<h2>Recommended for everyday work</h2>
					<p>
						Stable releases are the default for the website and the desktop
						updater.
					</p>
					<div className="release-links">
						<a href="/download/">
							Download stable <Icon name="arrow" />
						</a>
						<a href={downloads.manifest}>Release metadata</a>
					</div>
				</article>
				<article className="release-card">
					<div className="release-status subtle">
						<span /> Source and notes
					</div>
					<h2>See what changed</h2>
					<p>
						Every published build has a matching GitHub release with its version
						history and downloadable assets.
					</p>
					<div className="release-links">
						<a href={`${site.repository}/releases`}>
							View GitHub releases <Icon name="arrow" />
						</a>
					</div>
				</article>
			</section>
		</>
	);
}
