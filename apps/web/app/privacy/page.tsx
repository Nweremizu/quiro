import type { Metadata } from "next";
import { PageIntro } from "@/components/content";

export const metadata: Metadata = {
	title: "Privacy",
	description:
		"Quiro's privacy approach for the website and desktop application.",
};

export default function PrivacyPage() {
	return (
		<>
			<PageIntro
				eyebrow="Privacy"
				title="Your recordings belong to you."
				copy="Quiro is designed around a local creative workflow. This page explains what that means for the public website and desktop application."
			/>
			<article className="legal-content section-shell">
				<section>
					<h2>The public website</h2>
					<p>
						The Quiro website is a static product site. It does not require an
						account to browse or to download the desktop application. Hosting
						and download providers may process standard request information such
						as IP address, browser type, and timestamps to deliver the site and
						files securely.
					</p>
				</section>
				<section>
					<h2>The desktop application</h2>
					<p>
						Quiro records, edits, and exports media on your computer. Projects
						remain in locations you choose. Features that explicitly access
						network services, such as update checks, may send the minimum
						technical request needed to provide that feature.
					</p>
				</section>
				<section>
					<h2>Updates and downloads</h2>
					<p>
						The app may request signed release metadata to determine whether an
						update is available. Download requests are handled by the release
						hosting provider and may produce routine delivery logs.
					</p>
				</section>
				<section>
					<h2>Changes</h2>
					<p>
						This notice may change as Quiro gains new services. Material changes
						will be reflected on this page alongside the product release that
						introduces them.
					</p>
				</section>
				<p className="legal-updated">Last updated: September 10, 2026</p>
			</article>
		</>
	);
}
