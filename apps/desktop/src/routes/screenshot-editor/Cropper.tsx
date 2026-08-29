import { cn } from "@quiro/ui";
import {
	forwardRef,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { type CropBounds, clamp, type Ratio } from "./crop";

// A crop rectangle drawn over an image.
//
// The rect is stored as [0, 1] fractions of the image and rendered with `%`
// units, so it never has to be re-measured when the image's rendered size
// changes — the dialog animating in, a window resize, a late image load. The
// DOM is only read live (`getBoundingClientRect()` on the overlay) while a drag
// is in progress. This replaces a cached-scale model whose init raced the
// dialog's open animation and left the box collapsed in the corner.

export type CropperHandle = {
	fill: () => void;
	reset: () => void;
	setCropProperty: (field: keyof CropBounds, value: number) => void;
};

type Frac = { x: number; y: number; w: number; h: number };
type Dir = readonly [number, number];
type DragMode = "move" | "draw" | Dir;
type DragState = {
	mode: DragMode;
	startRect: Frac;
	startFx: number;
	startFy: number;
	rect: DOMRect;
};

const FULL: Frac = { x: 0, y: 0, w: 1, h: 1 };

// [x, y] each in {-1, 0, 1}: -1 = top/left edge moves, 1 = bottom/right, 0 = none.
const HANDLES = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
] as const satisfies readonly Dir[];

const HANDLE_CURSOR: Record<string, string> = {
	"-1,-1": "nwse-resize",
	"1,1": "nwse-resize",
	"1,-1": "nesw-resize",
	"-1,1": "nesw-resize",
	"0,-1": "ns-resize",
	"0,1": "ns-resize",
	"-1,0": "ew-resize",
	"1,0": "ew-resize",
};

const HANDLE_LABEL: Record<string, string> = {
	"-1,-1": "top left",
	"0,-1": "top",
	"1,-1": "top right",
	"-1,0": "left",
	"1,0": "right",
	"-1,1": "bottom left",
	"0,1": "bottom",
	"1,1": "bottom right",
};

const pct = (n: number) => `${n * 100}%`;

/** Clamp a candidate rect into [0, 1] with a per-axis minimum, sliding it back
 * inside without resizing when only the position is out of range. */
function normalize(f: Frac, minW: number, minH: number): Frac {
	const w = Math.min(1, Math.max(minW, f.w));
	const h = Math.min(1, Math.max(minH, f.h));
	return {
		w,
		h,
		x: Math.min(1 - w, Math.max(0, f.x)),
		y: Math.min(1 - h, Math.max(0, f.y)),
	};
}

function seed(crop: CropBounds | undefined, tw: number, th: number): Frac {
	if (crop && crop.width > 0 && crop.height > 0) {
		return {
			x: crop.x / tw,
			y: crop.y / th,
			w: crop.width / tw,
			h: crop.height / th,
		};
	}
	return FULL;
}

function toPx(f: Frac, tw: number, th: number): CropBounds {
	return {
		x: Math.round(f.x * tw),
		y: Math.round(f.y * th),
		width: Math.round(f.w * tw),
		height: Math.round(f.h * th),
	};
}

function applyDrag(
	drag: DragState,
	fx: number,
	fy: number,
	ratio: number | null,
	minW: number,
	minH: number,
): Frac {
	const s = drag.startRect;

	if (drag.mode === "move") {
		return normalize(
			{ ...s, x: s.x + (fx - drag.startFx), y: s.y + (fy - drag.startFy) },
			minW,
			minH,
		);
	}

	if (drag.mode === "draw") {
		const x0 = drag.startFx;
		const y0 = drag.startFy;
		let w = Math.abs(fx - x0);
		let h = Math.abs(fy - y0);
		if (ratio) {
			if (w / ratio >= h) h = w / ratio;
			else w = h * ratio;
		}
		w = Math.max(minW, w);
		h = Math.max(minH, h);
		return normalize(
			{ x: fx >= x0 ? x0 : x0 - w, y: fy >= y0 ? y0 : y0 - h, w, h },
			minW,
			minH,
		);
	}

	const [dx, dy] = drag.mode;

	if (ratio) {
		// A locked ratio shows only corner handles, so one of dx/dy drives and
		// the opposite corner is pinned.
		const ax = dx > 0 ? s.x : s.x + s.w;
		const ay = dy > 0 ? s.y : s.y + s.h;
		let w = Math.abs(fx - ax);
		let h = Math.abs(fy - ay);
		if (w / ratio >= h) h = w / ratio;
		else w = h * ratio;

		const maxW = dx > 0 ? 1 - ax : ax;
		const maxH = dy > 0 ? 1 - ay : ay;
		const shrink = Math.min(1, w > 0 ? maxW / w : 1, h > 0 ? maxH / h : 1);
		w *= shrink;
		h *= shrink;
		if (w < minW || h < minH) {
			const grow = Math.max(w > 0 ? minW / w : 1, h > 0 ? minH / h : 1);
			w *= grow;
			h *= grow;
		}
		return normalize(
			{ x: dx > 0 ? ax : ax - w, y: dy > 0 ? ay : ay - h, w, h },
			minW,
			minH,
		);
	}

	let left = s.x;
	let top = s.y;
	let right = s.x + s.w;
	let bottom = s.y + s.h;
	if (dx < 0) left = Math.min(fx, right - minW);
	if (dx > 0) right = Math.max(fx, left + minW);
	if (dy < 0) top = Math.min(fy, bottom - minH);
	if (dy > 0) bottom = Math.max(fy, top + minH);
	return normalize(
		{ x: left, y: top, w: right - left, h: bottom - top },
		minW,
		minH,
	);
}

