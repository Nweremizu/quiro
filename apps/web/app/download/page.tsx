import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/content";
import { DownloadActions } from "@/components/download-actions";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
	title: "Download",
	description: "Download Quiro for Windows or Apple silicon Mac.",
};

export default function DownloadPage() {
	return (
		<>
			<PageIntro
				eyebrow="Download Quiro"
				title="A native studio, ready for your desktop."
				copy="Choose your platform and start creating. No browser editor and no account ceremony between you and the work."
			>
				<DownloadActions />
			</PageIntro>
			<section className="download-details section-shell">
				<div className="download-detail-card">
					<Icon name="lock" />
					<h2>Designed around your files</h2>
					<p>
						Projects and exports live on your machine. You decide where they go
						next.
					</p>
				</div>
				<div className="download-detail-card">
					<Icon name="sparkle" />
					<h2>Updates without the hunt</h2>
					<p>
						The desktop app checks the same signed release channel that powers
						these downloads.
					</p>
				</div>
				<div className="download-detail-card">
					<Icon name="layers" />
					<h2>Clear platform support</h2>
					<p>
						Quiro currently ships for Windows x64 and Apple silicon Macs running
						macOS 12 or later.
					</p>
				</div>
			</section>
			<section className="download-help section-shell">
				<div>
					<h2>Need installation help?</h2>
					<p>
						Find known limitations, troubleshooting steps, and a direct route to
						support.
					</p>
				</div>
				<Link className="button button-light" href="/support/">
					Open support <Icon name="arrow" />
				</Link>
			</section>
		</>
	);
}
