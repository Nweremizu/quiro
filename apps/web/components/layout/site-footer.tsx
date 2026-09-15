import Link from "next/link";
import QuiroLogo from "@/components/icons/quiro";
import FooterBottom from "@/components/layout/footer-bottom";
import { site } from "@/lib/site";

export default function SiteFooter() {
	return (
		<footer className="page-container site-footer">
			<div className="footer-top">
				<div className="footer-brand">
					<Link href="/" aria-label="Quiro home">
						<QuiroLogo className="size-9" />
						<span>Quiro</span>
					</Link>
					<p>
						Capture a moment.
						<br />
						Make more of it.
					</p>
				</div>
				<div>
					<h3>Product</h3>
					<Link href="/#capture">Capture</Link>
					<Link href="/#edit">Edit</Link>
					<Link href="/#organize">Organize</Link>
					<Link href="/#export">Export</Link>
				</div>
				<div>
					<h3>Explore</h3>
					<Link href="/#use-cases">Use cases</Link>
					<Link href="/#pricing">Pricing</Link>
					<Link href="/#faq">FAQ</Link>
					<Link href="/download">Download</Link>
				</div>
				<div>
					<h3>Resources</h3>
					<Link href="/docs">Getting started</Link>
					<Link href="/releases">Release notes</Link>
					<a href={`${site.repository}/issues`}>Help & feedback</a>
					<a href={site.repository}>GitHub</a>
				</div>
			</div>
			<FooterBottom>
				<a href="#main-content">Back to top ↑</a>
			</FooterBottom>
		</footer>
	);
}
