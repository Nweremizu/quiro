import {
	Button,
	cn,
	Popover,
	PopoverContent,
	PopoverTrigger,
	toast,
} from "@quiro/ui";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type as osType } from "@tauri-apps/plugin-os";
import { useEffect, useRef, useState } from "react";
import { presetsStore } from "@/store";
import { commands, type ProjectConfiguration } from "@/utils/tauri";
import IconLucideBookmark from "~icons/lucide/bookmark";
import IconLucideClapperboard from "~icons/lucide/clapperboard";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideRedo2 from "~icons/lucide/redo-2";
import IconLucideSettings from "~icons/lucide/settings";
import IconLucideStar from "~icons/lucide/star";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideUndo2 from "~icons/lucide/undo-2";
import IconLucideUpload from "~icons/lucide/upload";
import { useEditorContext } from "./context";
import { ExportDialog } from "./ExportDialog";
import { EditorButton } from "./ui";

// Cap's editor header: three drag-region zones — destructive/file actions and
// the name on the left, presets in a bordered middle column, history and the
// export button on the right.

export function Header() {
	const {
		instance,
		prettyName,
		rename,
		undo,
		redo,
		canUndo,
		canRedo,
		project,
		setProject,
		setSelection,
		clipsOpen,
		setClipsOpen,
	} = useEditorContext();

	const [exportOpen, setExportOpen] = useState(false);
	const isMacOS = osType() === "macos";

	const clearSelection = () => setSelection(null);

	const deleteRecording = async () => {
		clearSelection();
		if (!(await ask("Are you sure you want to delete this recording?"))) return;

		const result = await commands.deleteEditorProject();
		if (result.status === "error") toast.error(result.error);
	};

	return (
		<div
			data-tauri-drag-region
			className="relative flex h-14 w-full flex-row items-center"
		>
			<div
				data-tauri-drag-region
				className="flex h-full flex-1 flex-row items-center gap-2 px-4"
			>
				{/* Traffic lights float over this row on macOS. */}
				{isMacOS && <div className="h-full w-16" />}

				<EditorButton
					tooltip="Delete recording"
					onClick={() => void deleteRecording()}
					leftIcon={<IconLucideTrash2 className="size-5" />}
				/>
				<EditorButton
					tooltip="Open recording bundle"
					onClick={() => {
						clearSelection();
						if (instance) void revealItemInDir(`${instance.path}/`);
					}}
					leftIcon={<IconLucideFolder className="size-5" />}
				/>
				{/* App-level, unlike its neighbours — but the editor is a window of
				    its own, so without this the only way to reach settings from
				    here is the tray. */}
				<EditorButton
					tooltip="Settings"
					kbd={["meta", ","]}
					aria-label="Open settings"
					onClick={() => void commands.showWindow({ Settings: { page: null } })}
					leftIcon={<IconLucideSettings className="size-5" />}
				/>

				<NameEditor name={prettyName} onRename={rename} />

				<div data-tauri-drag-region className="h-full flex-1" />
			</div>

			<div
				data-tauri-drag-region
				className="flex flex-row items-center justify-center gap-2 border-x border-gray-3 px-4"
			>
				<PresetsDropdown project={project} setProject={setProject} />
			</div>

			<div
				data-tauri-drag-region
				className="flex h-full flex-1 flex-row items-center gap-2 px-2"
			>
				<EditorButton
					tooltip="Undo"
					kbd={["meta", "Z"]}
					disabled={!canUndo}
					onClick={() => {
						clearSelection();
						undo();
					}}
					leftIcon={<IconLucideUndo2 className="size-5" />}
				/>
				<EditorButton
					tooltip="Redo"
					kbd={["meta", "shift", "Z"]}
					disabled={!canRedo}
					onClick={() => {
						clearSelection();
						redo();
					}}
					leftIcon={<IconLucideRedo2 className="size-5" />}
				/>

				<div data-tauri-drag-region className="h-full flex-1" />

				<Button
					variant={clipsOpen ? "white" : "gray"}
					className="flex h-[40px] justify-center gap-1.5"
					onClick={() => {
						clearSelection();
						setClipsOpen(!clipsOpen);
					}}
				>
					<IconLucideClapperboard className="size-4" />
					Clips
				</Button>

				<button
					type="button"
					disabled={!instance}
					className={cn(
						"flex h-[40px] w-full max-w-[100px] items-center justify-center gap-1.5 rounded-xl px-4 text-[0.8125rem] font-medium text-white outline-hidden",
						"bg-linear-to-b from-accent-300 to-accent-400 dark:from-accent-400 dark:to-accent-500",
						"shadow-[0_4px_14px_-6px_rgba(243,128,31,0.5),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
						"transition-[box-shadow,filter] duration-200 ease-out",
						"hover:brightness-[1.08] hover:shadow-[0_8px_22px_-8px_rgba(243,128,31,0.6),inset_0_1px_0_0_rgba(255,255,255,0.28)]",
						"active:brightness-95 disabled:opacity-50",
					)}
					onClick={() => {
						clearSelection();
						setExportOpen(true);
					}}
				>
					<IconLucideUpload className="size-4" />
					Export
				</button>
			</div>

			<ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
		</div>
	);
}

