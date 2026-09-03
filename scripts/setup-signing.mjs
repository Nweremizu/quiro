// One-time: generate the Tauri updater signing keypair, put the public key in
// tauri.conf.json, and stash the private key in .env for local builds.
//
//   node scripts/setup-signing.mjs
//
// Then mirror TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD if you set one) into the
// GitHub repo secrets. Losing this key means shipped apps can no longer verify
// updates — back it up somewhere safe.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const keyPath = join(repoRoot, ".tauri-signing.key");

if (existsSync(keyPath)) {
	console.error(
		".tauri-signing.key already exists. Delete it first to regenerate (this invalidates every shipped installer's update path).",
	);
	process.exit(1);
}

const tauri = join(
	repoRoot,
	"apps/desktop/node_modules/.bin",
	process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const r = spawnSync(tauri, ["signer", "generate", "--ci", "-w", keyPath], {
	stdio: "inherit",
	shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);

const pub = readFileSync(`${keyPath}.pub`, "utf8").trim();
const priv = readFileSync(keyPath, "utf8");

const confPath = join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.plugins.updater.pubkey = pub;
writeFileSync(confPath, `${JSON.stringify(conf, null, "\t")}\n`);
console.log("\npublic key written to tauri.conf.json");

const envPath = join(repoRoot, ".env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (!/^TAURI_SIGNING_PRIVATE_KEY=/m.test(env)) {
	env += `${env && !env.endsWith("\n") ? "\n" : ""}TAURI_SIGNING_PRIVATE_KEY=${priv}\nTAURI_SIGNING_PRIVATE_KEY_PASSWORD=\n`;
	writeFileSync(envPath, env);
	console.log("private key written to .env (gitignored)");
}

console.log(
	"\nNext: add these GitHub repo secrets\n" +
		"  TAURI_SIGNING_PRIVATE_KEY           = contents of .tauri-signing.key\n" +
		"  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  = (leave empty)\n" +
		"Back up .tauri-signing.key offline, then you may delete it locally (.env keeps a copy).",
);