export const Cropper = forwardRef<
	CropperHandle,
	{
		children?: ReactNode;
		/** Source image size in its own pixels. */
		targetSize: { x: number; y: number };
		/** Starting crop in source pixels; the whole image when omitted. */
		initialCrop?: CropBounds;
		aspectRatio?: Ratio;
		/** Smallest crop edge, in source pixels. */
		minSize?: number;
		onCropChange?: (crop: CropBounds) => void;
	}
>(function Cropper(
	{
		children,
		targetSize,
		initialCrop,
		aspectRatio,
		minSize = 16,
		onCropChange,
	},
	ref,
) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragState | null>(null);

	const tw = Math.max(1, targetSize.x);
	const th = Math.max(1, targetSize.y);
	const minW = Math.min(1, minSize / tw);
	const minH = Math.min(1, minSize / th);
	const ratio = aspectRatio ? aspectRatio[0] / aspectRatio[1] : null;

	const [rect, setRect] = useState<Frac>(() =>
		normalize(seed(initialCrop, tw, th), minW, minH),
	);
	const rectRef = useRef(rect);
	rectRef.current = rect;

	const onCropChangeRef = useRef(onCropChange);
	onCropChangeRef.current = onCropChange;
	const twRef = useRef(tw);
	twRef.current = tw;
	const thRef = useRef(th);
	thRef.current = th;

	const commit = useCallback((next: Frac) => {
		rectRef.current = next;
		setRect(next);
		onCropChangeRef.current?.(toPx(next, twRef.current, thRef.current));
	}, []);

	// Seed on mount and whenever the source crop / image changes. Our own
	// onCropChange never flows back into these props, so this can't loop.
	useEffect(() => {
		commit(normalize(seed(initialCrop, tw, th), minW, minH));
	}, [commit, initialCrop, tw, th, minW, minH]);

	// Reshape to a newly-locked ratio around the current centre.
	const prevRatioRef = useRef(ratio);
	useEffect(() => {
		if (prevRatioRef.current === ratio) return;
		prevRatioRef.current = ratio;
		if (ratio == null) return;
		const r = rectRef.current;
		const cx = r.x + r.w / 2;
		const cy = r.y + r.h / 2;
		let w = r.w;
		let h = w / ratio;
		const fit = Math.min(
			1,
			(Math.min(cx, 1 - cx) * 2) / w,
			(Math.min(cy, 1 - cy) * 2) / h,
		);
		w *= fit;
		h *= fit;
		commit(normalize({ x: cx - w / 2, y: cy - h / 2, w, h }, minW, minH));
	}, [ratio, commit, minW, minH]);

	const [interacting, setInteracting] = useState(false);
	useEffect(() => {
		if (!interacting) return;
		const move = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const fx = clamp((event.clientX - drag.rect.left) / drag.rect.width);
			const fy = clamp((event.clientY - drag.rect.top) / drag.rect.height);
			commit(applyDrag(drag, fx, fy, ratio, minW, minH));
		};
		const end = () => {
			dragRef.current = null;
			setInteracting(false);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
		};
	}, [interacting, commit, ratio, minW, minH]);

	const begin = (event: ReactPointerEvent, mode: DragMode) => {
		if (event.button !== 0) return;
		const overlay = overlayRef.current;
		if (!overlay) return;
		event.preventDefault();
		event.stopPropagation();
		(event.target as HTMLElement).setPointerCapture?.(event.pointerId);
		const domRect = overlay.getBoundingClientRect();
		dragRef.current = {
			mode,
			startRect: rectRef.current,
			startFx: clamp((event.clientX - domRect.left) / domRect.width),
			startFy: clamp((event.clientY - domRect.top) / domRect.height),
			rect: domRect,
		};
		setInteracting(true);
	};

	useImperativeHandle(
		ref,
		() => ({
			fill: () => commit(FULL),
			reset: () => commit(normalize(seed(initialCrop, tw, th), minW, minH)),
			setCropProperty: (field, value) => {
				const current = toPx(rectRef.current, tw, th);
				commit(
					normalize(seed({ ...current, [field]: value }, tw, th), minW, minH),
				);
			},
		}),
		[commit, initialCrop, tw, th, minW, minH],
	);

	const shownHandles = ratio
		? HANDLES.filter(([dx, dy]) => dx !== 0 && dy !== 0)
		: HANDLES;

	const strip = "pointer-events-auto absolute bg-black/50";

	return (
		<div
			ref={overlayRef}
			role="group"
			aria-label="Crop region"
			// `w-fit` so the overlay shrink-wraps the image exactly, whatever
			// size CSS renders it at — the crop rect (in %) then lines up.
			className="relative block w-fit max-w-full cursor-crosshair select-none touch-none"
		>
			{children}

			{/* Dimmed area outside the crop, as four strips. A press on one starts
			    a fresh selection. Decorative for assistive tech — the crop
			    selection itself is the keyboard target. */}
			<div aria-hidden className="pointer-events-none absolute inset-0">
				<div
					className={cn(strip, "inset-x-0 top-0")}
					style={{ height: pct(rect.y) }}
					onPointerDown={(event) => begin(event, "draw")}
				/>
				<div
					className={cn(strip, "inset-x-0 bottom-0")}
					style={{ height: pct(1 - rect.y - rect.h) }}
					onPointerDown={(event) => begin(event, "draw")}
				/>
				<div
					className={strip}
					style={{
						left: 0,
						width: pct(rect.x),
						top: pct(rect.y),
						height: pct(rect.h),
					}}
					onPointerDown={(event) => begin(event, "draw")}
				/>
				<div
					className={strip}
					style={{
						right: 0,
						width: pct(1 - rect.x - rect.w),
						top: pct(rect.y),
						height: pct(rect.h),
					}}
					onPointerDown={(event) => begin(event, "draw")}
				/>
			</div>

			{/* The crop rectangle. */}
			<div
				role="group"
				tabIndex={0}
				aria-label="Crop selection — arrow keys move it"
				className="absolute cursor-move border border-white ring-1 ring-black/35 outline-none focus-visible:ring-2 focus-visible:ring-accent-300"
				style={{
					left: pct(rect.x),
					top: pct(rect.y),
					width: pct(rect.w),
					height: pct(rect.h),
				}}
				onPointerDown={(event) => begin(event, "move")}
				onKeyDown={(event) => {
					const step = event.shiftKey ? 0.05 : 0.01;
					const r = rectRef.current;
					const next: Record<string, Frac> = {
						ArrowLeft: { ...r, x: r.x - step },
						ArrowRight: { ...r, x: r.x + step },
						ArrowUp: { ...r, y: r.y - step },
						ArrowDown: { ...r, y: r.y + step },
					};
					const moved = next[event.key];
					if (!moved) return;
					event.preventDefault();
					event.stopPropagation();
					commit(normalize(moved, minW, minH));
				}}
			>
				{interacting && (
					<div aria-hidden className="pointer-events-none absolute inset-0">
						<div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
						<div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
						<div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
						<div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
					</div>
				)}

				{shownHandles.map((dir) => {
					const key = `${dir[0]},${dir[1]}`;
					return (
						<button
							key={key}
							type="button"
							tabIndex={-1}
							aria-label={`Resize ${HANDLE_LABEL[key]}`}
							onPointerDown={(event) => begin(event, dir)}
							className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center"
							style={{
								left: dir[0] < 0 ? "0%" : dir[0] > 0 ? "100%" : "50%",
								top: dir[1] < 0 ? "0%" : dir[1] > 0 ? "100%" : "50%",
								cursor: HANDLE_CURSOR[key],
							}}
						>
							<span className="size-3 rounded-[3px] border border-black/25 bg-accent-200 shadow-sm" />
						</button>
					);
				})}
			</div>
		</div>
	);
});
