import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import AutoImport from "unplugin-auto-import/vite";
import { FileSystemIconLoader } from "unplugin-icons/loaders";
import IconsResolver from "unplugin-icons/resolver";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [
		react(),
		tailwindcss(),
		// On-demand icon components: `import XIcon from "~icons/lucide/x"`.
		// Resolves for @quiro/ui's components too, since the package ships raw
		// TSX and this app's Vite is what actually bundles it.
		AutoImport({
			resolvers: [
				IconsResolver({
					prefix: "Icon",
					extension: "jsx",
				}),
			],
		}),
		Icons({
			compiler: "jsx",
			jsx: "react",
			autoInstall: true,
			customCollections: {
				// Quiro's own icon set — `import XIcon from "~icons/quiro/camera"`,
				// sourced from apps/desktop/src/assets/icons/quiro/*.svg. Every icon
				// there is hand-drawn with a hardcoded black stroke; this transform
				// swaps that for currentColor so they behave like every other icon
				// in the app (recolor with a `text-*` class, resize with `size-*`)
				// instead of needing per-icon fixups whenever one is added.
				quiro: FileSystemIconLoader("./src/assets/icons/quiro", (svg) =>
					svg
						.replace(/stroke="#000000"/g, 'stroke="currentColor"')
						.replace(/fill="#000000"/g, 'fill="currentColor"'),
				),
			},
		}),
	],

	// Mirrors the tsconfig.json "@/*" path mapping — TS understands it on its
	// own, but Vite's bundler needs its own alias or it can't resolve it.
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
