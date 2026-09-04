import { AnimatePresence, motion } from "motion/react";
import { AnnotationConfig } from "./AnnotationConfig";
import { useScreenshotEditorContext } from "./context";
import { SidePanel } from "./SidePanel";
import { StylePanel } from "./StylePanel";
import { TransformPanel } from "./TransformPanel";

// The right-hand inspector: one persistent, fixed-width container that swaps
// its contents, rather than three panels that each mount and unmount on their
// own.
//
// They used to be independent `SidePanel`s, which meant the editor's layout
// was a function of how many happened to be open. Selecting a shape collapsed
// the style panel (15rem) and opened the annotation panel (16rem) — two width
// animations running against each other, with the canvas resizing underneath
// and every annotation on it re-laying out mid-transition. Opening the
// transform panel docked a *second* column beside the first and took another
// 16rem off the canvas.
//
// Now the container's width is a constant. It animates exactly once, when the
// inspector opens or closes; switching between panels changes nothing about
// the layout, so there is nothing for the canvas to react to and the swap is
// purely a content transition.

/** One width for every panel, so switching cannot resize the container. Set
 * to the widest of the three (`StylePanel`'s old `w-72`) rather than an
 * average — that panel is the most control-dense, and cramming it would be a
 * worse trade than giving the other two some air. */
const PANEL_WIDTH = "18rem";

/** The swap reads as a direction: a panel arrives from the top-right and
 * leaves toward the bottom-right, so the two are never mistaken for each
 * other and the slot has a sense of flow rather than a blink.
 *
 * `bounce: 0` deliberately, unlike the video editor's sidebar (which uses
 * 0.2): this switches far more often — every shape selection retargets it —
 * and overshoot that reads as characterful once is a wobble by the tenth
 * time. Spring rather than a bezier still gives the settle its natural
 * deceleration, just without the overrun. */
const SWAP_DISTANCE = 8;
const ENTER_TRANSITION = {
	type: "spring",
	duration: 0.3,
	bounce: 0,
} as const;
/** Shorter than the entrance: an exit is getting out of the way, and matching
 * its duration to the entrance makes `mode="wait"` feel like a stall. */
const EXIT_TRANSITION = {
	type: "spring",
	duration: 0.2,
	bounce: 0,
} as const;

export function RightPanel() {
	const { selectedAnnotationId, rightPanel } = useScreenshotEditorContext();

	// A selected shape takes the slot regardless of which panel is toggled,
	// and gives it straight back on deselect — `rightPanel` is never written
	// to here, so whatever was open before a selection is still open after it.
	const active = selectedAnnotationId !== null ? "annotation" : rightPanel;

	return (
		<SidePanel open={active !== null} side="right" width={PANEL_WIDTH}>
			<div className="flex h-full w-full flex-col border-l border-gray-3 bg-gray-1">
				{/* `mode="wait"` so the outgoing panel is gone before the incoming
				    one mounts — never two inspectors alive at once, each with its
				    own effects and refs. The container is already the right size, so
				    sequencing costs no layout, only the exit's 0.2s.

				    `initial={false}` keeps the first panel from flying in when the
				    editor opens: on load it should already be there. */}
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={active}
						initial={{ opacity: 0, x: SWAP_DISTANCE, y: -SWAP_DISTANCE }}
						animate={{ opacity: 1, x: 0, y: 0 }}
						exit={{
							opacity: 0,
							x: SWAP_DISTANCE,
							y: SWAP_DISTANCE,
							transition: EXIT_TRANSITION,
						}}
						transition={ENTER_TRANSITION}
						className="flex min-h-0 flex-1 flex-col"
					>
						{active === "annotation" && <AnnotationConfig />}
						{active === "style" && <StylePanel />}
						{active === "transform" && <TransformPanel />}
					</motion.div>
				</AnimatePresence>
			</div>
		</SidePanel>
	);
}
