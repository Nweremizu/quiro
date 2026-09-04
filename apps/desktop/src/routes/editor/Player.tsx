import { cn, Select } from "@quiro/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import IconLucideChevronFirst from "~icons/lucide/chevron-first";
import IconLucideChevronLast from "~icons/lucide/chevron-last";
import IconLucideCrop from "~icons/lucide/crop";
import IconLucidePause from "~icons/lucide/pause";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideScissors from "~icons/lucide/scissors";
import { ASPECT_RATIO_OPTIONS } from "../screenshot-editor/constants";
import { CanvasElementsOverlay } from "./CanvasElementsOverlay";
import { CropDialog } from "./CropDialog";
import { useEditorContext } from "./context";
import { MaskOverlay } from "./MaskOverlay";
import { PerformanceOverlay } from "./PerformanceOverlay";
import { useLatestFrame } from "./playback-store";
import { SplitScreenOverlay } from "./SplitScreenOverlay";
import { TextOverlay } from "./TextOverlay";
import { EditorButton } from "./ui";

// Cap's player: a settings row across the top, the frame centred on black in
// the middle, and a transport bar underneath — playhead time on the left,
// transport in the centre, edit tools on the right.

function formatTime(seconds: number) {
	const total = Math.max(0, seconds);
	const minutes = Math.floor(total / 60);
	return `${minutes}:${(total % 60).toFixed(2).padStart(5, "0")}`;
}

function Time({ seconds, className }: { seconds: number; className?: string }) {
	return (
		<span className={cn("text-[0.875rem] tabular-nums", className)}>
			{formatTime(seconds)}
		</span>
	);
}

/** The playhead clock, written straight to the DOM on an animation frame so it
 * ticks smoothly without re-rendering the editor. */
function PlayheadTime({ className }: { className?: string }) {
	const { playback, duration } = useEditorContext();
	const ref = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		let raf = 0;
		let shown = "";

		const tick = () => {
			// Interpolation runs ahead of the last reported position, and stopping
			// at the end takes a round trip — neither is a reason to show a time
			// past the end of the video.
			const time = playback.getInterpolatedTime();
			const next = formatTime(duration > 0 ? Math.min(time, duration) : time);
			if (ref.current && next !== shown) {
				shown = next;
				ref.current.textContent = next;
			}
			raf = requestAnimationFrame(tick);
		};

		tick();
		return () => cancelAnimationFrame(raf);
	}, [playback, duration]);

	return (
		<span ref={ref} className={cn("text-[0.875rem] tabular-nums", className)} />
	);
}

