import IconFilledClock from "~icons/ph/clock-fill";
import IconFilledSettings from "~icons/ph/gear-six-fill";
import IconFilledImage from "~icons/ph/image-fill";
import IconCapture from "~icons/ph/scan-fill";
import IconDetails from "~icons/ph/sliders-horizontal-fill";
import IconFilledStack from "~icons/ph/stack-fill";
import IconFilledTag from "~icons/ph/tag-fill";
import IconFilledTray from "~icons/ph/tray-fill";
import IconFilledVideo from "~icons/ph/video-camera-fill";
import IconQuiroFolder from "~icons/quiro/folder";
import { CaptureDetails } from "./CaptureDetails";
import "./home.css";
import { cn } from "@quiro/ui";
import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
	type DragEvent,
	type MouseEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { openMediaFile } from "@/components/LibraryMenu";
import { NameDialog } from "@/components/NameDialog";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import { listRecordingsQuery, listScreenshotsQuery } from "@/utils/queries";
import { commands } from "@/utils/tauri";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderPlus from "~icons/lucide/folder-plus";
import IconLucideGrid2X2 from "~icons/lucide/grid-2x2";

import IconLucideImage from "~icons/lucide/image";
import IconLucideList from "~icons/lucide/list";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideSearch from "~icons/lucide/search";

import IconLucideStar from "~icons/lucide/star";
import IconLucideTag from "~icons/lucide/tag";
import IconLucideVideo from "~icons/lucide/video";
import IconQuiroLogo from "~icons/quiro/logo";

type MediaKind = "recording" | "screenshot";
type LibraryItem = {
	id: string;
	kind: MediaKind;
	path: string;
	name: string;
	sortTimeMillis: number;
};
type Folder = { id: string; name: string; color: string };
type Tag = { id: string; name: string; color: string };
type Assignment = { folderId?: string; tagIds: string[]; starred?: boolean };
type LibraryState = {
	folders: Folder[];
	tags: Tag[];
	assignments: Record<string, Assignment>;
};
type View =
	| "all"
	| "recent"
	| "recordings"
	| "screenshots"
	| "unfiled"
	| `folder:${string}`
	| `tag:${string}`;
type SortMode = "recent" | "name";
type ViewMode = "grid" | "list";

const STORAGE_KEY = "quiro-home-library-v1";
const FOLDER_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399", "#fb7185"];

const EMPTY_STATE: LibraryState = { folders: [], tags: [], assignments: {} };

function readLibraryState(): LibraryState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY_STATE;
		const parsed = JSON.parse(raw) as Partial<LibraryState>;
		return {
			folders: Array.isArray(parsed.folders) ? parsed.folders : [],
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
			assignments: parsed.assignments ?? {},
		};
	} catch {
		return EMPTY_STATE;
	}
}

