// Builds the desktop app on this machine the way CI would, but reading secrets
// from a local .env instead of GitHub Secrets. Produces an installable bundle
// under target/release/bundle/ (or target/debug/bundle/ with --debug).
//
//   node scripts/build-local.mjs              # full release bundle
//   node scripts/build-local.mjs --debug      # fast, unoptimised, still installable
//   node scripts/build-local.mjs -c src-tauri/tauri.nightly.conf.json
//
// Any extra args are forwarded to `tauri build`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const passthrough = process.argv.slice(2);

// --- load .env (only fills gaps; real env wins) ------------------------------

const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, "utf8").split("\n")) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
	}
	console.log("loaded .env");
}

const run = (cmd, args) => {
	console.log(`\n$ ${cmd} ${args.join(" ")}`);
	const r = spawnSync(cmd, args, {
		cwd: repoRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (r.status !== 0) process.exit(r.status ?? 1);
};

// --- native deps -----------------------------------------------------------

run("node", ["scripts/setup-onnxruntime.js"]);
run("node", ["scripts/setup-ffmpeg.mjs"]);

// --- updater endpoint override ----------------------------------------------
// The committed config carries a placeholder host. If RELEASE_BASE_URL is set,
// bake the real endpoint in so this build's auto-update actually resolves.

const tauriArgs = ["build", ...passthrough];
const base = process.env.RELEASE_BASE_URL;
if (base) {
	const channel = passthrough.some((a) => a.includes("nightly"))
		? "nightly"
		: "stable";
	tauriArgs.push(
		"--config",
		JSON.stringify({
			plugins: { updater: { endpoints: [`${base}/${channel}/latest.json`] } },
		}),
	);
	console.log(`updater endpoint -> ${base}/${channel}/latest.json`);
} else {
	console.warn(
		"! RELEASE_BASE_URL not set — auto-update in this build points at a placeholder host",
	);
}

if (
	!process.env.TAURI_SIGNING_PRIVATE_KEY &&
	!passthrough.includes("--debug")
) {
	console.warn(
		"! TAURI_SIGNING_PRIVATE_KEY not set — a release build with createUpdaterArtifacts will fail.\n" +
			"  Run: pnpm setup:signing   (or add --debug for a quick unsigned test build)",
	);
}

// Call the Tauri CLI directly — going through pnpm here trips its
// package-manager self-management on Windows.
const tauriBin = join(
	repoRoot,
	"apps/desktop/node_modules/.bin",
	process.platform === "win32" ? "tauri.cmd" : "tauri",
);
console.log(`\n$ ${tauriBin} ${tauriArgs.join(" ")}`);
const r = spawnSync(tauriBin, tauriArgs, {
	cwd: join(repoRoot, "apps/desktop"),
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);

// --- report --------------------------------------------------------------------

const bundleRoot = join(
	repoRoot,
	"target",
	passthrough.includes("--debug") ? "debug" : "release",
	"bundle",
);
if (existsSync(bundleRoot)) {
	console.log("\nBundles:");
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(exe|msi|dmg|AppImage|deb)$/.test(name))
				console.log(`  ${p}`);
		}
	};
	walk(bundleRoot);
}
