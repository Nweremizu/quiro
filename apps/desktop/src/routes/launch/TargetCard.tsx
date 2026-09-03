import { cn, toast } from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { copyFile, remove } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
	type ComponentProps,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useMemo,
	useState,
} from "react";
import { openMediaFile } from "@/components/LibraryMenu";
import { Tooltip } from "@/components/Tooltip";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import type {
	CaptureDisplayWithThumbnail,
	CaptureWindowWithThumbnail,
} from "@/utils/tauri";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideExternalLink from "~icons/lucide/external-link";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideImage from "~icons/lucide/image";
import IconLucideSave from "~icons/lucide/save";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconQuiroCamera from "~icons/quiro/camera";
import IconQuiroMonitor from "~icons/quiro/monitor";
import IconQuiroWindow from "~icons/quiro/window";

function formatResolution(width?: number, height?: number) {
	if (!width || !height) return undefined;

	const roundedWidth = Math.round(width);
	const roundedHeight = Math.round(height);

	if (roundedWidth <= 0 || roundedHeight <= 0) return undefined;

	return `${roundedWidth}×${roundedHeight}`;
}

function formatRefreshRate(refreshRate?: number) {
	if (!refreshRate) return undefined;

	return `${refreshRate} Hz`;
}

type TargetCardProps = (
	| {
			variant: "display";
			target: CaptureDisplayWithThumbnail;
	  }
	| {
			variant: "window";
			target: CaptureWindowWithThumbnail;
	  }
	| {
			variant: "recording";
			target: RecordingWithPath;
			onRefetch?: () => void;
	  }
	| {
			variant: "screenshot";
			target: ScreenshotWithPath;
	  }
) &
	Omit<ComponentProps<"button">, "children"> & {
		highlightQuery?: string;
	};

