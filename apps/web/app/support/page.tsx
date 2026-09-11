import type { Metadata } from "next";
import { PageIntro } from "@/components/content";
import { Icon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Support",
	description:
		"Get help with recording, editing, exporting, and installing Quiro.",
};

const topics = [
	{
		title: "Recording permissions",
		copy: "Check that Quiro has access to screen recording, camera, and microphone in your operating system settings.",
	},
	{
		title: "Audio or camera devices",
		copy: "Reconnect the device, confirm it is not held by another app, then select it again in Quiro's recording controls.",
	},
	{
		title: "Export troubleshooting",
		copy: "Keep the project media in place, verify available disk space, and retry with a standard MP4 export.",
	},
];

export default function SupportPage() {
	return (
		<>
			<PageIntro
				eyebrow="Support"
				title="Let’s get you back to the work."
				copy="Start with the most common checks below. If the problem persists, open a support issue with your operating system, Quiro version, and the steps that reproduce it."
			/>
			<section className="support-grid section-shell">
				{topics.map((topic, index) => (
					<article className="support-topic" key={topic.title}>
						<span>0{index + 1}</span>
						<h2>{topic.title}</h2>
						<p>{topic.copy}</p>
					</article>
				))}
			</section>
			<section className="support-contact section-shell">
				<div>
					<div className="feature-icon">
						<Icon name="sparkle" />
					</div>
					<h2>Still stuck?</h2>
					<p>
						Open an issue and include logs or screenshots only after removing
						private information.
					</p>
				</div>
				<a
					className="button button-dark"
					href={`${site.repository}/issues/new`}
				>
					Open a support issue <Icon name="arrow" />
				</a>
			</section>
		</>
	);
}
