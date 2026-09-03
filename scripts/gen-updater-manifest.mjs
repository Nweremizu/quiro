// Builds the `latest.json` that the Tauri updater fetches, from a directory of
// bundle artifacts collected off the release matrix.
//
//   node scripts/gen-updater-manifest.mjs \
//     --artifacts ./artifacts --version 1.2.3 --channel stable \
//     --base-url https://downloads.example.com/updates \
//     --notes-file ./notes.md --out ./manifest
//
// Output: <out>/<channel>/latest.json, referencing files at
// <base-url>/<channel>/<version>/<file>. Uploading the bundle files to that
// location is the release workflow's job (see .github/workflows/build.yml).

import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Accepts `--key value` and `--key=value`.
const args = {};
{
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const eq = a.indexOf("=");
		if (eq !== -1) {
			args[a.slice(2, eq)] = a.slice(eq + 1);
		} else {
			args[a.slice(2)] = argv[++i];
		}
	}
}

for (const req of ["artifacts", "version", "channel", "base-url"]) {
	if (!args[req]) {
		console.error(`missing --${req}`);
		process.exit(1);
	}
}

const { artifacts, version, channel } = args;
const baseUrl = args["base-url"].replace(/\/$/, "");
const outDir = args.out || "./manifest";
const notes = args["notes-file"]
	? readFileSync(args["notes-file"], "utf8").trim()
	: `Quiro ${version}`;

// The updater downloads the bundle whose `.sig` sits next to it. Order matters:
// the first suffix that resolves for a platform key wins, so the form the
// current Tauri actually signs is listed first, older archive forms after.
//
//   Windows: the NSIS installer .exe is signed directly
//   macOS:   the .app is delivered as a tarball (a .dmg can't self-update)
//   Linux:   the AppImage, signed directly on current Tauri, .tar.gz on older
const PLATFORMS = [
	{ suffix: "x64-setup.exe", key: "windows-x86_64" },
	{ suffix: "arm64-setup.exe", key: "windows-aarch64" },
	{ suffix: "x64-setup.nsis.zip", key: "windows-x86_64" },
	{ suffix: "arm64-setup.nsis.zip", key: "windows-aarch64" },
	{ suffix: "aarch64.app.tar.gz", key: "darwin-aarch64" },
	{ suffix: "x64.app.tar.gz", key: "darwin-x86_64" },
	{ suffix: "x86_64.app.tar.gz", key: "darwin-x86_64" },
	{ suffix: "amd64.AppImage", key: "linux-x86_64" },
	{ suffix: "aarch64.AppImage", key: "linux-aarch64" },
	{ suffix: "amd64.AppImage.tar.gz", key: "linux-x86_64" },
	{ suffix: "aarch64.AppImage.tar.gz", key: "linux-aarch64" },
];

const walk = (dir) => {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
};

const files = walk(artifacts);
const platforms = {};
const seen = new Set();

for (const { suffix, key } of PLATFORMS) {
	const bundle = files.find((f) => f.endsWith(suffix));
	if (!bundle) continue;
	if (seen.has(key)) continue;

	const sig = files.find((f) => f === `${bundle}.sig`);
	const fileName = bundle.split(/[\\/]/).pop();
	if (!sig) {
		console.warn(
			`! no .sig for ${fileName} — updater will reject it; skipping`,
		);
		continue;
	}

	platforms[key] = {
		signature: readFileSync(sig, "utf8").trim(),
		url: `${baseUrl}/${channel}/${version}/${encodeURIComponent(fileName)}`,
	};
	seen.add(key);
	console.log(`  ${key}  <-  ${fileName}`);
}

if (Object.keys(platforms).length === 0) {
	console.error("no signed updater bundles found — nothing to publish");
	process.exit(1);
}

const manifest = {
	version,
	notes,
	pub_date: new Date().toISOString(),
	platforms,
};

const dest = join(outDir, channel);
mkdirSync(dest, { recursive: true });
writeFileSync(
	join(dest, "latest.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
	`\nwrote ${join(dest, "latest.json")} (${Object.keys(platforms).length} platforms)`,
);
