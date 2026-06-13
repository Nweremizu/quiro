/* eslint-disable no-undef */
import { spawnSync } from "node:child_process";
import path from "node:path";

const validReleaseTypes = new Set(["patch", "minor", "major"]);
const args = process.argv.slice(2);
const releaseType = args.find((arg) => !arg.startsWith("--"));
const shouldPush = !args.includes("--no-push");
const shouldRunTests = !args.includes("--skip-tests");
const shouldCreateGitHubRelease = !args.includes("--no-github-release");
const isDraft = args.includes("--draft");
const explicitPrerelease = args.includes("--prerelease");

const npmExecPath = process.env.npm_execpath;
const npmInvoker =
  typeof npmExecPath === "string" && npmExecPath.length > 0
    ? {
        command: process.execPath,
        argsPrefix: [npmExecPath],
        shell: false,
      }
    : {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        argsPrefix: [],
        shell: process.platform === "win32",
      };

function printUsage() {
  console.log(`
Usage:
  npm run release:patch
  npm run release:minor
  npm run release:major

Options:
  -- --draft                Create the GitHub release as a draft.
  -- --prerelease           Mark the GitHub release as a prerelease.
  -- --no-push              Create the version commit and tag locally only.
  -- --no-github-release    Push the tag, but do not create a GitHub release.
  -- --skip-tests           Skip npm run test:ci before tagging.
`);
}

function resolveCommand(command, commandArgs) {
  if (command === "npm") {
    return {
      command: npmInvoker.command,
      args: [...npmInvoker.argsPrefix, ...commandArgs],
      shell: npmInvoker.shell,
    };
  }

  return { command, args: commandArgs, shell: false };
}

function run(command, commandArgs, options = {}) {
  const resolved = resolveCommand(command, commandArgs);
  const result = spawnSync(resolved.command, resolved.args, {
    stdio: "inherit",
    shell: resolved.shell,
    ...options,
  });

  if (result.error) {
    throw new Error(`Failed to start ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} exited with code ${result.status}`,
    );
  }
}

function read(command, commandArgs) {
  const resolved = resolveCommand(command, commandArgs);
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: "utf8",
    shell: resolved.shell,
  });

  if (result.error) {
    throw new Error(`Failed to start ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} exited with code ${result.status}`,
    );
  }

  return result.stdout.trim();
}

function commandExists(command, commandArgs = ["--version"]) {
  const resolved = resolveCommand(command, commandArgs);
  const result = spawnSync(resolved.command, resolved.args, {
    stdio: "ignore",
    shell: resolved.shell,
  });

  return result.status === 0;
}

function commandSucceeds(command, commandArgs) {
  const resolved = resolveCommand(command, commandArgs);
  const result = spawnSync(resolved.command, resolved.args, {
    stdio: "ignore",
    shell: resolved.shell,
  });

  return result.status === 0;
}

function tryRun(command, commandArgs, options = {}) {
  const resolved = resolveCommand(command, commandArgs);
  return spawnSync(resolved.command, resolved.args, {
    stdio: "inherit",
    shell: resolved.shell,
    ...options,
  });
}

function ensureCleanWorkingTree() {
  const status = read("git", ["status", "--porcelain"]);

  if (status.length > 0) {
    console.error(
      "Release aborted: commit or stash your current changes first.",
    );
    console.error(status);
    process.exit(1);
  }
}

function createGitHubRelease(tag, version) {
  if (!commandExists("gh")) {
    throw new Error(
      "GitHub CLI is required to create the release. Install gh or use --no-github-release.",
    );
  }

  if (commandSucceeds("gh", ["release", "view", tag])) {
    console.log(`GitHub release ${tag} already exists.`);
    return;
  }

  const releaseArgs = [
    "release",
    "create",
    tag,
    "--verify-tag",
    "--generate-notes",
    "--title",
    tag,
  ];

  if (isDraft) {
    releaseArgs.push("--draft");
  }

  if (explicitPrerelease || version.includes("-")) {
    releaseArgs.push("--prerelease");
  }

  const result = tryRun("gh", releaseArgs);
  if (result.error) {
    throw new Error(`Failed to start gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (commandSucceeds("gh", ["release", "view", tag])) {
      console.log(`GitHub release ${tag} already exists.`);
      return;
    }
    throw new Error(`gh ${releaseArgs.join(" ")} exited with code ${result.status}`);
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

  // npm only creates the release commit/tag when package.json is at the git
  // root. In the monorepo this package lives in apps/desktop, so bump the
  // version without git side effects and do the git work explicitly.
  run("npm", ["version", releaseType, "--no-git-tag-version"]);

  const version = read("node", ["-p", "require('./package.json').version"]);
  const tag = `v${version}`;
  const repoRoot = read("git", ["rev-parse", "--show-toplevel"]);

  // Sync the root lockfile, which records workspace package versions.
  run("npm", ["install", "--package-lock-only"], { cwd: repoRoot });

  run("git", ["add", "package.json"]);
  run("git", ["add", path.join(repoRoot, "package-lock.json")]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", tag]);

  console.log(`Created release commit and tag ${tag}.`);

  if (!shouldPush) {
    console.log(
      `Skipped push. Run "git push origin HEAD" and "git push origin ${tag}" when ready.`,
    );
    return;
  }

  const branch = read("git", ["branch", "--show-current"]);

  if (!branch) {
    throw new Error("Could not determine current branch to push.");
  }

  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", tag]);
  console.log(`Pushed ${branch} and ${tag}.`);

  if (shouldCreateGitHubRelease) {
    createGitHubRelease(tag, version);
    console.log(
      `Published GitHub release ${tag}. The release workflow will upload assets.`,
    );
  } else {
    console.log(
      `Skipped GitHub release creation. Create or publish ${tag} manually to start the workflow.`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
