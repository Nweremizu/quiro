import { Button, toast } from "@quiro/ui";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useMemo, useState } from "react";
import { TargetCardSkeleton } from "@/routes/launch/TargetCard";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import IconLucideImport from "~icons/lucide/import";
import IconLucideSearch from "~icons/lucide/search";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

// Both managers are the same page with a different noun, so they share this
// rather than being copy-pasted: the cards, the search behaviour and the empty
// states then can't drift apart. TargetCard is reused verbatim from the main
// window's library — it already implements open, reveal, copy, save and delete,
// and it already takes `highlightQuery`, so search highlighting comes for free.

type MediaItem = RecordingWithPath | ScreenshotWithPath;

export function MediaManager<T extends MediaItem>({
	title,
	description,
	items,
	isPending,
	queryKey,
	importLabel,
	importCommand,
	importFilter,
	renderCard,
}: {
	title: string;
	description: string;
	items: T[] | undefined;
	isPending: boolean;
	queryKey: readonly unknown[];
	importLabel: string;
	/** Throws with the Rust-side message when the import is declined. */
	importCommand: (source: string) => Promise<void>;
	importFilter: { name: string; extensions: string[] };
	renderCard: (
		item: T,
		highlightQuery: string,
		refetch: () => void,
	) => ReactNode;
}) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [importing, setImporting] = useState(false);

	const refetch = () => {
		void queryClient.invalidateQueries({ queryKey });
	};

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return items ?? [];
		return (items ?? []).filter((item) =>
			item.prettyName.toLowerCase().includes(query),
		);
	}, [items, search]);

	const handleImport = async () => {
		if (importing) return;

		const selected = await open({
			multiple: false,
			filters: [importFilter],
		}).catch((error) => {
			console.error("Failed to open file picker:", error);
			return null;
		});

		if (typeof selected !== "string") return;

		setImporting(true);
		try {
			await importCommand(selected);
			refetch();
			toast.success("Imported");
		} catch (error) {
			// The Rust side returns why it declined — unsupported container,
			// unreadable file — which is more useful than a generic failure.
			toast.error(String(error));
		} finally {
			setImporting(false);
		}
	};

	const hasItems = (items?.length ?? 0) > 0;

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<SettingsPageContent>
				<Section
					title={title}
					description={description}
					right={
						<Button
							variant="dark"
							size="sm"
							disabled={importing}
							onClick={() => void handleImport()}
							className="flex items-center gap-1.5"
						>
							<IconLucideImport className="size-3.5" />
							{importing ? "Importing…" : importLabel}
						</Button>
					}
				>
					{hasItems && (
						<div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-5 bg-gray-2 px-3 focus-within:ring-2 focus-within:ring-accent-focus-ring">
							<IconLucideSearch className="size-3.5 shrink-0 text-gray-10" />
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search"
								aria-label={`Search ${title.toLowerCase()}`}
								className="w-full bg-transparent py-2 text-[13px] text-gray-12 outline-none placeholder:text-gray-9"
							/>
						</div>
					)}

					{isPending ? (
						<div className="grid grid-cols-3 gap-3">
							<TargetCardSkeleton />
							<TargetCardSkeleton />
							<TargetCardSkeleton />
						</div>
					) : !hasItems ? (
						<SectionCard padded>
							<p className="text-center text-xs text-gray-10">
								Nothing here yet. Capture something, or use {importLabel}.
							</p>
						</SectionCard>
					) : filtered.length === 0 ? (
						<SectionCard padded>
							<p className="text-center text-xs text-gray-10">
								Nothing matches “{search.trim()}”.
							</p>
						</SectionCard>
					) : (
						<div className="grid grid-cols-3 gap-3">
							{filtered.map((item) => renderCard(item, search.trim(), refetch))}
						</div>
					)}
				</Section>
			</SettingsPageContent>
		</div>
	);
}
