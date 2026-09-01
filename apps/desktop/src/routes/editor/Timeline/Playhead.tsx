import { useEffect, useRef } from "react";
import { useEditorContext } from "../context";
import { useTimeline } from "./context";

// The playhead is the one thing on screen that has to move every frame, so it
// is animated by writing a transform straight to the DOM on an animation
// frame. Driving it from React state re-rendered every track at 60Hz, which is
// what made it advance in visible steps.

export function Playhead() {
	const { playback } = useEditorContext();
	const timeline = useTimeline();
	const ref = useRef<HTMLDivElement | null>(null);

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
			className="pointer-events-none absolute top-0 bottom-0 left-0 z-30 will-change-transform ml-10"
		>
			<div className="-mt-2 -ml-[calc(0.37rem-0.5px)] size-3 rounded-full bg-[rgb(226,64,64)]" />
			<div className="absolute inset-y-0 left-0 w-px bg-[rgb(226,64,64)]" />
		</div>
	);
}
