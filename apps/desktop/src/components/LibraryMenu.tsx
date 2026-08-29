import { cn } from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import { commands } from "@/utils/tauri";
import IconLucideHistory from "~icons/lucide/history";
import IconLucideImage from "~icons/lucide/image";
import IconVideo from "~icons/quiro/camera";

// Screenshots are always PNG (capture.rs/library.rs never write anything
// else) and recordings are always MP4 (RecordingMeta::output_path) — that's
// enough to route without every caller having to pass its own kind down.
// A screenshot opens in Quiro's own editor; there's still no video-editor
// port, so a recording is handed to the OS's own default app for it via
// plugin-shell's `open`, which also happily opens a plain file path.
export async function openMediaFile(path: string) {
	if (path.toLowerCase().endsWith(".png")) {
		await commands.showWindow({ ScreenshotEditor: { path } });
		return;
	}
	await open(path);
}

const RECENTS_LIMIT = 9;

export type RecentMediaItem = {
	kind: "recording" | "screenshot";
	path: string;
	prettyName: string;
	sortTimeMillis: number;
};

export function mergeRecentMedia(
	recordings: RecordingWithPath[] = [],
	screenshots: ScreenshotWithPath[] = [],
): RecentMediaItem[] {
	return [
		...recordings.map((r) => ({ kind: "recording" as const, ...r })),
		...screenshots.map((s) => ({ kind: "screenshot" as const, ...s })),
	]
		.sort((a, b) => b.sortTimeMillis - a.sortTimeMillis)
		.slice(0, RECENTS_LIMIT);
}

function RecentCard({ item }: { item: RecentMediaItem }) {
	const [previewFailed, setPreviewFailed] = useState(false);
	const isScreenshot = item.kind === "screenshot";
	const src = convertFileSrc(item.path);

	return (
		<button
			type="button"
			onClick={() => void openMediaFile(item.path)}
			title={item.prettyName}
			aria-label={`Open ${isScreenshot ? "screenshot" : "recording"} ${item.prettyName}`}
			className="group relative h-24 w-38 shrink-0 snap-start overflow-hidden rounded-lg border border-gray-6 bg-gray-3 text-left outline-none ring-1 ring-transparent transition-[border-color,box-shadow] duration-150 hover:border-accent-400 hover:ring-accent-400/30 focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1"
		>
			<div className="absolute inset-0 flex items-center justify-center bg-gray-4">
				{isScreenshot ? (
					<IconLucideImage className="size-5 text-gray-9 opacity-70" />
				) : (
					<IconVideo className="size-5 text-gray-9 opacity-70" />
				)}
			</div>
			{!previewFailed &&
				(isScreenshot ? (
					<img
						src={src}
						alt=""
						loading="lazy"
						draggable={false}
						onError={() => setPreviewFailed(true)}
						className="relative h-full w-full object-cover"
					/>
				) : (
					// ponytail: the recording pipeline writes no poster image, so the
					// `#t=` media fragment makes the webview decode and paint one frame
					// itself — no ffmpeg pass, no thumbnail cache to invalidate. A video
					// that can't be decoded paints nothing, leaving the icon behind it
					// visible. Generate real posters in `stop_recording` if this ever
					// costs too much on a large library.
					<video
						src={`${src}#t=0.1`}
						preload="metadata"
						muted
						playsInline
						onError={() => setPreviewFailed(true)}
						className="relative h-full w-full object-cover"
					/>
				))}
			<div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
			<div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/90">
				{isScreenshot ? (
					<IconLucideImage className="size-2.5" />
				) : (
					<IconVideo className="size-2.5" />
				)}
				{isScreenshot ? "Screenshot" : "Recording"}
			</div>
			<p className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-2 pb-1.5 text-[11px] font-medium text-white">
				{item.prettyName}
			</p>
		</button>
	);
}

type CarouselMetrics = {
	canScrollLeft: boolean;
	canScrollRight: boolean;
	progress: number;
	thumbFraction: number;
};

const EDGE_FADE_LEFT = "24px";
const EDGE_FADE_RIGHT = "32px";

