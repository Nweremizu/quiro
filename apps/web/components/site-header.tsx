import Link from "next/link";
import { site } from "@/lib/site";
import { Icon } from "./icons";
import { Logo } from "./logo";

const navigation = [
	{ href: "/features/", label: "Features" },
	{ href: "/download/", label: "Download" },
	{ href: "/releases/", label: "Releases" },
	{ href: "/support/", label: "Support" },
];

export function SiteHeader() {
	return (
		<header className="site-header">
			<div className="nav-shell">
				<Logo />
				<nav className="desktop-nav" aria-label="Primary navigation">
					{navigation.map((item) => (
						<Link href={item.href} key={item.href}>
							{item.label}
						</Link>
					))}
				</nav>
				<div className="nav-actions">
					<a className="nav-github" href={site.repository}>
						GitHub
					</a>
					<Link className="button button-small button-dark" href="/download/">
						Download
						<Icon name="arrow" />
					</Link>
				</div>
				<details className="mobile-menu">
					<summary aria-label="Open navigation">
						<span />
						<span />
					</summary>
					<nav aria-label="Mobile navigation">
						{navigation.map((item) => (
							<Link href={item.href} key={item.href}>
								{item.label}
							</Link>
						))}
						<a href={site.repository}>GitHub</a>
					</nav>
				</details>
			</div>
		</header>
	);
}