function createId(prefix: string) {
	return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function toLibraryItems(
	recordings: RecordingWithPath[] | undefined,
	screenshots: ScreenshotWithPath[] | undefined,
): LibraryItem[] {
	return [
		...(recordings ?? []).map((item) => ({
			id: `recording:${item.path}`,
			kind: "recording" as const,
			path: item.path,
			name: item.prettyName,
			sortTimeMillis: item.sortTimeMillis,
		})),
		...(screenshots ?? []).map((item) => ({
			id: `screenshot:${item.path}`,
			kind: "screenshot" as const,
			path: item.path,
			name: item.prettyName,
			sortTimeMillis: item.sortTimeMillis,
		})),
	];
}

function HomeSidebar({
	view,
	setView,
	state,
	items,
	onCreateFolder,
	onCreateTag,
	onDropItems,
}: {
	view: View;
	setView: (view: View) => void;
	state: LibraryState;
	items: LibraryItem[];
	onCreateFolder: () => void;
	onCreateTag: () => void;
	onDropItems: (folderId: string, ids: string[]) => void;
}) {
	const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
	const primary = [
		{
			id: "all" as const,
			name: "All captures",
			icon: IconFilledStack,
			count: items.length,
		},
		{
			id: "recent" as const,
			name: "Recent",
			icon: IconFilledClock,
			count: Math.min(items.length, 12),
		},
		{
			id: "recordings" as const,
			name: "Recordings",
			icon: IconFilledVideo,
			count: items.filter((item) => item.kind === "recording").length,
		},
		{
			id: "screenshots" as const,
			name: "Screenshots",
			icon: IconFilledImage,
			count: items.filter((item) => item.kind === "screenshot").length,
		},
		{
			id: "unfiled" as const,
			name: "Unfiled",
			icon: IconFilledTray,
			count: items.filter((item) => !state.assignments[item.id]?.folderId)
				.length,
		},
	];
	return (
		<aside className="quiro-library-rail" aria-label="Library navigation">
			<div className="rail-brand py-4 px-4 pb-6">
				<IconQuiroLogo className="rail-logo" />
				<span>
					Quiro<span className="rail-brand-caption">Your creative space</span>
				</span>
			</div>
			<div className="rail-scroll custom-scroll">
				<nav className="rail-navigation" aria-label="Captures">
					{primary.map(({ id, name, icon: Icon, count }) => (
						<button
							key={id}
							type="button"
							className="rail-row"
							aria-current={view === id ? "page" : undefined}
							onClick={() => setView(id)}
						>
							<Icon className="rail-icon" />
							<span className="rail-label">{name}</span>
							<span className="rail-count">{count}</span>
						</button>
					))}
				</nav>
				<section className="rail-section" aria-label="Folders">
					<div className="rail-section-heading">
						<span>Collections</span>
						<button
							type="button"
							onClick={onCreateFolder}
							aria-label="Create folder"
						>
							<IconLucidePlus />
						</button>
					</div>
					{state.folders.map((folder) => (
						<button
							key={folder.id}
							type="button"
							className="rail-row rail-folder"
							aria-current={view === `folder:${folder.id}` ? "page" : undefined}
							data-drop={dragOverFolder === folder.id || undefined}
							onClick={() => setView(`folder:${folder.id}`)}
							onDragOver={(event) => {
								event.preventDefault();
								setDragOverFolder(folder.id);
							}}
							onDragLeave={() => setDragOverFolder(null)}
							onDrop={(event) => {
								event.preventDefault();
								const ids = event.dataTransfer
									.getData("application/x-quiro-items")
									.split("\n")
									.filter(Boolean);
								if (ids.length) onDropItems(folder.id, ids);
								setDragOverFolder(null);
							}}
						>
							<IconQuiroFolder className="rail-icon" />
							<span className="rail-label">{folder.name}</span>
							<span className="rail-count">
								{
									items.filter(
										(item) =>
											state.assignments[item.id]?.folderId === folder.id,
									).length
								}
							</span>
						</button>
					))}
					{state.folders.length === 0 && (
						<button
							type="button"
							className="rail-create"
							onClick={onCreateFolder}
						>
							<IconQuiroFolder />
							<span>
								Your next project starts here
								<span>Create your first folder</span>
							</span>
							<IconLucidePlus />
						</button>
					)}
				</section>
				<section className="rail-section" aria-label="Tags">
					<div className="rail-section-heading">
						<span>Find by tag</span>
						<button type="button" onClick={onCreateTag} aria-label="Create tag">
							<IconLucidePlus />
						</button>
					</div>
					<div className="rail-tags">
						{state.tags.map((tag) => (
							<button
								key={tag.id}
								type="button"
								aria-pressed={view === `tag:${tag.id}`}
								onClick={() => setView(`tag:${tag.id}`)}
							>
								<IconFilledTag />
								<span>{tag.name}</span>
								<span className="rail-count">
									{
										items.filter((item) =>
											state.assignments[item.id]?.tagIds.includes(tag.id),
										).length
									}
								</span>
							</button>
						))}
						{state.tags.length === 0 && (
							<button type="button" onClick={onCreateTag}>
								<IconFilledTag />
								<span>Add your first tag</span>
							</button>
						)}
					</div>
				</section>
			</div>
			<footer className="rail-footer">
				<button
					type="button"
					className="rail-row"
					onClick={() => void commands.showWindow({ Settings: { page: null } })}
				>
					<IconFilledSettings className="rail-icon" />
					<span className="rail-label">Settings</span>
					<span className="rail-settings-arrow" aria-hidden="true">
						↗
					</span>
				</button>
			</footer>
		</aside>
	);
}

function LibraryCard({
	item,
	selected,
	assignment,
	tags,
	onSelect,
	onOpen,
	onDragStart,
	onToggleStar,
	onDetails,
}: {
	item: LibraryItem;
	selected: boolean;
	assignment: Assignment;
	tags: Tag[];
	onSelect: (event: MouseEvent) => void;
	onOpen: () => void;
	onDragStart: (event: DragEvent) => void;
	onToggleStar: () => void;
	onDetails: () => void;
}) {
	const isScreenshot = item.kind === "screenshot";
	return (
		<div
			draggable
			onDragStart={onDragStart}
			onClick={onSelect}
			onDoubleClick={onOpen}
			className={cn(
				"group relative cursor-pointer overflow-hidden rounded-xl border bg-gray-2 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-gray-7 hover:shadow-lg",
				selected
					? "border-accent-border-selected ring-2 ring-accent-focus-ring/30"
					: "border-gray-5",
			)}
		>
			<div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gray-3">
				{isScreenshot ? (
					<img
						src={convertFileSrc(item.path)}
						alt=""
						loading="lazy"
						draggable={false}
						className="size-full object-cover"
					/>
				) : (
					<video
						src={`${convertFileSrc(item.path)}#t=0.1`}
						preload="metadata"
						muted
						playsInline
						className="size-full object-cover"
					/>
				)}
				<div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onToggleStar();
					}}
					aria-label={assignment.starred ? "Unstar project" : "Star project"}
					className={cn(
						"absolute right-2 top-2 rounded-full bg-black/35 p-1.5 text-white/70 opacity-0 transition-opacity group-hover:opacity-100",
						assignment.starred && "opacity-100 text-amber-300",
					)}
				>
					<IconLucideStar
						className={cn("size-3.5", assignment.starred && "fill-current")}
					/>
				</button>
				<div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] font-medium text-white/90">
					{isScreenshot ? (
						<IconLucideImage className="size-3" />
					) : (
						<IconLucideVideo className="size-3" />
					)}
					{isScreenshot ? "Screenshot" : "Recording"}
				</div>
				{selected && (
					<span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded-full bg-accent-solid text-gray-1">
						<IconLucideCheck className="size-3.5" />
					</span>
				)}
			</div>
			<div className="library-card-caption space-y-2 p-3">
				<button
					type="button"
					className="capture-card-details"
					aria-label={`View details for ${item.name}`}
					title="Details and rename"
					onClick={(event) => {
						event.stopPropagation();
						onDetails();
					}}
					onDoubleClick={(event) => event.stopPropagation()}
				>
					<IconDetails />
				</button>
				<p className="truncate text-[13px] font-medium text-gray-12">
					{item.name}
				</p>
				<div className="flex min-h-4 flex-wrap gap-1">
					{tags.slice(0, 3).map((tag) => (
						<span
							key={tag.id}
							className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
							style={{ color: tag.color, backgroundColor: `${tag.color}18` }}
						>
							{tag.name}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

export default function Home() {
	const navigate = useNavigate();
	const recordings = useQuery(listRecordingsQuery);
	const screenshots = useQuery(listScreenshotsQuery);
	const [state, setState] = useState<LibraryState>(() => readLibraryState());
	const [view, setView] = useState<View>("all");
	const [dialog, setDialog] = useState<"folder" | "tag" | "assign" | null>(
		null,
	);
	const [search, setSearch] = useState("");
	const [detailsId, setDetailsId] = useState<string | null>(null);
	const [sort, setSort] = useState<SortMode>("recent");
	const [viewMode, setViewMode] = useState<ViewMode>("grid");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}, [state]);

	useEffect(() => {
		const window = getCurrentWindow();
		let cancelled = false;
		let previousSize: LogicalSize | undefined;
		void (async () => {
			const [size, scaleFactor] = await Promise.all([
				window.innerSize(),
				window.scaleFactor(),
			]);
			previousSize = new LogicalSize(
				size.width / scaleFactor,
				size.height / scaleFactor,
			);
			if (!cancelled) await window.setSize(new LogicalSize(1080, 720));
		})();
		return () => {
			cancelled = true;
			if (previousSize) void window.setSize(previousSize);
		};
	}, []);

	const allItems = useMemo(
		() =>
			toLibraryItems(recordings.data, screenshots.data).sort(
				(a, b) => b.sortTimeMillis - a.sortTimeMillis,
			),
		[recordings.data, screenshots.data],
	);
	const visibleItems = useMemo(() => {
		const query = search.trim().toLowerCase();
		const filtered = allItems.filter((item) => {
			const assignment = state.assignments[item.id] ?? { tagIds: [] };
			if (view === "recordings" && item.kind !== "recording") return false;
			if (view === "screenshots" && item.kind !== "screenshot") return false;
			if (view === "recent" && allItems.indexOf(item) >= 12) return false;
			if (view === "unfiled" && assignment.folderId) return false;
			if (view.startsWith("folder:") && assignment.folderId !== view.slice(7))
				return false;
			if (view.startsWith("tag:") && !assignment.tagIds.includes(view.slice(4)))
				return false;
			return (
				!query ||
				item.name.toLowerCase().includes(query) ||
				assignment.tagIds.some((tagId) =>
					state.tags
						.find((tag) => tag.id === tagId)
						?.name.toLowerCase()
						.includes(query),
				)
			);
		});
		return [...filtered].sort((a, b) =>
			sort === "name"
				? a.name.localeCompare(b.name)
				: b.sortTimeMillis - a.sortTimeMillis,
		);
	}, [allItems, search, sort, state, view]);

	const updateAssignment = (
		ids: string[],
		updater: (assignment: Assignment) => Assignment,
	) => {
		setState((current) => {
			const assignments = { ...current.assignments };
			for (const id of ids)
				assignments[id] = updater(assignments[id] ?? { tagIds: [] });
			return { ...current, assignments };
		});
	};
	const createFolder = () => setDialog("folder");
	const saveFolder = (name: string) => {
		if (!name?.trim()) return;
		setState((current) => ({
			...current,
			folders: [
				...current.folders,
				{
					id: createId("folder"),
					name: name.trim(),
					color: FOLDER_COLORS[current.folders.length % FOLDER_COLORS.length],
				},
			],
		}));
	};
	const createTag = () => setDialog("tag");
	const saveTag = (name: string) => {
		if (!name?.trim()) return;
		setState((current) => ({
			...current,
			tags: [
				...current.tags,
				{
					id: createId("tag"),
					name: name.trim(),
					color: FOLDER_COLORS[current.tags.length % FOLDER_COLORS.length],
				},
			],
		}));
	};
	const dropItems = (folderId: string, ids: string[]) => {
		updateAssignment(ids, (assignment) => ({ ...assignment, folderId }));
		setSelected(new Set());
	};
	const toggleSelection = (event: MouseEvent, id: string) => {
		setSelected((current) => {
			const next = new Set(event.metaKey || event.ctrlKey ? current : []);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const selectedIds = [...selected];
	const addTagToSelection = () => setDialog("assign");
	const assignTag = (name: string) => {
		if (!selectedIds.length) return;
		if (!name?.trim()) return;
		const existing = state.tags.find(
			(tag) => tag.name.toLowerCase() === name.trim().toLowerCase(),
		);
		const tag = existing ?? {
			id: createId("tag"),
			name: name.trim(),
			color: FOLDER_COLORS[state.tags.length % FOLDER_COLORS.length],
		};
		setState((current) => ({
			...current,
			tags: existing ? current.tags : [...current.tags, tag],
			assignments: {
				...current.assignments,
				...Object.fromEntries(
					selectedIds.map((id) => [
						id,
						{
							...(current.assignments[id] ?? { tagIds: [] }),
							tagIds: [
								...new Set([
									...(current.assignments[id]?.tagIds ?? []),
									tag.id,
								]),
							],
						},
					]),
				),
			},
		}));
	};

	const detailsItem = allItems.find((item) => item.id === detailsId);
	const title =
		view === "all"
			? "All captures"
			: view === "recent"
				? "Recent"
				: view === "recordings"
					? "Recordings"
					: view === "screenshots"
						? "Screenshots"
						: view === "unfiled"
							? "Unfiled"
							: view.startsWith("folder:")
								? (state.folders.find((folder) => folder.id === view.slice(7))
										?.name ?? "Folder")
								: (state.tags.find((tag) => tag.id === view.slice(4))?.name ??
									"Tag");

	return (
		<div className="library-home flex h-full min-h-0 flex-1 bg-gray-1 text-gray-12">
			{dialog && (
				<NameDialog
					key={dialog}
					title={
						dialog === "folder"
							? "A space for your next idea"
							: dialog === "assign"
								? "Tag your selection"
								: "Make it easy to find"
					}
					description={
						dialog === "folder"
							? "Keep related recordings and screenshots together in a folder."
							: "Use tags to connect captures across your projects."
					}
					label={dialog === "folder" ? "Folder" : "Tag"}
					onClose={() => setDialog(null)}
					onSubmit={(name) => {
						if (dialog === "folder") saveFolder(name);
						else if (dialog === "assign") assignTag(name);
						else saveTag(name);
						setDialog(null);
					}}
				/>
			)}
			<HomeSidebar
				view={view}
				setView={setView}
				state={state}
				items={allItems}
				onCreateFolder={createFolder}
				onCreateTag={createTag}
				onDropItems={dropItems}
			/>
			<main className="flex min-w-0 flex-1 flex-col">
				<header className="capture-toolbar">
					<div className="capture-heading">
						<h1 className="truncate text-lg font-semibold">{title}</h1>
						<p className="mt-0.5 text-xs text-gray-9">
							{visibleItems.length}{" "}
							{visibleItems.length === 1 ? "project" : "projects"}
						</p>
					</div>
					<div className="capture-toolbar-actions">
						<div className="capture-search flex h-8 w-56 items-center gap-2 rounded-md border border-gray-5 bg-gray-2 px-2.5 focus-within:border-accent-border-selected focus-within:ring-2 focus-within:ring-accent-focus-ring/25">
							<IconLucideSearch className="size-3.5 text-gray-9" />
							<input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search captures"
								aria-label="Search captures"
								className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-8"
							/>
						</div>
						<button
							type="button"
							onClick={createFolder}
							className="flex h-8 items-center gap-1.5 rounded-md border border-gray-5 bg-gray-2 px-2.5 text-xs text-gray-11 hover:border-gray-7 hover:text-gray-12"
						>
							<IconLucideFolderPlus className="size-3.5" />
							New folder
						</button>
						<button
							type="button"
							onClick={() => navigate("/")}
							className="capture-emboss"
						>
							<IconCapture className="size-4" /> Capture
						</button>
					</div>
				</header>
				<div className="flex items-center gap-2 border-b border-gray-5 px-6 py-2.5">
					{selected.size > 0 ? (
						<>
							<span className="text-xs font-medium text-gray-11">
								{selected.size} selected
							</span>
							<button
								type="button"
								onClick={addTagToSelection}
								className="rounded-md bg-gray-4 px-2 py-1 text-[11px] text-gray-11 hover:bg-gray-5"
							>
								<IconLucideTag className="mr-1 inline size-3" />
								Add tag
							</button>
							{state.folders.map((folder) => (
								<button
									key={folder.id}
									type="button"
									onClick={() => dropItems(folder.id, selectedIds)}
									className="rounded-md bg-gray-4 px-2 py-1 text-[11px] text-gray-11 hover:bg-gray-5"
								>
									Move to {folder.name}
								</button>
							))}
							<button
								type="button"
								onClick={() => setSelected(new Set())}
								className="ml-auto text-[11px] text-gray-9 hover:text-gray-12"
							>
								Clear
							</button>
						</>
					) : (
						<span className="text-[11px] text-gray-9">
							Select to organize · use the details icon to rename
						</span>
					)}
					<div className="ml-auto flex items-center gap-1">
						<select
							value={sort}
							onChange={(event) => setSort(event.target.value as SortMode)}
							className="rounded-md border border-gray-5 bg-gray-2 px-2 py-1 text-[11px] text-gray-10 outline-none"
						>
							<option value="recent">Recently added</option>
							<option value="name">Name</option>
						</select>
						<button
							type="button"
							onClick={() => setViewMode("grid")}
							className={cn(
								"rounded p-1.5",
								viewMode === "grid" ? "bg-gray-4 text-gray-12" : "text-gray-9",
							)}
							aria-label="Grid view"
						>
							<IconLucideGrid2X2 className="size-3.5" />
						</button>
						<button
							type="button"
							onClick={() => setViewMode("list")}
							className={cn(
								"rounded p-1.5",
								viewMode === "list" ? "bg-gray-4 text-gray-12" : "text-gray-9",
							)}
							aria-label="List view"
						>
							<IconLucideList className="size-3.5" />
						</button>
					</div>
				</div>
				<div className="custom-scroll min-h-0 flex-1 overflow-y-auto p-6">
					{view === "all" && !search && state.folders.length > 0 && (
						<section className="mb-6">
							<div className="mb-2 flex items-center justify-between">
								<h2 className="text-xs font-semibold text-gray-11">Folders</h2>
								<button
									type="button"
									onClick={createFolder}
									className="text-[11px] text-accent-text hover:underline"
								>
									New folder
								</button>
							</div>
							<div className="grid grid-cols-3 gap-3">
								{state.folders.map((folder) => {
									const count = allItems.filter(
										(item) =>
											state.assignments[item.id]?.folderId === folder.id,
									).length;
									return (
										<button
											key={folder.id}
											type="button"
											onClick={() => setView(`folder:${folder.id}`)}
											onDragOver={(event) => event.preventDefault()}
											onDrop={(event) => {
												event.preventDefault();
												const ids = event.dataTransfer
													.getData("application/x-quiro-items")
													.split("\n")
													.filter(Boolean);
												if (ids.length) dropItems(folder.id, ids);
											}}
											className="flex items-center gap-3 rounded-xl border border-gray-5 bg-gray-2 px-3 py-3 text-left hover:border-gray-7"
										>
											<span
												className="flex size-9 items-center justify-center rounded-lg"
												style={{
													backgroundColor: `${folder.color}18`,
													color: folder.color,
												}}
											>
												<IconLucideFolder className="size-5" />
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-xs font-medium text-gray-12">
													{folder.name}
												</span>
												<span className="text-[11px] text-gray-9">
													{count} {count === 1 ? "project" : "projects"}
												</span>
											</span>
										</button>
									);
								})}
							</div>
						</section>
					)}
					{recordings.isPending || screenshots.isPending ? (
						<div className="grid grid-cols-3 gap-4">
							{[0, 1, 2].map((item) => (
								<div
									key={item}
									className="aspect-video animate-pulse rounded-xl bg-gray-3"
								/>
							))}
						</div>
					) : visibleItems.length === 0 ? (
						<div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
							<div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-gray-3 text-gray-9">
								<IconLucideFolder className="size-6" />
							</div>
							<h2 className="text-sm font-medium">
								{search
									? "No matching projects"
									: "Your project library is empty"}
							</h2>
							<p className="mt-1 max-w-xs text-xs text-gray-9">
								Capture a recording or screenshot, then organize it here with
								folders and tags.
							</p>
						</div>
					) : (
						<div
							className={
								viewMode === "grid"
									? "grid grid-cols-3 gap-4"
									: "flex flex-col gap-2"
							}
						>
							{visibleItems.map((item) => {
								const assignment = state.assignments[item.id] ?? { tagIds: [] };
								const itemTags = state.tags.filter((tag) =>
									assignment.tagIds.includes(tag.id),
								);
								return viewMode === "grid" ? (
									<LibraryCard
										key={item.id}
										item={item}
										selected={selected.has(item.id)}
										assignment={assignment}
										tags={itemTags}
										onSelect={(event) => toggleSelection(event, item.id)}
										onOpen={() => void openMediaFile(item.path)}
										onDragStart={(event) => {
											event.dataTransfer.setData(
												"application/x-quiro-items",
												selected.has(item.id)
													? selectedIds.join("\n")
													: item.id,
											);
											event.dataTransfer.effectAllowed = "move";
										}}
										onDetails={() => {
											setSelected(new Set([item.id]));
											setDetailsId(item.id);
										}}
										onToggleStar={() =>
											updateAssignment([item.id], (current) => ({
												...current,
												starred: !current.starred,
											}))
										}
									/>
								) : (
									<button
										key={item.id}
										type="button"
										onClick={(event) => {
											toggleSelection(event, item.id);
											setDetailsId(item.id);
										}}
										onDoubleClick={() => void openMediaFile(item.path)}
										className={cn(
											"flex items-center gap-3 rounded-lg border px-3 py-2 text-left",
											selected.has(item.id)
												? "border-accent-border-selected bg-accent-solid/10"
												: "border-gray-5 bg-gray-2 hover:border-gray-7",
										)}
									>
										<span className="flex size-8 items-center justify-center rounded-md bg-gray-3 text-gray-9">
											{item.kind === "screenshot" ? (
												<IconLucideImage className="size-4" />
											) : (
												<IconLucideVideo className="size-4" />
											)}
										</span>
										<span className="min-w-0 flex-1 truncate text-xs font-medium">
											{item.name}
										</span>
										{itemTags.map((tag) => (
											<span
												key={tag.id}
												className="rounded-full px-1.5 py-0.5 text-[9px]"
												style={{
													color: tag.color,
													backgroundColor: `${tag.color}18`,
												}}
											>
												{tag.name}
											</span>
										))}
										<IconLucideChevronDown className="size-3.5 rotate-[-90deg] text-gray-8" />
									</button>
								);
							})}
						</div>
					)}
				</div>
			</main>
			{detailsItem && (
				<CaptureDetails
					key={detailsItem.id}
					item={detailsItem}
					folder={
						state.folders.find(
							(folder) =>
								folder.id === state.assignments[detailsItem.id]?.folderId,
						)?.name ?? "Unfiled"
					}
					onClose={() => setDetailsId(null)}
					onSaved={async () => {
						await Promise.all([recordings.refetch(), screenshots.refetch()]);
					}}
				/>
			)}
		</div>
	);
}
