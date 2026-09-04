import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	cn,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@quiro/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { commands, type FontFamily, type GoogleFont } from "@/utils/tauri";
import IconChevronDown from "~icons/lucide/chevron-down";
import { buildFontRows, CATEGORIES } from "./font-rows";

// One picker for both text surfaces (the screenshot editor's annotations and
// the timeline's text segments). Two sources feed it:
//
//   - `listFontFamilies()` — everything cosmic-text can already shape with:
//     the machine's own installed fonts, plus anything downloaded in an
//     earlier session. These are usable the instant they're picked.
//   - `googleFontCatalog()` — Google's catalogue. Picking one of these
//     downloads it into the same font database first (`installGoogleFont`),
//     so by the time `onChange` fires the renderer can resolve it too.
//
// Nothing is offered that the renderer cannot resolve, which is the whole
// point: `plans/text-engine/`'s premise is that one engine measures text, so
// a family the webview can preview but cosmic-text has never heard of would
// silently render as a fallback.

/** Loads preview stylesheets for families the webview does not have yet, so
 * a row can be rendered in its own typeface before it is installed.
 *
 * `text=` asks Google for a subset covering only the characters actually
 * drawn (the family's own name), so a preview costs a few hundred bytes
 * rather than a whole font; families are batched into one request per render
 * pass, and each is only ever requested once per session. */
function useGoogleFontPreviews(families: string[]) {
	const requested = useRef(new Set<string>());

	useEffect(() => {
		const fresh = families.filter((family) => !requested.current.has(family));
		if (fresh.length === 0) return;
		for (const family of fresh) requested.current.add(family);

		const params = fresh
			.map(
				(family) =>
					`family=${encodeURIComponent(family)}:wght@400;700&text=${encodeURIComponent(family)}`,
			)
			.join("&");

		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
		// Left in the document deliberately: the preview has to keep
		// rendering while the popover is open, and re-adding it on every
		// re-open would re-request what the browser has already cached.
		document.head.appendChild(link);
	}, [families]);
}

export function FontPicker({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (family: string) => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState<string>("all");
	const [installed, setInstalled] = useState<FontFamily[]>([]);
	const [catalog, setCatalog] = useState<GoogleFont[]>([]);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);

	// Both lists are fetched once, the first time the picker is opened —
	// the catalogue is a network call, and a panel that never opens its font
	// dropdown should not make one.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;

		void (async () => {
			const families = await commands.listFontFamilies();
			if (!cancelled) setInstalled(families);
		})();

		void (async () => {
			const result = await commands.googleFontCatalog();
			if (cancelled) return;
			if (result.status === "ok") {
				setCatalog(result.data);
				setCatalogError(null);
			} else {
				setCatalogError(result.error);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [open]);

	const rows = useMemo(
		() =>
			buildFontRows({
				installed: installed.map((family) => family.name),
				catalog,
				search,
				category,
			}),
		[installed, catalog, search, category],
	);

	useGoogleFontPreviews(
		useMemo(
			() => rows.google.flatMap((group) => group.fonts.map((f) => f.family)),
			[rows],
		),
	);

	const pick = async (family: string, needsInstall: boolean) => {
		if (!needsInstall) {
			onChange(family);
			setOpen(false);
			return;
		}

		setInstalling(family);
		const result = await commands.installGoogleFont(family);
		setInstalling(null);

		if (result.status === "error") {
			setCatalogError(result.error);
			return;
		}
		// Re-read rather than assuming: the file decides what family names it
		// actually carries, and the renderer resolves by that name.
		setInstalled(await commands.listFontFamilies());
		onChange(result.data[0] ?? family);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					"flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-gray-5 bg-gray-2 px-2 text-xs text-gray-12 transition-colors hover:bg-gray-3",
					className,
				)}
			>
				{/* The trigger previews too — the current family is drawn in
				    itself, so the panel shows what is selected, not just its
				    name. */}
				<span className="truncate" style={{ fontFamily: `"${value}"` }}>
					{value}
				</span>
				{open ? (
					<IconChevronDown className="size-3.5 shrink-0 text-gray-10 animate-fade-in rotate-180" />
				) : (
					<IconChevronDown className="size-3.5 shrink-0 text-gray-10 animate-fade-in rotate-0" />
				)}
			</PopoverTrigger>

			<PopoverContent className="w-80 p-0!" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search fonts…"
						value={search}
						onValueChange={setSearch}
						className="h-8"
					/>

					<div className="flex flex-wrap gap-1 border-b border-gray-3 p-2">
						{[
							{ id: "all", label: "All" },
							{ id: "installed", label: "Installed" },
							...CATEGORIES,
						].map((entry) => (
							<button
								key={entry.id}
								type="button"
								onClick={() => setCategory(entry.id)}
								className={cn(
									"rounded-md px-2 py-1 text-[11px] transition-colors",
									category === entry.id
										? "bg-gray-4 text-gray-12"
										: "text-gray-10 hover:text-gray-12",
								)}
							>
								{entry.label}
							</button>
						))}
					</div>

					<CommandList className="max-h-72">
						<CommandEmpty>
							{catalogError
								? `Google Fonts unavailable — ${catalogError}`
								: "No fonts found."}
						</CommandEmpty>

						{rows.generic.length > 0 && (
							<CommandGroup heading="Default">
								{rows.generic.map((family) => (
									<FontRow
										key={family}
										family={family}
										selected={family === value}
										onSelect={() => void pick(family, false)}
									/>
								))}
							</CommandGroup>
						)}

						{rows.installed.length > 0 && (
							<CommandGroup heading="Installed">
								{rows.installed.map((family) => (
									<FontRow
										key={family}
										family={family}
										selected={family === value}
										onSelect={() => void pick(family, false)}
									/>
								))}
							</CommandGroup>
						)}

						{rows.google.map((group) => (
							<CommandGroup key={group.id} heading={group.label}>
								{group.fonts.map((font) => (
									<FontRow
										key={font.family}
										family={font.family}
										selected={font.family === value}
										installing={installing === font.family}
										downloadable
										onSelect={() => void pick(font.family, true)}
									/>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function FontRow({
	family,
	selected,
	installing,
	downloadable,
	onSelect,
}: {
	family: string;
	selected: boolean;
	installing?: boolean;
	/** Not on this machine yet — picking it downloads it first. */
	downloadable?: boolean;
	onSelect: () => void;
}) {
	return (
		<CommandItem
			value={family}
			onSelect={onSelect}
			className="flex items-center justify-between gap-2"
		>
			{/* The row is the preview: the name is drawn in its own family, so
			    the list reads as the thing it is choosing between. */}
			<span className="truncate text-sm" style={{ fontFamily: `"${family}"` }}>
				{family}
			</span>
			<span className="shrink-0 text-[10px] text-gray-10">
				{installing
					? "Installing…"
					: selected
						? "✓"
						: downloadable
							? "Download"
							: ""}
			</span>
		</CommandItem>
	);
}