function RecentsCarousel({ children }: { children: React.ReactNode }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<number | undefined>(undefined);
	const [metrics, setMetrics] = useState<CarouselMetrics>({
		canScrollLeft: false,
		canScrollRight: false,
		progress: 0,
		thumbFraction: 1,
	});

	const scheduleMeasure = useCallback(() => {
		if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = undefined;
			const element = scrollRef.current;
			if (!element) return;

			const maxScrollLeft = Math.max(
				0,
				element.scrollWidth - element.clientWidth,
			);
			setMetrics({
				canScrollLeft: element.scrollLeft > 1,
				canScrollRight: maxScrollLeft - element.scrollLeft > 1,
				progress: maxScrollLeft > 0 ? element.scrollLeft / maxScrollLeft : 0,
				thumbFraction:
					element.scrollWidth > 0
						? Math.min(1, element.clientWidth / element.scrollWidth)
						: 1,
			});
		});
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		// React registers `wheel` on the root as a *passive* listener, so
		// preventDefault() from an onWheel prop is ignored and the window
		// scrolls vertically instead of the strip moving sideways. Only a
		// native listener opted out of passive can claim the gesture.
		const handleWheel = (event: WheelEvent) => {
			if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

			const maxScrollLeft = Math.max(
				0,
				element.scrollWidth - element.clientWidth,
			);
			const nextScrollLeft = Math.min(
				maxScrollLeft,
				Math.max(0, element.scrollLeft + event.deltaY),
			);
			if (nextScrollLeft === element.scrollLeft) return;

			event.preventDefault();
			element.scrollLeft = nextScrollLeft;
		};

		// Both boxes: the viewport for window resizes, and the content row so
		// adding or removing a card re-measures too — the scroll container's own
		// border box never changes when its children do.
		const observer = new ResizeObserver(scheduleMeasure);
		observer.observe(element);
		if (contentRef.current) observer.observe(contentRef.current);
		element.addEventListener("wheel", handleWheel, { passive: false });
		scheduleMeasure();

		return () => {
			observer.disconnect();
			element.removeEventListener("wheel", handleWheel);
			if (frameRef.current !== undefined)
				cancelAnimationFrame(frameRef.current);
		};
	}, [scheduleMeasure]);

	const maskImage = `linear-gradient(to right, transparent, black ${
		metrics.canScrollLeft ? EDGE_FADE_LEFT : "0px"
	}, black calc(100% - ${
		metrics.canScrollRight ? EDGE_FADE_RIGHT : "0px"
	}), transparent)`;
	const isScrollable = metrics.canScrollLeft || metrics.canScrollRight;

	return (
		<div className="flex flex-col gap-1.5">
			<div
				ref={scrollRef}
				onScroll={scheduleMeasure}
				className="hide-scroll snap-x snap-proximity overflow-x-auto overscroll-x-contain scroll-smooth pt-0.5 pb-1"
				style={{
					maskImage,
					WebkitMaskImage: maskImage,
					scrollbarWidth: "none",
				}}
			>
				<div ref={contentRef} className="flex w-max gap-2">
					{children}
				</div>
			</div>
			<div
				className={cn(
					"mx-auto h-0.5 w-20 overflow-hidden rounded-full bg-gray-5 transition-opacity duration-200",
					isScrollable ? "opacity-100" : "opacity-0",
				)}
			>
				<div
					className="h-full rounded-full bg-accent-400"
					style={{
						width: `${metrics.thumbFraction * 100}%`,
						marginInlineStart: `${
							metrics.progress * (1 - metrics.thumbFraction) * 100
						}%`,
					}}
				/>
			</div>
		</div>
	);
}

function RecentsPlaceholder({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-6 bg-gray-2 px-4 text-center text-xs text-gray-10">
			{children}
		</div>
	);
}

export function Recents({
	items,
	isLoading,
	errorMessage,
}: {
	items: RecentMediaItem[];
	isLoading: boolean;
	errorMessage?: string;
}) {
	return (
		<section className="flex flex-col gap-1.5">
			<span className="px-1 text-xs font-semibold text-gray-12 font-sans">
				Recents
			</span>
			{errorMessage ? (
				<RecentsPlaceholder>{errorMessage}</RecentsPlaceholder>
			) : isLoading ? (
				<div className="flex gap-2 overflow-hidden">
					{[0, 1, 2, 3].map((index) => (
						<div
							key={index}
							className="h-24 w-38 shrink-0 animate-pulse rounded-lg bg-gray-3"
						/>
					))}
				</div>
			) : items.length === 0 ? (
				<RecentsPlaceholder>
					<IconLucideHistory className="size-4 text-gray-9" />
					Your latest captures will appear here.
				</RecentsPlaceholder>
			) : (
				<RecentsCarousel>
					{items.map((item) => (
						<RecentCard key={item.path} item={item} />
					))}
				</RecentsCarousel>
			)}
		</section>
	);
}
