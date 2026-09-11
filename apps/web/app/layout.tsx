import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/site";
import "./globals.css";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist",
	display: "swap",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
	display: "swap",
});

export const metadata: Metadata = {
	metadataBase: new URL(site.url),
	title: {
		default: "Quiro — Beautiful screen recordings, owned by you",
		template: "%s — Quiro",
	},
	description: site.description,
	applicationName: site.name,
	openGraph: {
		type: "website",
		siteName: site.name,
		title: "Quiro — Beautiful screen recordings, owned by you",
		description: site.description,
	},
	twitter: {
		card: "summary_large_image",
		title: "Quiro — Beautiful screen recordings, owned by you",
		description: site.description,
		images: ["/opengraph-image.png"],
	},
};

export const viewport: Viewport = {
	themeColor: "#fdfdfe",
	colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
			<body>
				<a className="skip-link" href="#main-content">
					Skip to content
				</a>
				<SiteHeader />
				<main id="main-content">{children}</main>
				<SiteFooter />
			</body>
		</html>
	);
}
