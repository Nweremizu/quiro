import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { site } from "@/lib/site";

const links = [
	{
		title: "New here?",
		text: "Get from your first capture to a finished export.",
		label: "Getting started",
		href: "/docs",
		internal: true,
	},
	{
		title: "See what’s new",
		text: "Browse releases and find the latest improvements.",
		label: "Release notes",
		href: "/releases",
		internal: true,
	},
	{
		title: "Need a hand?",
		text: "Tell us what happened. We’ll help you get going.",
		label: "Help & feedback",
		href: `${site.repository}/issues`,
		internal: false,
	},
];

export default function DownloadHelp() {
	return (
		<div className="download-help">
			{links.map(({ title, text, label, href, internal }) => {
				const Anchor = internal ? Link : "a";
				return (
					<div key={title}>
						<h2>{title}</h2>
						<p>{text}</p>
						<Anchor href={href} className="text-link">
							{label} <ArrowUpRight size={15} />
						</Anchor>
					</div>
				);
			})}
		</div>
	);
}
