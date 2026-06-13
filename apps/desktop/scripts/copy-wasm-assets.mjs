/**
 * Copies WASM binaries from node_modules into public/wasm/ so they are served
 * as static assets by Vite (both in dev mode and in the packaged Electron app).
 *
 * Run automatically via postinstall. Can also be run manually:
 *   node scripts/copy-wasm-assets.mjs
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicWasmDir = path.join(rootDir, "public", "wasm");

/**
 * Locate a package directory by walking up from this workspace through
 * parent node_modules folders. npm workspaces hoist most packages to the
 * monorepo root, so the package may not live in the workspace's own
 * node_modules. (require.resolve can't be used here: web-demuxer restricts
 * its "exports" field, so subpaths like package.json are not resolvable.)
 */
function findPackageDir(packageName) {
	let current = rootDir;
	for (;;) {
		const candidate = path.join(current, "node_modules", packageName);
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

const webDemuxerDir = findPackageDir("web-demuxer");

const assets = [
	{
		src: webDemuxerDir
			? path.join(webDemuxerDir, "dist", "wasm-files", "web-demuxer.wasm")
			: path.join(rootDir, "node_modules", "web-demuxer", "dist", "wasm-files", "web-demuxer.wasm"),
		dest: path.join(publicWasmDir, "web-demuxer.wasm"),
		label: "web-demuxer.wasm",
	},
];

let hadError = false;

mkdirSync(publicWasmDir, { recursive: true });

for (const { src, dest, label } of assets) {
	if (!existsSync(src)) {
		console.error(`[copy-wasm-assets] Source not found for ${label}: ${src}`);
		hadError = true;
		continue;
	}

	try {
		copyFileSync(src, dest);
		console.log(`[copy-wasm-assets] Copied ${label}`);
	} catch (err) {
		console.error(`[copy-wasm-assets] Failed to copy ${label}: ${err.message}`);
		hadError = true;
	}
}

if (hadError) {
	process.exit(1);
}
