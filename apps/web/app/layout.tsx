import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/site";

const sans = DM_Sans({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const mono = JetBrains_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
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
		url: site.url,
		description: site.description,
	},
	twitter: {
		card: "summary_large_image",
		title: "Quiro — Beautiful screen recordings, owned by you",
		description: site.description,
		images: ["/images/hero-img.png"],
	},
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			data-scroll-behavior="smooth"
			className={`${sans.variable} ${mono.variable} h-full antialiased`}
			suppressHydrationWarning
		>
			<body suppressHydrationWarning>
				<main id="main-content" tabIndex={-1} className="w-full">
					{children}
				</main>
			</body>
		</html>
	);
}
