import { convertFileSrc } from "@tauri-apps/api/core";
import {
	FLAT_PERSPECTIVE,
	IDENTITY_LAYER_TRANSFORM,
	TransformControls,
} from "@/components/TransformControls";
import { useScreenshotEditorContext } from "./context";
import { getImageRect } from "./layout";

// The screenshot editor's binding of the shared transform controls: they edit
// the project-wide `background.displayTransform` / `background.perspective`,
// because a screenshot project has one capture and nothing to scope them to.
// The video editor binds the same controls to a clip instead.
//
// Position and Zoom share `displayTransform` with the on-canvas drag gizmo, so
// moving the card by hand and moving it by slider are the same edit and stay in
// sync. Rotation X/Y have no gizmo — there is nothing to grab for an
// out-of-plane tilt — which is exactly why they need sliders.

export function TransformPanel() {
	const {
		project,
		updateBackground,
		instance,
		history,
		latestFrame,
		originalImageSize,
	} = useScreenshotEditorContext();

	const transform =
		project?.background.displayTransform ?? IDENTITY_LAYER_TRANSFORM;
	const perspective = project?.background.perspective ?? FLAT_PERSPECTIVE;

	// `latestFrame` is the canvas: the rendered output frame, which is the
	// screenshot plus its padding, not the screenshot's own dimensions. Using
	// the latter (as this first did) makes every conversion wrong by the
	// padding factor.
	const canvas = {
		width: latestFrame?.width ?? 0,
		height: latestFrame?.height ?? 0,
	};

	// Where layout alone would put the card, with no transform applied.
	const laidOut = getImageRect(
		canvas,
		originalImageSize,
		project?.background.padding ?? 0,
		project?.background.crop ?? null,
		project?.aspectRatio ?? null,
		null,
	);

	if (!project || !instance) return null;

	return (
		<div className="flex h-full w-full min-h-0 flex-col overflow-y-auto">
			<TransformControls
				transform={transform}
				perspective={perspective}
				canvas={canvas}
				laidOutCentre={{
					x: laidOut.x + laidOut.width / 2,
					y: laidOut.y + laidOut.height / 2,
				}}
				// Deliberately the flat screenshot rather than a live render: this
				// is a surface for placing the focal point on, and the thing being
				// pointed at is a location in the capture, not in the composed
				// frame. A live preview would cost a second render target to say
				// the same thing less clearly.
				focusBackdrop={
					<img
						src={convertFileSrc(instance.path)}
						alt=""
						draggable={false}
						className="pointer-events-none size-full object-cover"
					/>
				}
				onTransformChange={(patch) =>
					updateBackground({ displayTransform: { ...transform, ...patch } })
				}
				onPerspectiveChange={(patch) =>
					updateBackground({ perspective: { ...perspective, ...patch } })
				}
				// One undo entry per drag rather than one per pointer move — the
				// same scope the sliders in AnnotationConfig use.
				onDragEnd={() => history.pause()}
			/>
		</div>
	);
}
