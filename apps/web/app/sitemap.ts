import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		"",
		"/features",
		"/download",
		"/releases",
		"/support",
		"/privacy",
		"/terms",
	].map((path) => ({
		url: `${site.url}${path}`,
		lastModified: new Date(),
		changeFrequency: path === "" ? "weekly" : "monthly",
		priority: path === "" ? 1 : 0.7,
	}));
}
