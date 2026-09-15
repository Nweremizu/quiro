export type Platform = "Windows" | "macOS" | "Linux";
export type Installer = {
	platform: Platform;
	url: string;
	fileName: string;
	bytes: number;
};
export type Release = {
	version: string;
	date: string;
	url: string;
	installers: Installer[];
};
export type ChangeGroup = { kind: string; items: string[] };
export type ChangeEntry = {
	version: string;
	date: string | null;
	groups: ChangeGroup[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableVersion(value: unknown): string | null {
	return typeof value === "string" &&
		/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
		? value.replace(/^v/, "")
		: null;
}

export function installerPlatform(name: string): Platform | null {
	if (name === "Quiro-windows-x64.exe") return "Windows";
	if (name === "Quiro-arm64.dmg") return "macOS";
	if (name === "Quiro-linux-x64.AppImage") return "Linux";
	if (/_x64-setup\.exe$/i.test(name)) return "Windows";
	if (/_aarch64\.dmg$/i.test(name)) return "macOS";
	if (/_amd64\.AppImage$/i.test(name)) return "Linux";
	return null;
}

export function safeReleaseUrl(value: unknown, base: string): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		const allowed = new URL(base);
		return url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			url.origin === allowed.origin &&
			url.pathname.startsWith(`${allowed.pathname.replace(/\/$/, "")}/`)
			? url.href
			: null;
	} catch {
		return null;
	}
}

export function parseGitHubRelease(
	value: unknown,
	repository: string,
): Release | null {
	if (!isRecord(value) || value.draft !== false || value.prerelease !== false)
		return null;
	const version = stableVersion(value.tag_name);
	const url = safeReleaseUrl(value.html_url, `${repository}/releases`);
	if (
		!version ||
		!url ||
		typeof value.published_at !== "string" ||
		!Number.isFinite(Date.parse(value.published_at)) ||
		!Array.isArray(value.assets)
	)
		return null;
	const installers: Installer[] = [];
	for (const asset of value.assets) {
		if (!isRecord(asset) || typeof asset.name !== "string") continue;
		const platform = installerPlatform(asset.name);
		const assetUrl = safeReleaseUrl(
			asset.browser_download_url,
			`${repository}/releases/download/${value.tag_name}`,
		);
		if (
			!platform ||
			!assetUrl ||
			(!asset.name.includes(`_${version}_`) &&
				!/^Quiro-(windows-x64\.exe|arm64\.dmg|linux-x64\.AppImage)$/.test(
					asset.name,
				)) ||
			typeof asset.size !== "number" ||
			!Number.isFinite(asset.size) ||
			asset.size <= 0 ||
			installers.some((item) => item.platform === platform)
		)
			continue;
		installers.push({
			platform,
			url: assetUrl,
			fileName: asset.name,
			bytes: asset.size,
		});
	}
	return { version, date: value.published_at, url, installers };
}

export function parseDownloadManifest(
	value: unknown,
	releaseBase: string,
): Release | null {
	if (!isRecord(value)) return null;
	const version = stableVersion(value.version);
	if (
		!version ||
		typeof value.pub_date !== "string" ||
		!Number.isFinite(Date.parse(value.pub_date)) ||
		!Array.isArray(value.downloads)
	)
		return null;
	const installers: Installer[] = [];
	for (const entry of value.downloads) {
		if (!isRecord(entry) || typeof entry.fileName !== "string") continue;
		const platform = installerPlatform(entry.fileName);
		const url = safeReleaseUrl(
			entry.versionedUrl,
			`${releaseBase}/stable/${version}`,
		);
		if (
			!platform ||
			entry.platform !== platform ||
			!url ||
			!entry.fileName.includes(`_${version}_`) ||
			typeof entry.bytes !== "number" ||
			!Number.isFinite(entry.bytes) ||
			entry.bytes <= 0 ||
			installers.some((item) => item.platform === platform)
		)
			continue;
		installers.push({
			platform,
			url,
			fileName: entry.fileName,
			bytes: entry.bytes,
		});
	}
	return installers.length
		? { version, date: value.pub_date, url: "", installers }
		: null;
}

export function compareVersions(a: Release, b: Release): number {
	const left = a.version.split(".").map(Number);
	const right = b.version.split(".").map(Number);
	return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
}

export function compareReleases(a: Release, b: Release): number {
	return Date.parse(b.date) - Date.parse(a.date) || compareVersions(a, b);
}

export function parseChangelog(markdown: string): ChangeEntry[] {
	const entries: ChangeEntry[] = [];
	let entry: ChangeEntry | undefined;
	let group: ChangeGroup | undefined;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = line.match(
			/^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/,
		);
		if (heading) {
			entry = { version: heading[1], date: heading[2] ?? null, groups: [] };
			entries.push(entry);
			group = undefined;
			continue;
		}
		if (!entry) continue;
		const kind = line.match(/^###\s+(.+?)\s*$/);
		if (kind) {
			group = { kind: kind[1], items: [] };
			entry.groups.push(group);
			continue;
		}
		const bullet = line.match(/^[-*]\s+(.+)$/);
		if (bullet) {
			if (!group) {
				group = { kind: "Updates", items: [] };
				entry.groups.push(group);
			}
			group.items.push(bullet[1]);
		} else if (group?.items.length && /^\s+\S/.test(line)) {
			group.items[group.items.length - 1] += ` ${line.trim()}`;
		}
	}
	return entries.filter((item) =>
		item.groups.some((section) => section.items.length),
	);
}

export function formatReleaseDate(date: string): string {
	return new Intl.DateTimeFormat("en", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(new Date(date));
}

export function formatBytes(bytes: number): string {
	return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}
