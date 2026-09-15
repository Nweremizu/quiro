import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import SiteFooter from "@/components/layout/site-footer";
import ReleaseHistory from "@/components/releases/release-history";

export const metadata: Metadata = {
	title: "Changelog & releases",
	description:
		"See what’s new in Quiro and download previous versions for Windows, macOS, and Linux.",
	alternates: { canonical: "/releases" },
};

export default function ReleasesPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string | string[] }>;
}) {
	return (
		<>
			<div className="releases-page page-container">
				<header className="release-page-heading">
					<span className="eyebrow">Made better, one release at a time</span>
					<h1>A little more Quiro.</h1>
					<p>New features, thoughtful fixes, and every step along the way.</p>
					<Link href="/download" className="text-link">
						Download the latest version →
					</Link>
				</header>
				<Suspense
					fallback={
						<p className="release-notice" role="status">
							Loading release history…
						</p>
					}
				>
					<ReleaseHistory searchParams={searchParams} />
				</Suspense>
			</div>
			<SiteFooter />
		</>
	);
}