/** Cap's inline rename: the name reads as plain text until focused, when an
 * invisible input takes over in place. The hidden span measures the text so
 * the field only truncates when it actually overflows. */
function NameEditor({
	name,
	onRename,
}: {
	name: string;
	onRename: (name: string) => Promise<void>;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const measureRef = useRef<HTMLSpanElement | null>(null);
	const [draft, setDraft] = useState(name);
	const [truncated, setTruncated] = useState(false);

	useEffect(() => setDraft(name), [name]);

	useEffect(() => {
		const input = inputRef.current;
		const measure = measureRef.current;
		if (!input || !measure) return;

		measure.textContent = draft;
		setTruncated(input.offsetWidth < measure.offsetWidth);
	}, [draft]);

	const commit = async () => {
		const trimmed = draft.trim();
		if (!trimmed || trimmed === name) {
			setDraft(name);
			return;
		}

		try {
			await onRename(trimmed);
		} catch {
			setDraft(name);
			toast.error("Couldn't rename recording");
		}
	};

	return (
		<div
			title={truncated ? name : undefined}
			className="relative flex flex-row items-center text-sm font-normal text-gray-12"
		>
			<input
				ref={inputRef}
				value={draft}
				aria-label="Recording name"
				className={cn(
					"peer absolute inset-0 m-0 overflow-hidden whitespace-pre border-b border-transparent bg-transparent px-px opacity-0 focus:border-gray-7 focus:opacity-100 focus:outline-hidden",
					truncated && "truncate",
				)}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape")
						inputRef.current?.blur();
				}}
			/>
			<span
				ref={measureRef}
				className="pointer-events-none m-0 max-w-[200px] truncate whitespace-pre border-b border-transparent px-px peer-focus:opacity-0"
			/>
		</div>
	);
}

/** Saved looks: a preset stores everything except the timeline, so applying
 * one restyles a recording without touching its edits. */
function PresetsDropdown({
	project,
	setProject,
}: {
	project: ProjectConfiguration | null;
	setProject: (
		update: (project: ProjectConfiguration) => ProjectConfiguration,
	) => void;
}) {
	const [open, setOpen] = useState(false);
	const presets = presetsStore.useQuery();

	const setDefault = async (index: number) => {
		setOpen(false);
		await presetsStore.set({ default: index });
	};

	const remove = async (index: number) => {
		const current = (await presetsStore.get()) ?? {
			presets: [],
			default: null,
		};
		const presets = current.presets.filter((_, i) => i !== index);

		// The default is stored as an index, so removing an earlier preset would
		// silently repoint it at a different one.
		const nextDefault =
			current.default === null || current.default === index
				? null
				: current.default > index
					? current.default - 1
					: current.default;

		await presetsStore.set({ presets, default: nextDefault });
	};

	const saveNew = async () => {
		if (!project) return;
		setOpen(false);

		const current = (await presetsStore.get()) ?? {
			presets: [],
			default: null,
		};
		await presetsStore.set({
			presets: [
				...current.presets,
				{
					name: `Preset ${current.presets.length + 1}`,
					config: { ...project, timeline: null },
				},
			],
		});
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<EditorButton leftIcon={<IconLucideBookmark className="size-5" />}>
						Presets
					</EditorButton>
				}
			/>
			<PopoverContent className="w-56 p-1" align="center">
				{(presets.data?.presets ?? []).map((preset, index) => (
					<div key={preset.name} className="group flex items-center gap-1">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								setProject((current) => ({
									...preset.config,
									timeline: current.timeline,
								}));
							}}
							className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-12 hover:bg-gray-3"
						>
							{preset.name}
							{presets.data?.default === index && (
								<IconLucideStar className="ml-auto size-3 text-amber-9" />
							)}
						</button>

						<button
							type="button"
							aria-label={`Make ${preset.name} the default`}
							onClick={() => void setDefault(index)}
							className="flex size-7 flex-none items-center justify-center rounded-md text-gray-10 opacity-0 hover:bg-gray-3 hover:text-gray-12 group-hover:opacity-100"
						>
							<IconLucideStar className="size-3.5" />
						</button>
						<button
							type="button"
							aria-label={`Delete ${preset.name}`}
							onClick={() => void remove(index)}
							className="flex size-7 flex-none items-center justify-center rounded-md text-gray-10 opacity-0 hover:bg-red-3 hover:text-red-11 group-hover:opacity-100"
						>
							<IconLucideTrash2 className="size-3.5" />
						</button>
					</div>
				))}

				{(presets.data?.presets.length ?? 0) === 0 && (
					<p className="px-2.5 py-2 text-xs text-gray-10">No presets yet.</p>
				)}

				<button
					type="button"
					onClick={() => void saveNew()}
					className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-gray-3 px-2.5 py-2 text-left text-sm text-gray-11 hover:bg-gray-3"
				>
					Save current style
				</button>
			</PopoverContent>
		</Popover>
	);
}
