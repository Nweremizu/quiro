import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
	outputFileTracingIncludes: {
		"/api/changelog": ["../../CHANGELOG.md"],
		"/releases": ["../../CHANGELOG.md"],
	},
};

export default nextConfig;