export function Player() {
	const {
		project,
		setProject,
		playback,
		duration,
		playing,
		seek,
		togglePlay,
		previewQuality,
		setPreviewQuality,
		splitMode,
		setSplitMode,
	} = useEditorContext();

	// Re-renders only when the frame's *size* changes, not on every frame: the
	// pixels go straight to the canvas from the subscription below.
	const latestFrame = useLatestFrame(playback);

	const [cropOpen, setCropOpen] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [bounds, setBounds] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			// ResizeObserver can fire with the box's current, unchanged size —
			// legitimately, during any animation elsewhere on the page that
			// forces a layout pass (a config-sidebar section opening, say).
			// Setting a new object unconditionally would re-render and
			// reassign the canvas's size on every such tick, which reads as
			// the player shifting even though nothing actually moved.
			setBounds((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Painting happens in the subscription rather than in render, so a 60fps
	// preview costs one drawImage per frame instead of a React commit.
	useEffect(() => {
		const draw = () => {
			const canvas = canvasRef.current;
			const frame = playback.getFrame();
			if (!canvas || !frame) return;

			if (canvas.width !== frame.width) canvas.width = frame.width;
			if (canvas.height !== frame.height) canvas.height = frame.height;

			canvas.getContext("2d")?.drawImage(frame.bitmap, 0, 0);
		};

		draw();
		return playback.subscribeFrame(draw);
	}, [playback]);

	// The frame is letterboxed into whatever space is left, so the canvas is
	// sized to the frame's aspect rather than stretched to the container.
	const size = useMemo(() => {
		const padding = 4;
		const availableWidth = Math.max(bounds.width - padding * 2, 0);
		const availableHeight = Math.max(bounds.height - padding * 2, 0);
		if (availableWidth === 0 || availableHeight === 0)
			return { width: 0, height: 0 };

		const containerAspect = availableWidth / availableHeight;
		const frameAspect =
			latestFrame && latestFrame.height > 0
				? latestFrame.width / latestFrame.height
				: containerAspect;

		return frameAspect < containerAspect
			? { width: availableHeight * frameAspect, height: availableHeight }
			: { width: availableWidth, height: availableWidth / frameAspect };
	}, [bounds, latestFrame]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between gap-3 p-3">
				<div className="flex items-center gap-3">
					<Select
						className="h-9 w-36"
						value={
							ASPECT_RATIO_OPTIONS.find(
								(option) => option.value === (project?.aspectRatio ?? null),
							)?.label ?? "Auto"
						}
						onValueChange={(label) => {
							const next = ASPECT_RATIO_OPTIONS.find(
								(option) => option.label === label,
							);
							if (next)
								setProject((current) => ({
									...current,
									aspectRatio: next.value,
								}));
						}}
						options={ASPECT_RATIO_OPTIONS.map(({ label }) => ({
							value: label,
							label,
						}))}
					/>

					<EditorButton
						tooltip="Crop video"
						onClick={() => setCropOpen(true)}
						leftIcon={<IconLucideCrop className="size-4" />}
					>
						Crop
					</EditorButton>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-gray-11">
						Preview quality
					</span>
					<Select
						className="h-9 w-32"
						value={previewQuality}
						onValueChange={(quality) =>
							setPreviewQuality(quality as typeof previewQuality)
						}
						options={[
							{ label: "Full", value: "full" },
							{ label: "Half", value: "half" },
							{ label: "Quarter", value: "quarter" },
						]}
					/>
				</div>
			</div>

			<div ref={containerRef} className="relative flex-1">
				<PerformanceOverlay />
				<div className="absolute inset-0 flex items-center justify-center overflow-hidden">
					{/* The overlays are positioned against the drawn frame, not the
					    container, so they sit in the same wrapper as the canvas. */}
					<div
						className="relative"
						style={{ width: `${size.width}px`, height: `${size.height}px` }}
					>
						<canvas
							ref={canvasRef}
							style={{
								width: `${size.width}px`,
								height: `${size.height}px`,
								backgroundColor: "#000000",
								visibility: latestFrame ? "visible" : "hidden",
							}}
						/>

						{latestFrame && (
							<>
								<CanvasElementsOverlay size={size} />
								<SplitScreenOverlay size={size} />
								<MaskOverlay size={size} />
								<TextOverlay size={size} />
							</>
						)}
					</div>
				</div>
			</div>

			<div className="relative z-10 flex flex-row items-center justify-between gap-3 overflow-hidden p-5">
				<div className="flex-1">
					<PlayheadTime className="text-gray-12" />
					<span className="text-[0.875rem] tabular-nums text-gray-11"> / </span>
					<Time className="text-gray-11" seconds={duration} />
				</div>

				<div className="flex flex-row items-center justify-center gap-8 text-[0.875rem] text-gray-11">
					<button
						type="button"
						aria-label="Jump to start"
						className="transition-opacity will-change-[opacity] hover:opacity-70"
						onClick={() => seek(0)}
					>
						<IconLucideChevronFirst className="size-4 text-gray-12" />
					</button>

					<button
						type="button"
						aria-label={playing ? "Pause" : "Play"}
						onClick={togglePlay}
						className="flex size-9 items-center justify-center rounded-full border border-gray-6 bg-gray-3 transition-colors hover:bg-gray-4"
					>
						{playing ? (
							<IconLucidePause className="size-3 text-gray-12" />
						) : (
							<IconLucidePlay className="size-3 text-gray-12" />
						)}
					</button>

					<button
						type="button"
						aria-label="Jump to end"
						className="transition-opacity will-change-[opacity] hover:opacity-70"
						onClick={() => seek(duration)}
					>
						<IconLucideChevronLast className="size-4 text-gray-12" />
					</button>
				</div>

				<div className="flex flex-1 flex-row items-center justify-end gap-4">
					<EditorButton
						tooltip="Toggle split"
						kbd={["S"]}
						variant="danger"
						pressed={splitMode}
						onClick={() => setSplitMode(!splitMode)}
						leftIcon={
							<IconLucideScissors
								className={cn(
									"size-4",
									splitMode ? "text-gray-1" : "text-gray-12",
								)}
							/>
						}
					/>
				</div>
			</div>
			<CropDialog open={cropOpen} onOpenChange={setCropOpen} />
		</div>
	);
}
