import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@quiro/ui";
import {
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type Crop, commands } from "@/utils/tauri";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideCrop from "~icons/lucide/crop";
import IconLucideMaximize2 from "~icons/lucide/maximize-2";
import IconLucideMove from "~icons/lucide/move";
import IconLucideRatio from "~icons/lucide/ratio";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import { FPS, useEditorContext } from "./context";

type CropHandle = {
	id: string;
	x: 0 | 0.5 | 1;
	y: 0 | 0.5 | 1;
	cursor: string;
};

const HANDLES: CropHandle[] = [
	{ id: "top-left", x: 0, y: 0, cursor: "nwse-resize" },
	{ id: "top", x: 0.5, y: 0, cursor: "ns-resize" },
	{ id: "top-right", x: 1, y: 0, cursor: "nesw-resize" },
	{ id: "right", x: 1, y: 0.5, cursor: "ew-resize" },
	{ id: "bottom-right", x: 1, y: 1, cursor: "nwse-resize" },
	{ id: "bottom", x: 0.5, y: 1, cursor: "ns-resize" },
	{ id: "bottom-left", x: 0, y: 1, cursor: "nesw-resize" },
	{ id: "left", x: 0, y: 0.5, cursor: "ew-resize" },
];

const ASPECTS = [
	{ label: "Free", value: null },
	{ label: "16:9", value: 16 / 9 },
	{ label: "9:16", value: 9 / 16 },
	{ label: "1:1", value: 1 },
	{ label: "4:3", value: 4 / 3 },
] as const;

const GRID_CELLS = ["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"];

const MIN_CROP = 32;

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum);
}

function cropsMatch(first: Crop, second: Crop) {
	return (
		first.position.x === second.position.x &&
		first.position.y === second.position.y &&
		first.size.x === second.size.x &&
		first.size.y === second.size.y
	);
}

function fitCropToAspect(
	crop: Crop,
	aspect: number,
	sourceWidth: number,
	sourceHeight: number,
): Crop {
	const centerX = crop.position.x + crop.size.x / 2;
	const centerY = crop.position.y + crop.size.y / 2;
	let width = crop.size.x;
	let height = width / aspect;

	if (height > crop.size.y) {
		height = crop.size.y;
		width = height * aspect;
	}

	width = Math.min(width, sourceWidth);
	height = Math.min(height, sourceHeight);

	return {
		position: {
			x: clamp(centerX - width / 2, 0, sourceWidth - width),
			y: clamp(centerY - height / 2, 0, sourceHeight - height),
		},
		size: { x: width, y: height },
	};
}

function resizeFreeform(
	origin: Crop,
	handle: CropHandle,
	dx: number,
	dy: number,
	sourceWidth: number,
	sourceHeight: number,
): Crop {
	const originRight = origin.position.x + origin.size.x;
	const originBottom = origin.position.y + origin.size.y;
	const left =
		handle.x === 0
			? clamp(origin.position.x + dx, 0, originRight - MIN_CROP)
			: origin.position.x;
	const top =
		handle.y === 0
			? clamp(origin.position.y + dy, 0, originBottom - MIN_CROP)
			: origin.position.y;
	const right =
		handle.x === 1
			? clamp(originRight + dx, left + MIN_CROP, sourceWidth)
			: originRight;
	const bottom =
		handle.y === 1
			? clamp(originBottom + dy, top + MIN_CROP, sourceHeight)
			: originBottom;

	return {
		position: { x: left, y: top },
		size: { x: right - left, y: bottom - top },
	};
}

