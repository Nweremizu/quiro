import Link from "next/link";
import { site } from "@/lib/site";
import { Logo } from "./logo";

const product = [
	{ href: "/features/", label: "Features" },
	{ href: "/download/", label: "Download" },
	{ href: "/releases/", label: "Releases" },
];

const company = [
	{ href: "/support/", label: "Support" },
	{ href: `${site.repository}/issues`, label: "Feedback" },
	{ href: site.repository, label: "GitHub" },
];

const legal = [
	{ href: "/privacy/", label: "Privacy" },
	{ href: "/terms/", label: "Terms" },
];

export function SiteFooter() {
	return (
		<footer className="site-footer">
			<div className="footer-inner">
				<div className="footer-brand">
					<Logo inverted />
					<p>Beautiful screen recordings, owned by you.</p>
				</div>
				<FooterGroup title="Product" links={product} />
				<FooterGroup title="Company" links={company} />
				<FooterGroup title="Legal" links={legal} />
			</div>
			<div className="footer-bottom">
				<span>© {new Date().getFullYear()} Quiro</span>
				<span>Crafted for clear communication.</span>
			</div>
		</footer>
	);
}

type FooterGroupProps = {
	title: string;
	links: ReadonlyArray<{ href: string; label: string }>;
};

function FooterGroup({ title, links }: FooterGroupProps) {
	return (
		<div className="footer-group">
			<p>{title}</p>
			{links.map((link) => (
				<Link href={link.href} key={link.href}>
					{link.label}
				</Link>
			))}
		</div>
	);
}