export default function TargetCard(props: TargetCardProps) {
	const { variant, target, className, disabled, highlightQuery, ...rest } =
		props;
	const [imageExists, setImageExists] = useState(true);

	const displayTarget = variant === "display" ? target : undefined;
	const windowTarget = variant === "window" ? target : undefined;
	const recordingTarget = variant === "recording" ? target : undefined;
	const screenshotTarget = variant === "screenshot" ? target : undefined;
	const onRefetch = props.variant === "recording" ? props.onRefetch : undefined;

	const renderIcon = (iconClassName: string) =>
		variant === "display" ? (
			<IconQuiroMonitor className={iconClassName} />
		) : variant === "window" ? (
			<IconQuiroWindow className={iconClassName} />
		) : variant === "recording" ? (
			<IconQuiroCamera className={iconClassName} />
		) : (
			<IconLucideImage className={iconClassName} />
		);

	const label = (() => {
		if (displayTarget) return displayTarget.name;
		if (windowTarget) return windowTarget.name || windowTarget.owner_name;
		if (recordingTarget) return recordingTarget.prettyName;
		return screenshotTarget?.prettyName;
	})();

	// No `mode` on recordings in this backend (no studio/instant tracking yet) —
	// subtitle only applies to windows.
	const subtitle = windowTarget?.owner_name;

	const metadata = (() => {
		if (windowTarget) {
			const resolution = formatResolution(
				windowTarget.bounds.size.width,
				windowTarget.bounds.size.height,
			);
			const refreshRate = formatRefreshRate(windowTarget.refresh_rate);

			if (resolution && refreshRate) return `${resolution} @ ${refreshRate}`;
			return resolution ?? refreshRate ?? undefined;
		}
		return displayTarget
			? formatRefreshRate(displayTarget.refresh_rate)
			: undefined;
	})();

	// Recordings have no reliable thumbnail file in this backend (see
	// LibraryMenu.tsx) — only screenshots (the file itself is the image) and
	// display/window capture previews get one.
	//
	// `thumbnail` and `app_icon` arrive from Rust as *complete* data URIs, not
	// bare base64 — see `capture_single_frame_thumbnail` / `to_png_data_uri_raw`
	// in capture_targets.rs, both of which already prepend the
	// `data:image/png;base64,` header. Adding it again here produced a
	// double-prefixed, undecodable URI, which is why every thumbnail silently
	// fell back to the placeholder icon.
	const thumbnailSrc = useMemo(() => {
		if (screenshotTarget)
			return `${convertFileSrc(screenshotTarget.path)}?t=${Date.now()}`;
		return displayTarget?.thumbnail ?? windowTarget?.thumbnail ?? undefined;
	}, [screenshotTarget, displayTarget, windowTarget]);

	const appIconSrc = windowTarget?.app_icon ?? undefined;

	const normalizedQuery = highlightQuery?.trim() ?? "";

	const highlight = (text?: string | null) => {
		if (!text) return text;
		if (!normalizedQuery) return text;

		const regex = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
		const parts = text.split(regex);
		if (parts.length === 1) return text;

		const lowercaseQuery = normalizedQuery.toLowerCase();

		return parts.map((part, i) =>
			part.toLowerCase() === lowercaseQuery ? (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: static split of one string per render, order never changes
					key={i}
					className="rounded-sm bg-accent-solid/20 px-px text-gray-12"
				>
					{part}
				</span>
			) : (
				part
			),
		);
	};

	const handleOpen = (e: ReactMouseEvent) => {
		e.stopPropagation();
		const path = recordingTarget?.path ?? screenshotTarget?.path;
		if (!path) return;
		void openMediaFile(path);
	};

	const handleCopy = async (e: ReactMouseEvent) => {
		e.stopPropagation();
		if (!screenshotTarget) return;
		try {
			const image = await Image.fromPath(screenshotTarget.path);
			await writeImage(image);
			toast.success("Screenshot copied to clipboard");
		} catch (error) {
			console.error("Failed to copy screenshot:", error);
			toast.error("Failed to copy screenshot");
		}
	};

	const handleSave = async (e: ReactMouseEvent) => {
		e.stopPropagation();
		if (!screenshotTarget) return;
		try {
			const path = await save({
				defaultPath: `${screenshotTarget.prettyName}.png`,
				filters: [{ name: "Image", extensions: ["png"] }],
			});
			if (!path) return;
			await copyFile(screenshotTarget.path, path);
			toast.success("Screenshot saved");
		} catch (error) {
			console.error("Failed to save screenshot:", error);
			toast.error("Failed to save screenshot");
		}
	};

	const handleOpenFolder = (e: ReactMouseEvent) => {
		e.stopPropagation();
		if (!recordingTarget) return;
		revealItemInDir(recordingTarget.path).catch((error) => {
			console.error("Failed to open recording folder:", error);
			toast.error("Failed to open folder");
		});
	};

	const handleDelete = async (e: ReactMouseEvent) => {
		e.stopPropagation();
		if (!recordingTarget) return;
		if (!(await ask("Are you sure you want to delete this recording?"))) return;
		try {
			await remove(recordingTarget.path, { recursive: true });
			onRefetch?.();
		} catch (error) {
			console.error("Failed to delete recording:", error);
			toast.error("Failed to delete recording");
		}
	};

	return (
		<button
			type="button"
			{...rest}
			disabled={disabled}
			data-variant={variant}
			className={cn(
				"group flex flex-col overflow-hidden rounded-lg border border-transparent bg-gray-3 text-left outline-none transition-colors duration-100 hover:bg-gray-4 focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1",
				disabled && "pointer-events-none opacity-60",
				className,
			)}
		>
			<div className="relative h-19 w-full overflow-hidden bg-gray-4/40">
				{imageExists && thumbnailSrc ? (
					<img
						src={thumbnailSrc}
						alt={`${variant === "display" ? "Display" : "Window"} preview for ${label}`}
						className="h-full w-full object-cover"
						loading="lazy"
						draggable={false}
						onError={() => setImageExists(false)}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-gray-4">
						{renderIcon("size-6 text-gray-9 opacity-70")}
					</div>
				)}
				{appIconSrc && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
						<img
							src={appIconSrc}
							alt={`${label} icon`}
							className="h-16 w-16 max-h-[55%] max-w-[55%] rounded-lg border border-black/20 object-contain shadow-lg shadow-black/30"
							draggable={false}
						/>
					</div>
				)}
				<div className="pointer-events-none absolute inset-0 border border-black/5 opacity-60" />
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/40 to-transparent" />
			</div>
			<div className="flex w-full flex-col">
				<div className="flex flex-row items-start gap-2 px-2 py-1.5">
					<div className="min-w-0 flex-1">
						<p className="truncate text-[11px] font-medium text-gray-12">
							{highlight(label)}
						</p>
						{subtitle && (
							<p className="truncate text-[11px] text-gray-11">
								{highlight(subtitle)}
							</p>
						)}
						{metadata && (
							<p className="truncate text-[11px] text-gray-10">
								{highlight(metadata)}
							</p>
						)}
					</div>
				</div>
				{variant === "screenshot" && (
					<div className="flex items-center justify-between gap-1 px-2 pb-1.5 pt-0.5">
						<ActionButton tooltip="Open" onClick={handleOpen}>
							<IconLucideExternalLink className="size-3.5" />
						</ActionButton>
						<ActionButton tooltip="Copy to clipboard" onClick={handleCopy}>
							<IconLucideCopy className="size-3.5" />
						</ActionButton>
						<ActionButton tooltip="Save as..." onClick={handleSave}>
							<IconLucideSave className="size-3.5" />
						</ActionButton>
					</div>
				)}
				{variant === "recording" && (
					<div className="flex items-center justify-between gap-1 px-2 pb-1.5 pt-0.5">
						<ActionButton tooltip="Open" onClick={handleOpen}>
							<IconLucideExternalLink className="size-3.5" />
						</ActionButton>
						<ActionButton tooltip="Open folder" onClick={handleOpenFolder}>
							<IconLucideFolder className="size-3.5" />
						</ActionButton>
						<ActionButton tooltip="Delete" onClick={handleDelete}>
							<IconLucideTrash2 className="size-3.5" />
						</ActionButton>
					</div>
				)}
			</div>
		</button>
	);
}

function ActionButton({
	tooltip,
	onClick,
	children,
}: {
	tooltip: string;
	onClick: (e: ReactMouseEvent) => void;
	children: ReactNode;
}) {
	return (
		<Tooltip content={tooltip}>
			<div
				role="button"
				tabIndex={-1}
				onClick={onClick}
				className="flex flex-1 items-center justify-center rounded-sm p-1 text-gray-11 transition-colors hover:bg-gray-5 hover:text-gray-12"
			>
				{children}
			</div>
		</Tooltip>
	);
}

function escapeRegExp(value: string) {
	return value.replace(/[\^$*+?.()|[\]{}-]/g, "\\$&");
}

export function TargetCardSkeleton({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden rounded-lg bg-gray-3",
				className,
			)}
		>
			<div className="h-19 w-full animate-pulse bg-gray-4" />
			<div className="flex flex-row items-start gap-2 px-2 py-1.5">
				<div className="flex-1 space-y-1">
					<div className="h-3 w-3/4 rounded-sm bg-gray-4" />
					<div className="h-2.5 w-1/2 rounded-sm bg-gray-4" />
					<div className="h-2.5 w-2/5 rounded-sm bg-gray-4" />
				</div>
			</div>
		</div>
	);
}
