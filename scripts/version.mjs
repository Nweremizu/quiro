// Single-sources the app version. Bumps every file that carries it, updates the
// changelog, and creates the release commit + tag. It never pushes — that stays
// a deliberate human step (see RELEASING.md).
//
//   node scripts/version.mjs patch          # tiny  — bugfixes
//   node scripts/version.mjs minor          # small — backward-compatible features
//   node scripts/version.mjs major          # big   — breaking changes / major UX
//   node scripts/version.mjs 1.4.0          # explicit
//   node scripts/version.mjs patch --dry-run
//
// Flags: --dry-run (print, change nothing), --no-tag, --allow-dirty

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rel = (p) => new URL(`../${p}`, import.meta.url);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const bump = args.find((a) => !a.startsWith("--"));
const dryRun = flags.has("--dry-run");

if (!bump) {
	console.error(
		"usage: node scripts/version.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--no-tag] [--allow-dirty]",
	);
	process.exit(1);
}

const git = (...a) =>
	execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();

// --- guards -----------------------------------------------------------------

if (!flags.has("--allow-dirty")) {
	const dirty = git("status", "--porcelain");
	if (dirty) {
		console.error(
			"working tree is not clean:\n" +
				dirty +
				"\n(commit/stash first, or pass --allow-dirty)",
		);
		process.exit(1);
	}
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") {
	console.warn(`! on branch "${branch}", not "main" — continuing anyway`);
}

// --- compute the next version --------------------------------------------------

const TAURI_CONF = "apps/desktop/src-tauri/tauri.conf.json";
const currentConf = JSON.parse(readFileSync(rel(TAURI_CONF), "utf8"));
const current = currentConf.version;

const parse = (v) => {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
	if (!m) throw new Error(`unparseable version: ${v}`);
	return { major: +m[1], minor: +m[2], patch: +m[3] };
};

let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) {
	next = bump;
} else {
	const c = parse(current);
	if (bump === "major") next = `${c.major + 1}.0.0`;
	else if (bump === "minor") next = `${c.major}.${c.minor + 1}.0`;
	else if (bump === "patch") next = `${c.major}.${c.minor}.${c.patch + 1}`;
	else {
		console.error(`unknown bump "${bump}"`);
		process.exit(1);
	}
}

if (git("tag", "--list", `v${next}`)) {
	console.error(`tag v${next} already exists`);
	process.exit(1);
}

console.log(`${current}  ->  ${next}${dryRun ? "  (dry run)" : ""}`);

// --- edits ------------------------------------------------------------------

const edits = [];

// JSON files: reformat is fine, they are tool-owned.
const bumpJson = (path, mut) => {
	const obj = JSON.parse(readFileSync(rel(path), "utf8"));
	mut(obj);
	edits.push([path, `${JSON.stringify(obj, null, "\t")}\n`]);
};
bumpJson(TAURI_CONF, (o) => {
	o.version = next;
});
bumpJson("apps/desktop/package.json", (o) => {
	o.version = next;
});
bumpJson("package.json", (o) => {
	o.version = next;
});

// Cargo.toml / Cargo.lock: surgical regex so nothing else is touched.
const bumpCargoToml = (path) => {
	const src = readFileSync(rel(path), "utf8");
	const out = src.replace(
		/^(\s*)version\s*=\s*"[^"]+"/m,
		`$1version = "${next}"`,
	);
	if (out === src) throw new Error(`no version line found in ${path}`);
	edits.push([path, out]);
};
bumpCargoToml("apps/desktop/src-tauri/Cargo.toml");

{
	const path = "Cargo.lock";
	const src = readFileSync(rel(path), "utf8");
	const out = src.replace(
		/(name = "quiro-desktop"\nversion = ")[^"]+(")/,
		`$1${next}$2`,
	);
	if (out === src)
		throw new Error("quiro-desktop entry not found in Cargo.lock");
	edits.push([path, out]);
}

// --- changelog ------------------------------------------------------------------

{
	const path = "CHANGELOG.md";
	const src = readFileSync(rel(path), "utf8");
	const date = new Date().toISOString().slice(0, 10);
	const header = `## [${next}] - ${date}`;
	// Move everything under "## [Unreleased]" into the new version section.
	const marker = "## [Unreleased]";
	const idx = src.indexOf(marker);
	if (idx === -1)
		throw new Error("CHANGELOG.md is missing a '## [Unreleased]' section");
	const after = src.slice(idx + marker.length);
	const nextSectionIdx = after.search(/\n## \[/);
	const unreleasedBody = (
		nextSectionIdx === -1 ? after : after.slice(0, nextSectionIdx)
	).trim();
	const body = unreleasedBody || "- Maintenance release.";
	const rest = nextSectionIdx === -1 ? "" : after.slice(nextSectionIdx);
	const out = `${src.slice(0, idx)}${marker}\n\n${header}\n\n${body}\n${rest}`;
	edits.push([path, out]);
}

// --- apply ------------------------------------------------------------------

if (dryRun) {
	for (const [path] of edits) console.log(`  would write ${path}`);
	console.log(`  would commit "chore(release): v${next}" and tag v${next}`);
	process.exit(0);
}

for (const [path, content] of edits) {
	writeFileSync(rel(path), content);
	console.log(`  wrote ${path}`);
}

git("add", ...edits.map(([p]) => p));
git("commit", "-m", `chore(release): v${next}`);
if (!flags.has("--no-tag")) {
	git("tag", "-a", `v${next}`, "-m", `v${next}`);
	console.log(`  tagged v${next}`);
}

console.log(
	`\nDone. To publish:\n  git push --follow-tags origin ${branch}\n` +
		`Pushing the tag triggers .github/workflows/release.yml.`,
);