function resizeWithAspect(
	origin: Crop,
	handle: CropHandle,
	dx: number,
	dy: number,
	aspect: number,
	sourceWidth: number,
	sourceHeight: number,
): Crop {
	const horizontalEdge = handle.x !== 0.5;
	const verticalEdge = handle.y !== 0.5;
	const anchorX =
		handle.x === 0 ? origin.position.x + origin.size.x : origin.position.x;
	const anchorY =
		handle.y === 0 ? origin.position.y + origin.size.y : origin.position.y;
	const proposedWidth = horizontalEdge
		? handle.x === 0
			? origin.size.x - dx
			: origin.size.x + dx
		: origin.size.x;
	const proposedHeight = verticalEdge
		? handle.y === 0
			? origin.size.y - dy
			: origin.size.y + dy
		: origin.size.y;
	let width =
		horizontalEdge && (!verticalEdge || Math.abs(dx) >= Math.abs(dy))
			? proposedWidth
			: proposedHeight * aspect;
	const minimumWidth = Math.max(MIN_CROP, MIN_CROP * aspect);

	if (horizontalEdge && verticalEdge) {
		const maximumWidthX = handle.x === 0 ? anchorX : sourceWidth - anchorX;
		const maximumHeightY = handle.y === 0 ? anchorY : sourceHeight - anchorY;
		width = clamp(
			width,
			minimumWidth,
			Math.min(maximumWidthX, maximumHeightY * aspect),
		);
		const height = width / aspect;

		return {
			position: {
				x: handle.x === 0 ? anchorX - width : anchorX,
				y: handle.y === 0 ? anchorY - height : anchorY,
			},
			size: { x: width, y: height },
		};
	}

	if (horizontalEdge) {
		const maximumWidthX = handle.x === 0 ? anchorX : sourceWidth - anchorX;
		const centerY = origin.position.y + origin.size.y / 2;
		const maximumHeight = 2 * Math.min(centerY, sourceHeight - centerY);
		width = clamp(
			width,
			minimumWidth,
			Math.min(maximumWidthX, maximumHeight * aspect),
		);
		const height = width / aspect;

		return {
			position: {
				x: handle.x === 0 ? anchorX - width : anchorX,
				y: centerY - height / 2,
			},
			size: { x: width, y: height },
		};
	}

	const centerX = origin.position.x + origin.size.x / 2;
	const maximumWidth = 2 * Math.min(centerX, sourceWidth - centerX);
	const maximumHeightY = handle.y === 0 ? anchorY : sourceHeight - anchorY;
	const height = clamp(
		proposedHeight,
		minimumWidth / aspect,
		Math.min(maximumHeightY, maximumWidth / aspect),
	);
	width = height * aspect;

	return {
		position: {
			x: centerX - width / 2,
			y: handle.y === 0 ? anchorY - height : anchorY,
		},
		size: { x: width, y: height },
	};
}

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
	const fullCrop = useMemo<Crop>(
		() => ({
			position: { x: 0, y: 0 },
			size: { x: sourceWidth, y: sourceHeight },
		}),
		[sourceWidth, sourceHeight],
	);
	const initialCrop = project?.background.crop ?? fullCrop;
	const [frameUrl, setFrameUrl] = useState<string | null>(null);
	const [crop, setCrop] = useState<Crop>(fullCrop);
	const [aspect, setAspect] = useState<number | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [imageBox, setImageBox] = useState({ width: 0, height: 0 });

	useEffect(() => {
		if (!open) return;

		setCrop(initialCrop);
		setAspect(null);

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
	}, [open, initialCrop]);

	useEffect(() => {
		if (!frameUrl) return;
		const image = imageRef.current;
		if (!image) return;

		const updateSize = () =>
			setImageBox({ width: image.clientWidth, height: image.clientHeight });
		const observer = new ResizeObserver(updateSize);
		observer.observe(image);
		updateSize();

		return () => observer.disconnect();
	}, [frameUrl]);

	const scale = useMemo(
		() => (imageBox.width > 0 ? sourceWidth / imageBox.width : 1),
		[imageBox.width, sourceWidth],
	);
	const selectedAspect =
		ASPECTS.find((option) => option.value === aspect)?.label ?? "Free";
	const isFullFrame = cropsMatch(crop, fullCrop);
	const isUnchanged = cropsMatch(crop, initialCrop);

	const drag = (
		event: ReactPointerEvent,
		applyDelta: (dx: number, dy: number) => Crop,
	) => {
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;

		const move = (moveEvent: PointerEvent) =>
			setCrop(
				applyDelta(
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

	const moveCrop = (origin: Crop, dx: number, dy: number): Crop => ({
		...origin,
		position: {
			x: clamp(origin.position.x + dx, 0, sourceWidth - origin.size.x),
			y: clamp(origin.position.y + dy, 0, sourceHeight - origin.size.y),
		},
	});

	const resizeCrop = (
		origin: Crop,
		handle: CropHandle,
		dx: number,
		dy: number,
	) =>
		aspect
			? resizeWithAspect(
					origin,
					handle,
					dx,
					dy,
					aspect,
					sourceWidth,
					sourceHeight,
				)
			: resizeFreeform(origin, handle, dx, dy, sourceWidth, sourceHeight);

	const nudgeMove = (event: KeyboardEvent<HTMLButtonElement>) => {
		const step = event.shiftKey ? 10 : 1;
		const delta = {
			ArrowLeft: { x: -step, y: 0 },
			ArrowRight: { x: step, y: 0 },
			ArrowUp: { x: 0, y: -step },
			ArrowDown: { x: 0, y: step },
		}[event.key];
		if (!delta) return;
		event.preventDefault();
		setCrop((current) => moveCrop(current, delta.x, delta.y));
	};

	const nudgeHandle = (
		event: KeyboardEvent<HTMLButtonElement>,
		handle: CropHandle,
	) => {
		const step = event.shiftKey ? 10 : 1;
		const delta = {
			ArrowLeft: { x: -step, y: 0 },
			ArrowRight: { x: step, y: 0 },
			ArrowUp: { x: 0, y: -step },
			ArrowDown: { x: 0, y: step },
		}[event.key];
		if (!delta) return;
		event.preventDefault();
		setCrop((current) => resizeCrop(current, handle, delta.x, delta.y));
	};

	const apply = () => {
		setProject((current) => ({
			...current,
			background: { ...current.background, crop },
		}));
		onOpenChange(false);
	};

	const box = {
		left: `${(crop.position.x / sourceWidth) * 100}%`,
		top: `${(crop.position.y / sourceHeight) * 100}%`,
		width: `${(crop.size.x / sourceWidth) * 100}%`,
		height: `${(crop.size.y / sourceHeight) * 100}%`,
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[min(46rem,75vh)] w-[min(48rem,75vw)]! max-w-none flex-col overflow-hidden overscroll-contain p-0">
				<DialogHeader className="w-full!">
					<div className="shrink-0 flex-row! items-center! gap-3 py-4 ps-1 pe-12 flex w-full">
						<div className="gray-button-shadow grid size-9 shrink-0 place-items-center rounded-xl bg-gray-3 text-gray-11">
							<IconLucideCrop aria-hidden="true" className="size-4" />
						</div>
						<div className="min-w-fit">
							<DialogTitle>Crop frame</DialogTitle>
							<p className="mt-0.5 text-xs text-gray-10">
								Drag the frame or use arrow keys for precise placement
							</p>
						</div>
						<div
							role="status"
							aria-live="polite"
							className="ms-auto flex shrink-0 items-center gap-2 rounded-xl bg-gray-3 px-3 py-2 text-xs tabular-nums text-gray-11"
						>
							<span className="font-semibold text-gray-12">
								{Math.round(crop.size.x)} × {Math.round(crop.size.y)}
							</span>
							<span className="text-gray-8">·</span>
							<span>{selectedAspect}</span>
						</div>
					</div>
				</DialogHeader>

				<div className="min-h-0 flex-1 bg-gray-2 px-5 py-4">
					<div className="flex h-full min-h-0 items-center justify-center rounded-2xl bg-gray-3 p-2 shadow-[inset_0_1px_3px_oklch(0_0_0/0.08)]">
						<div className="relative flex max-h-full max-w-full overflow-hidden rounded-lg bg-gray-12/8">
							{frameUrl ? (
								<img
									ref={imageRef}
									src={frameUrl}
									alt="Frame at the playhead"
									draggable={false}
									className="block max-h-full max-w-full select-none rounded-lg object-contain outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
								/>
							) : (
								<div className="grid size-full min-h-48 min-w-72 place-items-center text-sm text-gray-9">
									Preparing frame…
								</div>
							)}

							{frameUrl && (
								<div
									className="absolute touch-none shadow-[0_0_0_9999px_oklch(0_0_0/0.58)]"
									style={box}
								>
									<div
										aria-hidden="true"
										className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent-border-selected"
									/>
									<div
										aria-hidden="true"
										className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-55 [&>*]:border-accent-border-selected/65 [&>*:not(:nth-child(3n))]:border-e [&>*:nth-child(-n+6)]:border-b"
									>
										{GRID_CELLS.map((cell) => (
											<span key={cell} />
										))}
									</div>
									<button
										type="button"
										aria-label="Move crop. Use arrow keys to move one pixel or Shift plus arrow keys to move ten pixels."
										className="group absolute inset-3 cursor-move rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-focus-ring"
										onKeyDown={nudgeMove}
										onPointerDown={(event) => {
											const origin = crop;
											drag(event, (dx, dy) => moveCrop(origin, dx, dy));
										}}
									>
										<span className="pointer-events-none absolute start-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gray-12/65 text-gray-1 opacity-0 shadow-lg backdrop-blur-sm transition-[opacity,scale] duration-100 group-hover:opacity-100 group-focus-visible:opacity-100">
											<IconLucideMove aria-hidden="true" className="size-4" />
										</span>
									</button>

									{HANDLES.map((handle) => (
										<button
											key={handle.id}
											type="button"
											aria-label={`Resize crop from ${handle.id}. Use arrow keys for one pixel or Shift plus arrow keys for ten pixels.`}
											style={{
												cursor: handle.cursor,
												left: `${handle.x * 100}%`,
												top: `${handle.y * 100}%`,
											}}
											className={cn(
												"absolute z-10 grid size-8 place-items-center rounded-full outline-offset-1 focus-visible:outline-2 focus-visible:outline-accent-focus-ring",
												handle.x === 1
													? "-translate-x-full"
													: handle.x === 0.5 && "-translate-x-1/2",
												handle.y === 1
													? "-translate-y-full"
													: handle.y === 0.5 && "-translate-y-1/2",
											)}
											onKeyDown={(event) => nudgeHandle(event, handle)}
											onPointerDown={(event) => {
												const origin = crop;
												drag(event, (dx, dy) =>
													resizeCrop(origin, handle, dx, dy),
												);
											}}
										>
											<span
												aria-hidden="true"
												className={cn(
													"block border-2 border-gray-1 bg-accent-solid shadow-md transition-[scale,background-color] duration-100",
													handle.x === 0.5 || handle.y === 0.5
														? "h-2.5 w-4 rounded-full"
														: "size-3.5 rounded-md",
													handle.x === 0 && "-translate-x-1/2",
													handle.x === 1 && "translate-x-1/2",
													handle.y === 0 && "-translate-y-1/2",
													handle.y === 1 && "translate-y-1/2",
												)}
											/>
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-4 px-5 py-4">
					<div className="flex min-w-0 items-center gap-2">
						<div className="flex items-center gap-1.5 text-xs font-medium text-gray-10">
							<IconLucideRatio aria-hidden="true" className="size-4" />
							Aspect
						</div>
						<div className="flex flex-wrap gap-1 rounded-xl bg-gray-3 p-1">
							{ASPECTS.map((option) => {
								const selected = aspect === option.value;
								return (
									<button
										key={option.label}
										type="button"
										aria-pressed={selected}
										onClick={() => {
											setAspect(option.value);
											if (option.value)
												setCrop((current) =>
													fitCropToAspect(
														current,
														option.value,
														sourceWidth,
														sourceHeight,
													),
												);
										}}
										className={cn(
											"flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
											selected
												? "bg-gray-1 text-gray-12 shadow-sm"
												: "text-gray-10 hover:bg-gray-4 hover:text-gray-12",
										)}
									>
										{selected && (
											<IconLucideCheck aria-hidden="true" className="size-3" />
										)}
										{option.label}
									</button>
								);
							})}
						</div>
					</div>

					<div className="ms-auto flex items-center gap-3 text-xs tabular-nums text-gray-10">
						<span>
							X {Math.round(crop.position.x)} · Y {Math.round(crop.position.y)}
						</span>
						<Button
							variant="gray"
							size="sm"
							disabled={isFullFrame}
							onClick={() => {
								setCrop(fullCrop);
								setAspect(null);
							}}
						>
							<IconLucideMaximize2 aria-hidden="true" className="size-3.5" />
							Full frame
						</Button>
						<Button
							variant="gray"
							size="sm"
							disabled={isUnchanged}
							onClick={() => {
								setCrop(initialCrop);
								setAspect(null);
							}}
						>
							<IconLucideRotateCcw aria-hidden="true" className="size-3.5" />
							Reset
						</Button>
					</div>
				</div>

				<DialogFooter className="shrink-0 flex items-center gap-3 px-5 py-4">
					<p className="me-auto text-xs text-gray-9">
						Your original recording remains unchanged
					</p>
					<Button variant="gray" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={apply}>
						<IconLucideCrop aria-hidden="true" className="size-4" />
						Apply crop
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
