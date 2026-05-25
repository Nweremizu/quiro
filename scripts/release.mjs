import { spawnSync } from "node:child_process";

const validReleaseTypes = new Set(["patch", "minor", "major"]);
const args = process.argv.slice(2);
const releaseType = args.find((arg) => !arg.startsWith("--"));
const shouldPush = !args.includes("--no-push");
const shouldRunTests = !args.includes("--skip-tests");

function printUsage() {
	console.log(`
Usage:
  npm run release:patch
  npm run release:minor
  npm run release:major

Options:
  -- --no-push      Create the version commit and tag locally, but do not push.
  -- --skip-tests   Skip npm run test:ci before tagging.
`);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
		...options,
	});

	if (result.error) {
		throw new Error(`Failed to start ${command}: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
	}
}

function read(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		shell: process.platform === "win32",
	});

	if (result.error) {
		throw new Error(`Failed to start ${command}: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
	}

	return result.stdout.trim();
}

function ensureCleanWorkingTree() {
	const status = read("git", ["status", "--porcelain"]);

	if (status.length > 0) {
		console.error("Release aborted: commit or stash your current changes first.");
		console.error(status);
		process.exit(1);
	}
}

function main() {
	if (!validReleaseTypes.has(releaseType)) {
		printUsage();
		process.exit(1);
	}

	ensureCleanWorkingTree();

	if (shouldRunTests) {
		run("npm", ["run", "test:ci"]);
	}

	run("npm", ["version", releaseType, "-m", "chore(release): v%s"]);

	const version = read("node", ["-p", "require('./package.json').version"]);
	const tag = `v${version}`;

	console.log(`Created release ${tag}.`);

	if (shouldPush) {
		const branch = read("git", ["branch", "--show-current"]);

		if (!branch) {
			throw new Error("Could not determine current branch to push.");
		}

		run("git", ["push", "origin", branch]);
		run("git", ["push", "origin", tag]);
		console.log(`Pushed ${branch} and ${tag}. GitHub Actions will publish the release.`);
	} else {
		console.log(`Skipped push. Run "git push origin HEAD" and "git push origin ${tag}" when ready.`);
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
