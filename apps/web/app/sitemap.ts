import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();
	return [
		{ url: site.url, lastModified, changeFrequency: "weekly", priority: 1 },
		{
			url: `${site.url}/download`,
			lastModified,
			changeFrequency: "monthly",
			priority: 0.9,
		},
		{
			url: `${site.url}/releases`,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		{
			url: `${site.url}/docs`,
			lastModified,
			changeFrequency: "monthly",
			priority: 0.7,
		},
	];
}
