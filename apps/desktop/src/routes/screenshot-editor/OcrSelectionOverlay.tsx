import { useEffect, useMemo, useRef, useState } from "react";
import {
	commands,
	type ProjectConfiguration,
	type ScreenshotOcrRegion,
	type ScreenshotOcrResult,
} from "@/utils/tauri";
import { useScreenshotEditorContext } from "./context";
import type { Rect } from "./screenshotExport";

// React port of Cap's `OcrSelectionOverlay.tsx`.
//
// Makes the text *in* the screenshot selectable, the way it is in Preview on
// macOS: the Rust side (`recognize_screenshot_text`) returns recognised lines
// with their bounds in source-image pixels, and this lays an invisible, real
// text node over each one. The glyphs are transparent — the pixels underneath
// are what you see — so selection highlight and copy work with no visual
// change to the image.

type TextLayout = {
	text: string;
	rect: Rect;
	fontSize: number;
	lineHeight: number;
	textWidth: number;
	scaleX: number;
};

const FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

export function OcrSelectionOverlay({
	bounds,
	cssWidth,
	cssHeight,
	imageRect,
	originalImageSize,
	crop,
}: {
	/** The rendered frame, in frame pixels. */
	bounds: Rect;
	cssWidth: number;
	cssHeight: number;
	/** Where the screenshot sits inside that frame. */
	imageRect: Rect;
	originalImageSize: { width: number; height: number } | null;
	crop: ProjectConfiguration["background"]["crop"];
}) {
	const { activeTool, setSelectedAnnotationId } = useScreenshotEditorContext();
	const [ocrResult, setOcrResult] = useState<ScreenshotOcrResult | null>(null);
	const measureCanvas = useRef<HTMLCanvasElement | null>(null);

	// OCR runs against the *cropped* part of the source image, so cropping
	// re-runs recognition rather than leaving text boxes floating over the part
	// that was cut away.
	const sourceRegion = useMemo<ScreenshotOcrRegion | null>(() => {
		if (
			!originalImageSize ||
			originalImageSize.width <= 0 ||
			originalImageSize.height <= 0
		)
			return null;

		const region = crop ?? {
			position: { x: 0, y: 0 },
			size: { x: originalImageSize.width, y: originalImageSize.height },
		};
		const left = clamp(region.position.x, 0, originalImageSize.width);
		const top = clamp(region.position.y, 0, originalImageSize.height);
		const right = clamp(
			region.position.x + region.size.x,
			left,
			originalImageSize.width,
		);
		const bottom = clamp(
			region.position.y + region.size.y,
			top,
			originalImageSize.height,
		);

		const x = Math.floor(left);
		const y = Math.floor(top);
		const width = Math.ceil(right) - x;
		const height = Math.ceil(bottom) - y;
		if (width < 4 || height < 4) return null;
		return { x, y, width, height };
	}, [originalImageSize, crop]);

	const regionKey = sourceRegion
		? `${sourceRegion.x}:${sourceRegion.y}:${sourceRegion.width}:${sourceRegion.height}`
		: null;

	// `sourceRegion` is a fresh object whenever the project updates, so depending
	// on it would re-run OCR on every unrelated edit. The key holds the values
	// that actually identify the request.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on regionKey
	useEffect(() => {
		if (!regionKey || !sourceRegion) {
			setOcrResult(null);
			return;
		}

		// Recognition is slow enough that a fast sequence of crops can land out of
		// order; this drops anything but the newest request.
		let current = true;
		setOcrResult(null);

		void (async () => {
			try {
				const result = await commands.recognizeScreenshotText(sourceRegion);
				if (!current) return;
				setOcrResult(result.status === "ok" ? result.data : null);
			} catch {
				if (current) setOcrResult(null);
			}
		})();

		return () => {
			current = false;
		};
	}, [regionKey]);

	const textLayouts = useMemo<TextLayout[]>(() => {
		if (!ocrResult || !sourceRegion) return [];
		if (bounds.width <= 0 || bounds.height <= 0) return [];
		if (imageRect.width <= 0 || imageRect.height <= 0) return [];

		/** Source-image pixels → CSS pixels within this overlay. */
		const sourceToCss = (rect: ScreenshotOcrRegion): Rect | null => {
			const regionRight = sourceRegion.x + sourceRegion.width;
			const regionBottom = sourceRegion.y + sourceRegion.height;
			const left = clamp(rect.x, sourceRegion.x, regionRight);
			const top = clamp(rect.y, sourceRegion.y, regionBottom);
			const right = clamp(rect.x + rect.width, left, regionRight);
			const bottom = clamp(rect.y + rect.height, top, regionBottom);

			const frameRect = {
				x:
					imageRect.x +
					((left - sourceRegion.x) / sourceRegion.width) * imageRect.width,
				y:
					imageRect.y +
					((top - sourceRegion.y) / sourceRegion.height) * imageRect.height,
				width: ((right - left) / sourceRegion.width) * imageRect.width,
				height: ((bottom - top) / sourceRegion.height) * imageRect.height,
			};
			if (frameRect.width <= 0 || frameRect.height <= 0) return null;

			return {
				x: ((frameRect.x - bounds.x) / bounds.width) * cssWidth,
				y: ((frameRect.y - bounds.y) / bounds.height) * cssHeight,
				width: (frameRect.width / bounds.width) * cssWidth,
				height: (frameRect.height / bounds.height) * cssHeight,
			};
		};

		const measureText = (text: string, fontSize: number) => {
			measureCanvas.current ??= document.createElement("canvas");
			const ctx = measureCanvas.current.getContext("2d");
			if (!ctx) return Math.max(text.length * fontSize * 0.55, 1);
			ctx.font = `${fontSize}px ${FONT_FAMILY}`;
			return Math.max(ctx.measureText(text).width, 1);
		};

		return ocrResult.lines.flatMap((line) => {
			const rect = sourceToCss(line.bounds);
			if (!line.text.trim() || !rect) return [];

			const lineHeight = Math.max(rect.height, 1);
			const fontSize = Math.max(lineHeight * 0.78, 1);
			const textWidth = measureText(line.text, fontSize);
			// The overlay text will not naturally be the same width as the pixels
			// it covers, so it is stretched to fit. Selection then lands on the
			// right glyphs instead of drifting along the line.
			return [
				{
					text: line.text,
					rect,
					fontSize,
					lineHeight,
					textWidth,
					scaleX: rect.width / textWidth,
				},
			];
		});
	}, [ocrResult, sourceRegion, bounds, imageRect, cssWidth, cssHeight]);

	return (
		<div
			className="pointer-events-none absolute left-0 top-0 z-[15] overflow-visible"
			style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
		>
			{textLayouts.map((layout) => (
				<span
					// Position plus content: two recognised lines cannot share both.
					key={`${layout.rect.x}:${layout.rect.y}:${layout.text}`}
					onMouseDown={() => setSelectedAnnotationId(null)}
					style={{
						position: "absolute",
						display: "block",
						left: `${layout.rect.x}px`,
						top: `${layout.rect.y}px`,
						width: `${layout.textWidth}px`,
						height: `${layout.lineHeight}px`,
						fontFamily: FONT_FAMILY,
						fontSize: `${layout.fontSize}px`,
						lineHeight: `${layout.lineHeight}px`,
						letterSpacing: "0",
						whiteSpace: "pre",
						color: "transparent",
						caretColor: "transparent",
						overflow: "visible",
						// Only selectable with the select tool; while drawing an
						// annotation this must not swallow the drag.
						pointerEvents: activeTool === "select" ? "auto" : "none",
						userSelect: "text",
						WebkitUserSelect: "text",
						cursor: "text",
						transform: `scaleX(${layout.scaleX})`,
						transformOrigin: "left top",
					}}
				>
					{layout.text}
				</span>
			))}
		</div>
	);
}
