import { EmbossButton } from "@quiro/ui/EmbossButton";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { downloads, site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Getting started",
	description: "Your first capture, edit, and export in Quiro.",
};

export default function DocsPage() {
	return (
		<div className="docs-page page-container">
			<Link href="/" className="text-link mb-8">
				<ArrowLeft size={15} /> Back to Quiro
			</Link>
			<span className="eyebrow">Getting started</span>
			<h1>
				Your first capture.
				<br />
				Your next great story.
			</h1>
			<p>
				Go from something on your screen to something ready to show. Here’s the
				basic workflow in Quiro.
			</p>
			<EmbossButton href={downloads.windows} variant="accent" size="lg">
				Download for Windows
			</EmbossButton>
			<section>
				<h2>01. Choose what to capture</h2>
				<ol>
					<li>Install and open Quiro on your computer.</li>
					<li>
						Choose a screenshot or a screen recording, then select your display,
						a window, or an area.
					</li>
					<li>
						For recordings, choose your camera and audio sources. Grant the
						permissions requested by your operating system for the sources you
						want to use.
					</li>
					<li>
						Start recording. Use the floating controls to pause, resume, or stop
						when you’ve finished.
					</li>
				</ol>
			</section>
			<section>
				<h2>02. Make it look like you</h2>
				<p>
					Open your capture in the editor. Set the background, adjust the
					padding and corners, and refine the composition. For recordings, use
					the timeline to trim the clip and adjust zooms. Add text or captions
					when they help explain what’s happening.
				</p>
			</section>
			<section>
				<h2>03. Keep your work together</h2>
				<p>
					Return to your library to find screenshots and recordings, reopen an
					edit, or organize your captures into folders. Keep your project files
					if you want to return to an edit later.
				</p>
			</section>
			<section>
				<h2>04. Export and send it your way</h2>
				<p>
					Choose Export in the editor and select the format that fits your next
					step. MP4 is a useful starting point for video; GIF works for short
					loops. Save the finished file, then attach or upload it wherever you
					share your work.
				</p>
				<p>
					For screenshots, save an image or copy the result to your clipboard.
					The person opening an exported file doesn’t need Quiro.
				</p>
			</section>
			<section>
				<h2>Need a hand?</h2>
				<p>
					If something isn’t working, include your operating system, Quiro
					version, and the steps that led to the problem when reporting it.
				</p>
				<a href={`${site.repository}/issues`} className="text-link">
					Get help or report a bug <ArrowRight size={15} />
				</a>
			</section>
		</div>
	);
}
