import { type SVGProps, useEffect, useRef, useState } from "react";
import { FPS, useEditorContext } from "../context";
import { startPlayheadDrag, useTimeline } from "./context";

// The playhead is the one thing on screen that has to move every frame, so it
// is animated by writing a transform straight to the DOM on an animation
// frame. Driving it from React state re-rendered every track at 60Hz, which is
// what made it advance in visible steps.

export function Playhead() {
	const { playback, seek, duration, playing, togglePlay } = useEditorContext();
	const timeline = useTimeline();
	const ref = useRef<HTMLDivElement | null>(null);
	const [dragging, setDragging] = useState(false);

	// Read through refs so the animation loop is never restarted by a zoom or
	// pan — it just picks up the new transform on its next tick.
	const viewportRef = useRef(timeline);
	viewportRef.current = timeline;

	useEffect(() => {
		let raf = 0;
		let lastX = Number.NaN;
		let lastVisible: boolean | null = null;

		const tick = () => {
			raf = requestAnimationFrame(tick);

			const element = ref.current;
			const viewport = viewportRef.current;
			if (!element || viewport.pixelsPerSecond <= 0) return;

			// Interpolated: the backend reports the playhead at its own render
			// rate, which is slower and less regular than the display's.
			const time = playback.getInterpolatedTime();
			const visible =
				time >= viewport.position &&
				time <= viewport.position + viewport.duration;

			if (visible !== lastVisible) {
				lastVisible = visible;
				element.style.visibility = visible ? "visible" : "hidden";
			}

			const x = Math.round(viewport.xOf(time) * 10) / 10;
			if (x !== lastX) {
				lastX = x;
				element.style.transform = `translateX(${x}px)`;
			}
		};

		tick();
		return () => cancelAnimationFrame(raf);
	}, [playback]);

	return (
		<div
			ref={ref}
			className="pointer-events-none absolute top-0 bottom-0 left-0 z-30 ml-10 will-change-transform"
		>
			<div
				role="slider"
				tabIndex={0}
				aria-label="Timeline playhead"
				aria-orientation="horizontal"
				aria-valuemin={0}
				aria-valuemax={duration}
				aria-valuenow={playback.getTime()}
				aria-valuetext={`${playback.getTime().toFixed(2)} seconds`}
				data-dragging={dragging || undefined}
				onPointerDown={(event) => {
					if (playing) togglePlay();

					startPlayheadDrag(event, timeline, seek, setDragging);
				}}
				onKeyDown={(event) => {
					const frameStep = 1 / FPS;
					const step = event.shiftKey ? 1 : frameStep;
					const current = playback.getTime();

					let next: number;

					if (event.key === "ArrowLeft") {
						next = current - step;
					} else if (event.key === "ArrowRight") {
						next = current + step;
					} else if (event.key === "Home") {
						next = 0;
					} else if (event.key === "End") {
						next = duration;
					} else {
						return;
					}

					event.preventDefault();
					event.stopPropagation();

					if (playing) togglePlay();

					seek(Math.min(Math.max(next, 0), duration));
				}}
				className="
      group
      pointer-events-auto
      absolute
      -top-1
      bottom-0
      -left-3
      w-6
      touch-none
      cursor-col-resize
      outline-none
				data-[dragging]:cursor-grabbing
    "
			>
				<div className="pointer-events-none absolute top-6 bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-gray-12/60">
					<div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 -translate-y-1.5 bg-lime-400 group-data-[dragging]:bg-lime-500" />
				</div>
				<div className="pointer-events-none absolute top-0 left-1/2 h-6 w-5 -translate-x-1/2 rounded-md outline-offset-2 group-focus-visible:outline-2 group-focus-visible:outline-accent-focus-ring">
					<TimelinePlayheadIcon className="size-full text-lime-400 drop-shadow-sm transition-colors duration-100 dark-button-shadow group-hover:text-lime-500 group-data-[dragging]:text-lime-500 motion-reduce:transition-none" />
				</div>
			</div>
		</div>
	);
}

type TimelinePlayheadIconProps = SVGProps<SVGSVGElement> & {
	headColor?: string;
	borderColor?: string;
};

export function TimelinePlayheadIcon({
	className,
	headColor = "currentColor",
	...props
}: TimelinePlayheadIconProps) {
	return (
		<svg
			viewBox="0 0 24 28"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			fill="none"
			preserveAspectRatio="xMidYMin meet"
			{...props}
		>
			<path
				d="M5 1.5h14A3.5 3.5 0 0 1 22.5 5v12.2a5 5 0 0 1-1.8 3.8l-7.2 5.8a2.4 2.4 0 0 1-3 0L3.3 21a5 5 0 0 1-1.8-3.8V5A3.5 3.5 0 0 1 5 1.5Z"
				fill={headColor}
				stroke={headColor}
				strokeWidth="1.5"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
