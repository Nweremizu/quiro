import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	compareReleases,
	compareVersions,
	parseChangelog,
	parseDownloadManifest,
	parseGitHubRelease,
	safeReleaseUrl,
	stableVersion,
} from "./release-data.ts";

const repository = "https://github.com/Nweremizu/quiro";
const base = "https://downloads.example.com";
const asset = (name) => ({
	name,
	size: 1024,
	browser_download_url: `${repository}/releases/download/v0.1.2/${name}`,
});
const release = {
	tag_name: "v0.1.2",
	draft: false,
	prerelease: false,
	html_url: `${repository}/releases/tag/v0.1.2`,
	published_at: "2026-09-12T12:00:00Z",
	assets: [
		asset("Quiro_0.1.2_x64-setup.exe"),
		asset("Quiro_0.1.2_aarch64.dmg"),
		asset("Quiro_0.1.2_x64-setup.exe.sig"),
		asset("Quiro_0.1.2_aarch64.app.tar.gz"),
	],
};

test("historical releases expose only their installers, without inventing a Linux download", () => {
	const parsed = parseGitHubRelease(release, repository);
	assert.deepEqual(
		parsed.installers.map((item) => item.platform),
		["Windows", "macOS"],
	);
	assert.ok(parsed.installers.every((item) => item.url.includes("/v0.1.2/")));
	assert.equal(
		parseGitHubRelease({ ...release, prerelease: true }, repository),
		null,
	);
	assert.equal(
		parseGitHubRelease({ ...release, draft: true }, repository),
		null,
	);
	assert.equal(
		parseGitHubRelease({ ...release, tag_name: "nightly" }, repository),
		null,
	);
});

test("rejects unrelated, mutable, malformed, and wrong-version asset URLs", () => {
	for (const url of [
		"javascript:alert(1)",
		`${repository}-other/releases/file`,
		"https://evil.example/file",
		`${repository}/releases/../private/file`,
	]) {
		assert.equal(safeReleaseUrl(url, `${repository}/releases`), null);
	}
	const parsed = parseGitHubRelease(
		{
			...release,
			assets: [
				asset("Quiro_0.1.3_x64-setup.exe"),
				{
					...asset("Quiro_0.1.2_aarch64.dmg"),
					browser_download_url: `${repository}/releases/latest/download/Quiro.dmg`,
				},
			],
		},
		repository,
	);
	assert.deepEqual(parsed.installers, []);
});

test("manifest uses immutable versioned URL and rejects invalid installer metadata", () => {
	const entry = {
		platform: "Windows",
		fileName: "Quiro_0.1.3_x64-setup.exe",
		bytes: 2048,
		url: `${base}/stable/Quiro.exe`,
		versionedUrl: `${base}/stable/0.1.3/Quiro_0.1.3_x64-setup.exe`,
	};
	const manifest = {
		version: "0.1.3",
		pub_date: "2026-09-13T12:00:00Z",
		downloads: [entry],
	};
	assert.equal(
		parseDownloadManifest(manifest, base).installers[0].url,
		entry.versionedUrl,
	);
	for (const invalid of [
		{ ...entry, versionedUrl: entry.url },
		{ ...entry, bytes: -1 },
		{ ...entry, platform: "Linux" },
	]) {
		assert.equal(
			parseDownloadManifest({ ...manifest, downloads: [invalid] }, base),
			null,
		);
	}
});

test("versions are validated and sorted numerically", () => {
	assert.equal(stableVersion("v0.1.2"), "0.1.2");
	for (const invalid of ["../latest", "0.1.2-beta", ["0.1.2"], "01.2.3"])
		assert.equal(stableVersion(invalid), null);
	assert.deepEqual(
		["0.1.9", "0.1.10", "1.0.0"]
			.map((version) => ({ version }))
			.sort(compareVersions)
			.map((item) => item.version),
		["1.0.0", "0.1.10", "0.1.9"],
	);
});

test("legacy installers stay pinned to their tag and version resets preserve publication order", () => {
	const legacy = parseGitHubRelease(
		{
			...release,
			assets: [
				asset("Quiro-windows-x64.exe"),
				asset("Quiro-arm64.dmg"),
				asset("Quiro-linux-x64.AppImage"),
				asset("Quiro-arm64.dmg.blockmap"),
			],
		},
		repository,
	);
	assert.deepEqual(
		legacy.installers.map((item) => item.platform),
		["Windows", "macOS", "Linux"],
	);
	assert.ok(legacy.installers.every((item) => item.url.includes("/v0.1.2/")));
	assert.deepEqual(
		[
			{ version: "1.3.0", date: "2026-07-27" },
			{ version: "0.1.3", date: "2026-09-13" },
		]
			.sort(compareReleases)
			.map((item) => item.version),
		["0.1.3", "1.3.0"],
	);
});

test("changelog preserves multiline notes, categories and Unreleased separately", () => {
	const parsed = parseChangelog(
		"# Changelog\r\n## [Unreleased]\r\n### Added\r\n- Upcoming\r\n## [0.1.2] - 2026-09-12\r\n### Fixed\r\n- **Recording** fix\r\n  with `details` and a [link](https://example.com)\r\n",
	);
	assert.equal(parsed[0].version, "Unreleased");
	assert.equal(parsed[0].date, null);
	assert.deepEqual(parsed[1].groups, [
		{
			kind: "Fixed",
			items: [
				"**Recording** fix with `details` and a [link](https://example.com)",
			],
		},
	]);
});

test("canonical changelog contains usable notes for current published releases", async () => {
	const markdown = await readFile(
		new URL("../../../CHANGELOG.md", import.meta.url),
		"utf8",
	);
	const entries = parseChangelog(markdown);
	assert.ok(
		entries.some(
			(entry) =>
				entry.version === "0.1.3" &&
				entry.groups.some((group) => group.items.length > 0),
		),
	);
});
