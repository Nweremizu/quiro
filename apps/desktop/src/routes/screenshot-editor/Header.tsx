import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	toast,
} from "@quiro/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type as osType } from "@tauri-apps/plugin-os";
import { useState } from "react";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideMoreHorizontal from "~icons/lucide/more-horizontal";
import IconLucideSave from "~icons/lucide/save";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { FileNameEditor } from "./file-name-editor";
import { useScreenshotExport } from "./useScreenshotExport";

export function Header({
	prettyName,
	path,
	onRename,
}: {
	prettyName: string;
	path: string;
	onRename: (next: string) => void | Promise<void>;
}) {
	const [moreOpen, setMoreOpen] = useState(false);
	// Save and Copy both go through the renderer rather than reading the preview
	// canvas: the on-screen frame is fitted to the window, so copying it would
	// hand over a downscaled image with no annotations composited in.
	const { exportImage, isExporting } = useScreenshotExport();

	const deleteScreenshot = async () => {
		setMoreOpen(false);
		if (
			!(await ask("This permanently deletes the screenshot file.", {
				title: "Delete screenshot?",
				kind: "warning",
				okLabel: "Delete screenshot",
				cancelLabel: "Cancel",
			}))
		)
			return;
		try {
			await remove(path);
			// Best-effort: the metadata sidecar (library.rs) and this editor's
			// own project sidecar (screenshot_editor.rs) are both named off the
			// image path, and neither is required to exist — a never-edited
			// screenshot has no project sidecar at all.
			await Promise.all(
				[".json", ".project.json"].map((extension) =>
					remove(path.replace(/\.png$/i, extension)).catch(() => {}),
				),
			);
			await getCurrentWindow().close();
		} catch (error) {
			console.error("Failed to delete screenshot:", error);
			toast.error("Failed to delete screenshot");
		}
	};

	// WindowLayout supplies the generic titlebar (Windows caption controls /
	// Linux zoom button) on every route except this one on macOS — see its
	// isSuppressedOnMac check — so on macOS this row is the *only* chrome,
	// and needs its own reserved space for the native traffic lights that
	// float over it via the window's TitleBarStyle::Overlay.
	const isMacOS = osType() === "macos";

	return (
		<div
			data-tauri-drag-region
			className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-3 bg-gray-1 px-4"
		>
			{isMacOS && <div className="w-16 shrink-0" data-tauri-drag-region />}
			<FileNameEditor
				name={prettyName}
				onRename={(next) =>
					Promise.resolve(onRename(next)).catch(() => {
						toast.error("Couldn't rename screenshot");
					})
				}
			/>

			<div className="flex items-center gap-2">
				<Button
					variant="gray"
					size="icon"
					aria-label="Copy to clipboard"
					title="Copy to clipboard"
					disabled={isExporting}
					onClick={() => void exportImage("clipboard")}
				>
					<IconLucideCopy className="size-4" />
				</Button>
				<Button
					variant="gray"
					size="icon"
					aria-label="Save screenshot"
					title="Save screenshot"
					disabled={isExporting}
					onClick={() => void exportImage("file")}
				>
					<IconLucideSave className="size-4" />
				</Button>

				<Popover open={moreOpen} onOpenChange={setMoreOpen}>
					<PopoverTrigger
						render={
							<Button
								variant="gray"
								size="icon"
								aria-label="More actions"
								title="More actions"
							>
								<IconLucideMoreHorizontal className="size-4" />
							</Button>
						}
					/>
					<PopoverContent className="w-48 p-1" align="end">
						<button
							type="button"
							onClick={() => {
								setMoreOpen(false);
								void revealItemInDir(path);
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-12 hover:bg-gray-3"
						>
							<IconLucideFolder className="size-4 text-gray-11" />
							Open Folder
						</button>
						<button
							type="button"
							onClick={() => void deleteScreenshot()}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-9 hover:bg-red-3"
						>
							<IconLucideTrash2 className="size-4" />
							Delete
						</button>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
