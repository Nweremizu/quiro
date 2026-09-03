import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { resolveResource } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

// Cap fetches its changelog from a web API; Quiro has none, so this reads the
// CHANGELOG.md that `scripts/version.mjs` already maintains, bundled as a Tauri
// resource (see tauri.conf.json `resources`). That keeps one source of truth,
// works offline, and can never show entries for a version that isn't installed.
//
// The file is Keep a Changelog, which is a fixed enough shape to parse directly
// — versions, change-type sections, bullets — rather than pulling in a markdown
// renderer for one page. Parsing it into real structure also lets the page group
// by change type instead of rendering a wall of prose.

type ChangeKind =
	| "Added"
	| "Changed"
	| "Deprecated"
	| "Removed"
	| "Fixed"
	| "Security"
	| "Other";

type ChangeGroup = { kind: ChangeKind; items: string[] };

type ReleaseEntry = {
	version: string;
	date: string | null;
	groups: ChangeGroup[];
};

const KNOWN_KINDS: ChangeKind[] = [
	"Added",
	"Changed",
	"Deprecated",
	"Removed",
	"Fixed",
	"Security",
];

const KIND_STYLES: Record<ChangeKind, string> = {
	Added: "bg-emerald-3 text-emerald-11",
	Fixed: "bg-blue-3 text-blue-11",
	Changed: "bg-indigo-3 text-indigo-11",
	Deprecated: "bg-gray-4 text-gray-11",
	Removed: "bg-red-3 text-red-11",
	Security: "bg-red-3 text-red-11",
	Other: "bg-gray-4 text-gray-11",
};

/**
 * Keep a Changelog subset: `## [version] - date` opens a release, `### Kind`
 * opens a group, `- item` (with hanging indent continuations) is an entry.
 * Anything before the first release heading is the file's own preamble and is
 * dropped — it explains the format to contributors, not to users.
 */
export function parseChangelog(markdown: string): ReleaseEntry[] {
	const releases: ReleaseEntry[] = [];
	let release: ReleaseEntry | null = null;
	let group: ChangeGroup | null = null;

	const flushRelease = () => {
		if (release && release.groups.length > 0) releases.push(release);
	};

	for (const rawLine of markdown.split(/\r?\n/)) {
		const versionMatch = rawLine.match(/^##\s+\[([^\]]+)\]\s*(?:-\s*(.+))?$/);
		if (versionMatch) {
			flushRelease();
			group = null;
			release = {
				version: versionMatch[1].trim(),
				date: versionMatch[2]?.trim() ?? null,
				groups: [],
			};
			continue;
		}

		if (!release) continue;

		const kindMatch = rawLine.match(/^###\s+(.+?)\s*$/);
		if (kindMatch) {
			const raw = kindMatch[1].trim();
			const kind =
				KNOWN_KINDS.find((k) => k.toLowerCase() === raw.toLowerCase()) ??
				"Other";
			group = { kind, items: [] };
			release.groups.push(group);
			continue;
		}

		const bulletMatch = rawLine.match(/^[-*]\s+(.*)$/);
		if (bulletMatch) {
			if (!group) {
				group = { kind: "Other", items: [] };
				release.groups.push(group);
			}
			group.items.push(bulletMatch[1].trim());
			continue;
		}

		// Keep a Changelog wraps long bullets with a hanging indent; those
		// continuation lines belong to the entry above, not to a new one.
		if (group && group.items.length > 0 && /^\s+\S/.test(rawLine)) {
			group.items[group.items.length - 1] += ` ${rawLine.trim()}`;
		}
	}

	flushRelease();
	return releases;
}

/**
 * Inline formatting, limited to what the changelog actually uses: `code`,
 * **bold**, and [text](url). The source is a first-party bundled file, so
 * there's no injection surface here — but links still open through the opener
 * plugin rather than navigating the webview away from the app.
 */
function renderInline(text: string): ReactNode[] {
	const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
	const nodes: ReactNode[] = [];
	let cursor = 0;
	let key = 0;

	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > cursor) nodes.push(text.slice(cursor, index));

		const token = match[0];
		if (token.startsWith("`")) {
			nodes.push(
				<code
					key={`c${key++}`}
					className="rounded bg-gray-4 px-1 py-0.5 font-mono text-[11px] text-gray-12"
				>
					{token.slice(1, -1)}
				</code>,
			);
		} else if (token.startsWith("**")) {
			nodes.push(
				<strong key={`b${key++}`} className="font-semibold text-gray-12">
					{token.slice(2, -2)}
				</strong>,
			);
		} else {
			const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
			if (link) {
				nodes.push(
					<button
						key={`l${key++}`}
						type="button"
						onClick={() => void openUrl(link[2])}
						className="text-accent-text underline underline-offset-2 hover:text-accent-text-strong"
					>
						{link[1]}
					</button>,
				);
			} else {
				nodes.push(token);
			}
		}
		cursor = index + token.length;
	}

	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

export default function ChangelogSettings() {
	const query = useQuery({
		queryKey: ["changelog"],
		queryFn: async () => {
			const path = await resolveResource("CHANGELOG.md");
			return parseChangelog(await readTextFile(path));
		},
	});

	const versionQuery = useQuery({
		queryKey: ["app-version"],
		queryFn: () => getVersion(),
	});

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<SettingsPageContent>
				{query.isPending && (
					<SectionCard padded>
						<div className="space-y-3" aria-hidden="true">
							<div className="h-4 w-32 animate-pulse rounded-full bg-gray-4" />
							<div className="h-3 w-full animate-pulse rounded-full bg-gray-4" />
							<div className="h-3 w-3/4 animate-pulse rounded-full bg-gray-4" />
						</div>
					</SectionCard>
				)}

				{query.isError && (
					<SectionCard padded>
						<p className="text-[13px] text-gray-12">
							Couldn't read the changelog.
						</p>
						<p className="mt-1 text-xs text-gray-10">
							{query.error instanceof Error
								? query.error.message
								: String(query.error)}
						</p>
					</SectionCard>
				)}

				{query.data?.length === 0 && (
					<SectionCard padded>
						<p className="text-[13px] text-gray-12">
							No releases recorded yet.
						</p>
					</SectionCard>
				)}

				{query.data?.map((release, index) => {
					const isUnreleased = /unreleased/i.test(release.version);
					const isCurrent =
						!isUnreleased && release.version === versionQuery.data;

					return (
						<Section
							key={release.version}
							title={isUnreleased ? "Unreleased" : `Version ${release.version}`}
							description={release.date ?? undefined}
							right={
								index === 0 && !isUnreleased ? (
									<span className="rounded-md bg-accent-solid px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-on-solid">
										New
									</span>
								) : isCurrent ? (
									<span className="rounded-md bg-gray-4 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-11">
										Installed
									</span>
								) : undefined
							}
						>
							<SectionCard className="divide-y divide-gray-3">
								{release.groups.map((group) => (
									<div key={group.kind} className="space-y-2 px-4 py-3.5">
										<span
											className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${KIND_STYLES[group.kind]}`}
										>
											{group.kind}
										</span>
										<ul className="space-y-1.5">
											{group.items.map((item) => (
												<li
													key={item}
													className="flex gap-2 text-xs leading-relaxed text-gray-11"
												>
													<span
														aria-hidden="true"
														className="mt-1.5 size-1 shrink-0 rounded-full bg-gray-8"
													/>
													<span className="min-w-0">{renderInline(item)}</span>
												</li>
											))}
										</ul>
									</div>
								))}
							</SectionCard>
						</Section>
					);
				})}
			</SettingsPageContent>
		</div>
	);
}
