// Bakes the real release host into the committed Tauri configs. Run once after
// creating the Cloudflare bucket + domain (see docs/RELEASE_INFRA.md).
//
//   node scripts/set-release-url.mjs https://downloads.quiro.app

import { readFileSync, writeFileSync } from "node:fs";

const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) {
	console.error("usage: node scripts/set-release-url.mjs https://<host>");
	process.exit(1);
}
const base = url.replace(/\/$/, "");

for (const [file, channel] of [
	["apps/desktop/src-tauri/tauri.conf.json", "stable"],
	["apps/desktop/src-tauri/tauri.nightly.conf.json", "nightly"],
]) {
	const j = JSON.parse(readFileSync(file, "utf8"));
	j.plugins.updater.endpoints = [`${base}/${channel}/latest.json`];
	writeFileSync(file, `${JSON.stringify(j, null, "\t")}\n`);
	console.log(`${file}  ->  ${base}/${channel}/latest.json`);
}
console.log(
	"\nAlso set the repo variable RELEASE_BASE_URL to the same value (see docs/RELEASE_INFRA.md).",
);
