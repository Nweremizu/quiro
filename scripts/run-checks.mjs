// Runs the standalone `*.check.ts` self-checks. These assert non-trivial
// geometry that has no test runner behind it; CI and `pnpm check` call this.
//
// Each check is bundled with esbuild's JS API (esbuild is already present via
// the desktop workspace's Vite — no extra dependency) and run in-process. A
// check reports failure by throwing.

import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDir = join(repoRoot, "apps/desktop");
const srcAlias = join(desktopDir, "src");

const CHECKS = [
	"src/routes/screenshot-editor/arrow.check.ts",
	"src/routes/screenshot-editor/geometry.check.ts",
	"src/routes/screenshot-editor/space.check.ts",
	"src/routes/screenshot-editor/transform.check.ts",
];

const require = createRequire(join(desktopDir, "package.json"));
const esbuild = await import(pathToFileURL(require.resolve("esbuild")));

let failed = 0;

for (const rel of CHECKS) {
	process.stdout.write(`\n▶ ${rel}\n`);
	try {
		const { outputFiles } = await esbuild.build({
			entryPoints: [join(desktopDir, rel)],
			bundle: true,
			platform: "node",
			format: "esm",
			write: false,
			alias: { "@": srcAlias },
			logLevel: "warning",
		});
		const code = outputFiles[0].text;
		// Data-URL import runs the bundle in this process; a throw propagates.
		await import(
			`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
		);
	} catch (err) {
		failed++;
		console.error(String(err?.message || err));
	}
}

if (failed > 0) {
	console.error(`\n${failed} check file(s) failed`);
	process.exit(1);
}
console.log("\nAll checks passed");
