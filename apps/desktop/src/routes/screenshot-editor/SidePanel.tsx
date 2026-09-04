import { useEffect, useRef, useState } from "react";

// The reveal wrapper for the editor's docked panels. The animation itself is
// entirely CSS (`.t-panel-slide` in `App.css` — transitions.dev's panel
// recipe); this component exists for the one thing CSS cannot do, which is
// keep a closing panel on screen long enough for its own close transition to
// play.
//
// Panels used to be rendered as `{open && <Panel />}`. That gives no exit
// animation at all — React removes the node on the same frame — and no enter
// animation either, since a node that mounts already in its open state has no
// previous value to transition *from*. Both halves are fixed here: mount
// closed, flip `data-open` on the next frame, and defer unmount until the
// transition ends.
//
// Timing deliberately lives only in the CSS. Open and close have different
// durations, and duplicating either one here is how they drift apart — so
// unmount is driven by `transitionend`, not a matching `setTimeout`.

/** Matched against `transitionend` so the handler fires once per close rather
 * than once per animated property. `width` (not `transform`) because it is
 * the property that is still running when the panel has actually finished
 * collapsing — it is what the canvas's reflow is waiting on. */
const CLOSE_SETTLES_ON = "width";

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
	);
}

export function SidePanel({
	open,
	side,
	/** The panel's own width, as a CSS length — must match the width the
	 * child renders at, since the child is clipped to this rather than
	 * reflowed into it. */
	width,
	children,
}: {
	open: boolean;
	side: "left" | "right";
	width: string;
	children: React.ReactNode;
}) {
	// Two pieces of state, not one: `mounted` is whether the child exists at
	// all, `revealed` is what `data-open` reads. They differ for exactly one
	// frame on open (mounted but not yet revealed, so there is a closed state
	// to transition from) and for one close duration on close (no longer
	// revealed, but still mounted so the transition can run).
	const [mounted, setMounted] = useState(open);
	const [revealed, setRevealed] = useState(false);
	const element = useRef<HTMLDivElement>(null);

	// The children rendered while closing are the ones from when the panel
	// was last open, not the ones the parent is passing now. `AnnotationConfig`
	// renders nothing once no annotation is selected — which is the very state
	// that closes this panel — so passing the live children straight through
	// would animate an empty box. Held in a ref rather than state because
	// nothing should re-render when it changes; it is read on the renders that
	// the `open` change already triggers.
	const retained = useRef<React.ReactNode>(null);
	if (open) retained.current = children;

	useEffect(() => {
		if (open) {
			setMounted(true);
			// `requestAnimationFrame` twice: one frame gets the node into the
			// DOM, the second lets the browser take a style snapshot of it
			// closed. Flipping the attribute in a single frame is the classic
			// way to get no animation at all, because the closed state never
			// becomes a computed value to interpolate away from.
			let second = 0;
			const first = requestAnimationFrame(() => {
				second = requestAnimationFrame(() => setRevealed(true));
			});
			return () => {
				cancelAnimationFrame(first);
				cancelAnimationFrame(second);
			};
		}

		setRevealed(false);
		// With `transition: none` there is no `transitionend`, so a panel
		// closed under reduced motion would stay mounted forever.
		if (prefersReducedMotion()) {
			setMounted(false);
			return;
		}
	}, [open]);

	// Unmounting on the transition rather than a timer keeps the CSS the only
	// place a duration is written down.
	useEffect(() => {
		const node = element.current;
		if (!node || open) return;

		const done = (event: TransitionEvent) => {
			// `target` check, not just the property: a transition finishing on
			// something *inside* the panel bubbles up here too, and would
			// unmount the panel out from under a still-running close.
			if (event.target === node && event.propertyName === CLOSE_SETTLES_ON) {
				setMounted(false);
			}
		};

		node.addEventListener("transitionend", done);
		return () => node.removeEventListener("transitionend", done);
	}, [open]);

	if (!mounted) return null;

	return (
		<div
			ref={element}
			className="t-panel-slide"
			data-open={revealed}
			style={
				{
					"--panel-width": width,
					// Travel is half the panel's own width, per the recipe's
					// note — enough to read as a slide without the panel
					// appearing to come from off-screen. Sign follows the edge
					// it is docked to, so each panel moves away from its own
					// dock rather than across the canvas.
					"--panel-translate-x": side === "left" ? "-50%" : "50%",
				} as React.CSSProperties
			}
		>
			{open ? children : retained.current}
		</div>
	);
}
