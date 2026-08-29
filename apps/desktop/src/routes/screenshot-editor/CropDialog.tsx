import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo, useRef, useState } from "react";
import IconLucideMaximize from "~icons/lucide/maximize";
import IconLucideRatio from "~icons/lucide/ratio";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import { Cropper, type CropperHandle } from "./Cropper";
import { useScreenshotEditorContext } from "./context";
import { COMMON_RATIOS, type CropBounds, type Ratio } from "./crop";

// Crop dialog for the screenshot editor. Everything it edits is in *source
// image pixels*; `Cropper` handles the conversion to whatever size the image
// is displayed at.

export function CropDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { instance, project, updateBackground, originalImageSize } =
		useScreenshotEditorContext();

	const cropperRef = useRef<CropperHandle>(null);
	const [crop, setCrop] = useState<CropBounds>({
		x: 0,
		y: 0,
		width: 0,
		height: 0,
	});
	const [aspect, setAspect] = useState<Ratio | null>(null);
	const [ratioOpen, setRatioOpen] = useState(false);

	// `initialCrop` / `targetSize` must be referentially stable — `Cropper`
	// keys effects off them. A previously-persisted crop is ignored if it is
	// degenerate so the dialog always opens on a usable box.
	const persisted = project?.background.crop ?? null;
	const existing =
		persisted &&
		persisted.position != null &&
		(persisted.size?.x ?? 0) > 0 &&
		(persisted.size?.y ?? 0) > 0
			? persisted
			: null;
	const source = useMemo(
		() =>
			originalImageSize
				? { x: originalImageSize.width, y: originalImageSize.height }
				: null,
		[originalImageSize],
	);
	const initialBounds = useMemo<CropBounds | null>(() => {
		if (!source) return null;
		return existing
			? {
					x: existing.position.x,
					y: existing.position.y,
					width: existing.size.x,
					height: existing.size.y,
				}
			: { x: 0, y: 0, width: source.x, height: source.y };
	}, [existing, source]);

	if (!instance || !project || !source || !initialBounds) return null;

	const isFullFrame = crop.width === source.x && crop.height === source.y;
	const isUnchanged =
		crop.x === initialBounds.x &&
		crop.y === initialBounds.y &&
		crop.width === initialBounds.width &&
		crop.height === initialBounds.height;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-none p-0">
				<DialogHeader className="flex flex-wrap items-center gap-x-8 gap-y-3">
					<DialogTitle className="sr-only">Crop screenshot</DialogTitle>

					<div className="flex items-center gap-3 text-xs text-gray-11">
						<span>Size</span>
						<BoundInput
							value={crop.width}
							max={source.x}
							onCommit={(v) => cropperRef.current?.setCropProperty("width", v)}
						/>
						<span>×</span>
						<BoundInput
							value={crop.height}
							max={source.y}
							onCommit={(v) => cropperRef.current?.setCropProperty("height", v)}
						/>
					</div>

					<div className="flex items-center gap-3 text-xs text-gray-11">
						<span>Position</span>
						<BoundInput
							value={crop.x}
							max={source.x}
							onCommit={(v) => cropperRef.current?.setCropProperty("x", v)}
						/>
						<span>×</span>
						<BoundInput
							value={crop.y}
							max={source.y}
							onCommit={(v) => cropperRef.current?.setCropProperty("y", v)}
						/>
					</div>

					<div className="ml-auto flex items-center gap-2">
						<Popover open={ratioOpen} onOpenChange={setRatioOpen}>
							<PopoverTrigger
								render={
									<Button
										variant="gray"
										size="icon"
										title="Aspect ratio"
										className="relative"
									>
										{aspect ? (
											<span className="text-xs font-medium leading-none tracking-tight text-accent-400">
												{aspect[0]}:{aspect[1]}
											</span>
										) : (
											<IconLucideRatio className="size-4" />
										)}
									</Button>
								}
							/>
							<PopoverContent className="w-44 p-1" align="end">
								<RatioOption
									label="Freeform"
									active={aspect === null}
									onClick={() => {
										setAspect(null);
										setRatioOpen(false);
									}}
								/>
								{COMMON_RATIOS.map((ratio) => (
									<RatioOption
										key={`${ratio[0]}:${ratio[1]}`}
										label={`${ratio[0]} : ${ratio[1]}`}
										active={
											aspect?.[0] === ratio[0] && aspect?.[1] === ratio[1]
										}
										onClick={() => {
											setAspect([ratio[0], ratio[1]]);
											setRatioOpen(false);
										}}
									/>
								))}
							</PopoverContent>
						</Popover>

						<Button
							variant="gray"
							size="sm"
							disabled={isFullFrame}
							onClick={() => cropperRef.current?.fill()}
						>
							<IconLucideMaximize className="size-3.5" />
							Full
						</Button>
						<Button
							variant="gray"
							size="sm"
							disabled={isUnchanged}
							onClick={() => {
								cropperRef.current?.reset();
								setAspect(null);
							}}
						>
							<IconLucideRotateCcw className="size-3.5" />
							Reset
						</Button>
					</div>
				</DialogHeader>

				<div className="flex justify-center px-5 pb-3">
					<div className="rounded-2xl bg-gray-2/80 p-3 shadow-sm ring-1 ring-black/5 dark:bg-gray-3/80">
						<Cropper
							ref={cropperRef}
							onCropChange={setCrop}
							aspectRatio={aspect ?? undefined}
							targetSize={source}
							initialCrop={initialBounds}
						>
							<img
								alt=""
								src={convertFileSrc(instance.path)}
								draggable={false}
								className="pointer-events-none block max-h-[60vh] max-w-[min(78vw,760px)] select-none rounded-[3px]"
							/>
						</Cropper>
					</div>
				</div>

				<DialogFooter>
					<Button variant="gray" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={() => {
							updateBackground({
								crop: {
									position: { x: crop.x, y: crop.y },
									size: { x: crop.width, y: crop.height },
								},
							});
							onOpenChange(false);
						}}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RatioOption({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
				active ? "bg-gray-4 text-gray-12" : "text-gray-11 hover:bg-gray-3",
			)}
		>
			{label}
		</button>
	);
}

/** Numeric field that only commits on blur or Enter, so typing "1" on the way
 * to "1024" does not collapse the crop to a single pixel. */
function BoundInput({
	value,
	max,
	onCommit,
}: {
	value: number;
	max?: number;
	onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		const parsed = Number.parseInt(draft, 10);
		setDraft(null);
		if (Number.isFinite(parsed)) onCommit(parsed);
	};

	return (
		<input
			type="number"
			max={max}
			min={0}
			value={draft ?? Math.round(value)}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					commit();
					event.currentTarget.blur();
				} else if (event.key === "Escape") {
					setDraft(null);
					event.currentTarget.blur();
				}
			}}
			className="h-8 w-14 rounded-lg bg-gray-2 px-2 text-xs text-gray-12 outline-none transition-shadow focus:bg-gray-3 focus:ring-1 focus:ring-gray-10"
		/>
	);
}
