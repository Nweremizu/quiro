import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@quiro/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Crop, commands } from "@/utils/tauri";
import { FPS, useEditorContext } from "./context";

// Cap's crop dialog: the display frame at the playhead with a draggable crop
// rect over it. The reference image is downscaled by the backend, so every
// interaction is kept in source pixels and only scaled for display.

const HANDLES = [
	{ id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
	{ id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
	{ id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
	{ id: "se", x: 1, y: 1, cursor: "nwse-resize" },
] as const;

const MIN_CROP = 32;

export function CropDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { project, setProject, instance } = useEditorContext();

	const display = instance?.recordings.segments[0]?.display;
	const sourceWidth = display?.width ?? 1920;
	const sourceHeight = display?.height ?? 1080;

	const [frameUrl, setFrameUrl] = useState<string | null>(null);
	const [crop, setCrop] = useState<Crop>({
		position: { x: 0, y: 0 },
		size: { x: sourceWidth, y: sourceHeight },
	});
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [imageBox, setImageBox] = useState({ width: 0, height: 0 });

	useEffect(() => {
		if (!open) return;

		setCrop(
			project?.background.crop ?? {
				position: { x: 0, y: 0 },
				size: { x: sourceWidth, y: sourceHeight },
			},
		);

		let objectUrl: string | null = null;
		let cancelled = false;

		void (async () => {
			const result = await commands.getDisplayFrameForCropping(FPS);
			if (cancelled || result.status === "error") return;

			objectUrl = URL.createObjectURL(
				new Blob([new Uint8Array(result.data)], { type: "image/jpeg" }),
			);
			setFrameUrl(objectUrl);
		})();

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			setFrameUrl(null);
		};
	}, [open, project, sourceWidth, sourceHeight]);

	// Source pixels per displayed pixel — every drag delta goes through this.
	const scale = useMemo(
		() => (imageBox.width > 0 ? sourceWidth / imageBox.width : 1),
		[imageBox.width, sourceWidth],
	);

	const drag = (
		event: React.PointerEvent,
		apply: (dx: number, dy: number) => Crop,
	) => {
		event.preventDefault();
		event.stopPropagation();

		const startX = event.clientX;
		const startY = event.clientY;

		const move = (moveEvent: PointerEvent) =>
			setCrop(
				apply(
					(moveEvent.clientX - startX) * scale,
					(moveEvent.clientY - startY) * scale,
				),
			);

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const apply = () => {
		setProject((current) => ({
			...current,
			background: { ...current.background, crop },
		}));
		onOpenChange(false);
	};

	const reset = () =>
		setCrop({
			position: { x: 0, y: 0 },
			size: { x: sourceWidth, y: sourceHeight },
		});

	const box = {
		left: `${(crop.position.x / sourceWidth) * 100}%`,
		top: `${(crop.position.y / sourceHeight) * 100}%`,
		width: `${(crop.size.x / sourceWidth) * 100}%`,
		height: `${(crop.size.y / sourceHeight) * 100}%`,
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-295 p-0">
				<DialogHeader className="px-4 py-3">
					<DialogTitle>Crop</DialogTitle>
				</DialogHeader>

				<div className="flex items-center justify-center bg-gray-2 p-4">
					<div className="relative">
						{frameUrl && (
							<img
								ref={imageRef}
								src={frameUrl}
								alt="Frame at the playhead"
								draggable={false}
								onLoad={(event) =>
									setImageBox({
										width: event.currentTarget.clientWidth,
										height: event.currentTarget.clientHeight,
									})
								}
								className="max-h-[60vh] max-w-full select-none rounded-lg"
							/>
						)}

						{frameUrl && (
							<div
								className="absolute border-2 border-accent-700 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
								style={box}
							>
								<button
									type="button"
									aria-label="Move crop"
									className="absolute inset-0 cursor-move"
									onPointerDown={(event) => {
										const origin = crop;
										drag(event, (dx, dy) => ({
											...origin,
											position: {
												x: Math.min(
													Math.max(origin.position.x + dx, 0),
													sourceWidth - origin.size.x,
												),
												y: Math.min(
													Math.max(origin.position.y + dy, 0),
													sourceHeight - origin.size.y,
												),
											},
										}));
									}}
								/>

								{HANDLES.map((handle) => (
									<button
										key={handle.id}
										type="button"
										aria-label={`Resize crop ${handle.id}`}
										style={{
											cursor: handle.cursor,
											left: `${handle.x * 100}%`,
											top: `${handle.y * 100}%`,
										}}
										className="absolute -mt-1.5 -ml-1.5 size-3 rounded-full border border-gray-1 bg-accent-700"
										onPointerDown={(event) => {
											const origin = crop;
											drag(event, (dx, dy) => {
												// Dragging a corner moves those two edges; the
												// opposite corner stays where it is.
												const left =
													handle.x === 0
														? Math.min(
																Math.max(origin.position.x + dx, 0),
																origin.position.x + origin.size.x - MIN_CROP,
															)
														: origin.position.x;
												const top =
													handle.y === 0
														? Math.min(
																Math.max(origin.position.y + dy, 0),
																origin.position.y + origin.size.y - MIN_CROP,
															)
														: origin.position.y;
												const right =
													handle.x === 1
														? Math.min(
																Math.max(
																	origin.position.x + origin.size.x + dx,
																	left + MIN_CROP,
																),
																sourceWidth,
															)
														: origin.position.x + origin.size.x;
												const bottom =
													handle.y === 1
														? Math.min(
																Math.max(
																	origin.position.y + origin.size.y + dy,
																	top + MIN_CROP,
																),
																sourceHeight,
															)
														: origin.position.y + origin.size.y;

												return {
													position: { x: left, y: top },
													size: { x: right - left, y: bottom - top },
												};
											});
										}}
									/>
								))}
							</div>
						)}
					</div>
				</div>

				<DialogFooter className="flex items-center gap-2 px-4 py-3">
					<span className="mr-auto text-xs tabular-nums text-gray-11">
						{Math.round(crop.size.x)} × {Math.round(crop.size.y)}
					</span>
					<Button variant="gray" onClick={reset}>
						Reset
					</Button>
					<Button onClick={apply}>Apply</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
