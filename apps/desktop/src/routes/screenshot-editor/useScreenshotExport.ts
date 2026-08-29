import { toast } from "@quiro/ui";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/utils/tauri";
import { useScreenshotEditorContext } from "./context";
import type { SocketFrame } from "./frameSocket";
import { getImageRect } from "./layout";
import {
	canvasNeedsTransparency,
	canvasToBlob,
	renderScreenshotExportCanvas,
	type ScreenshotExportStatus,
} from "./screenshotExport";

// React port of Cap's `useScreenshotExport.ts`, minus the "share" destination
// (a cloud upload Quiro has no backend for).

/** The clipboard has no notion of transparency on Windows, where an alpha
 * channel comes back as black. Flattening onto white first is what Cap does. */
function withWhiteBackground(source: HTMLCanvasElement): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = source.width;
	canvas.height = source.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return source;
	ctx.fillStyle = "white";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, 0, 0);
	return canvas;
}

export function useScreenshotExport() {
	const {
		instance,
		latestFrame,
		annotations,
		project,
		previewCanvas,
		previewMaskCanvas,
		configRevision,
		originalImageSize,
	} = useScreenshotEditorContext();

	const [isExporting, setIsExporting] = useState(false);
	const [exportStatus, setExportStatus] =
		useState<ScreenshotExportStatus>("idle");

	// The poll below runs inside a promise, where a captured `latestFrame` would
	// stay frozen at whatever it was when the export started — Cap reads Solid
	// signals, which stay live on their own. Mirroring both into refs is what
	// makes the wait actually observe new frames instead of timing out.
	const latestFrameRef = useRef(latestFrame);
	const configRevisionRef = useRef(configRevision);
	useEffect(() => {
		latestFrameRef.current = latestFrame;
	}, [latestFrame]);
	useEffect(() => {
		configRevisionRef.current = configRevision;
	}, [configRevision]);

	/** Whether the on-screen frame is already at full source resolution. With no
	 * aspect ratio set the renderer emits the image at native size, so it always
	 * is; otherwise the preview may be letterboxed down and exporting from it
	 * would quietly downscale the result. */
	const canUsePreviewFrameForExport = useCallback(
		(frame: SocketFrame | null) => {
			if (!frame?.bitmap || !project) return false;
			if (project.aspectRatio === null) return true;

			const crop = project.background.crop;
			const sourceWidth =
				crop?.size.x ?? originalImageSize?.width ?? frame.width;
			const sourceHeight =
				crop?.size.y ?? originalImageSize?.height ?? frame.height;

			return frame.width >= sourceWidth && frame.height >= sourceHeight;
		},
		[project, originalImageSize],
	);

	/** Blocks until the renderer has caught up with the newest edit. Without
	 * this, exporting right after a slider drag encodes the frame from before
	 * it — the file and the screen disagree. */
	const waitForSyncedPreview = useCallback(
		() =>
			new Promise<SocketFrame>((resolve, reject) => {
				const deadline = Date.now() + 1500;
				const poll = () => {
					const frame = latestFrameRef.current;
					if (frame && frame.frameNumber === configRevisionRef.current) {
						resolve(frame);
					} else if (Date.now() >= deadline) {
						reject(new Error("Preview is still updating. Try again."));
					} else {
						window.setTimeout(poll, 16);
					}
				};
				poll();
			}),
		[],
	);

	const renderExportCanvas = useCallback(async () => {
		if (!project) throw new Error("Screenshot is still loading");

		const frame = await waitForSyncedPreview();
		const usePreviewFrame = canUsePreviewFrameForExport(frame);

		const renderedBitmap = usePreviewFrame
			? frame.bitmap
			: await createImageBitmap(
					new Blob(
						[
							new Uint8Array(
								await (async () => {
									const result = await commands.renderScreenshotForExport();
									if (result.status === "error") throw new Error(result.error);
									return result.data;
								})(),
							),
						],
						{ type: "image/png" },
					),
				);

		try {
			// Reusing the two live canvases skips re-blurring every mask, but only
			// when they match the bitmap exactly — a stale size would paste the
			// previous frame over the new one.
			const canReusePreviewCanvases =
				usePreviewFrame &&
				!!previewCanvas &&
				!!previewMaskCanvas &&
				previewCanvas.width === renderedBitmap.width &&
				previewCanvas.height === renderedBitmap.height &&
				previewMaskCanvas.width === renderedBitmap.width &&
				previewMaskCanvas.height === renderedBitmap.height;

			return renderScreenshotExportCanvas({
				renderedBitmap,
				project,
				annotations,
				frame,
				previewCanvas,
				previewMaskCanvas,
				canReusePreviewCanvases,
				// Where the screenshot sits inside the preview frame; the export
				// scales it up so the depth-of-field pass runs at output size.
				imageRect: frame
					? getImageRect(
							frame,
							originalImageSize,
							project.background.padding,
							project.background.crop,
							project.aspectRatio,
						)
					: null,
			});
		} finally {
			// The preview owns its own bitmap; only close one made here.
			if (!usePreviewFrame) renderedBitmap.close();
		}
	}, [
		project,
		annotations,
		previewCanvas,
		previewMaskCanvas,
		originalImageSize,
		waitForSyncedPreview,
		canUsePreviewFrameForExport,
	]);

	const exportImage = useCallback(
		async (destination: "file" | "clipboard") => {
			if (isExporting || !project) return;

			setIsExporting(true);
			setExportStatus("rendering");

			try {
				const outputCanvas = await renderExportCanvas();
				setExportStatus("encoding");

				if (destination === "file") {
					const savePath = await save({
						filters: [{ name: "PNG Image", extensions: ["png"] }],
						defaultPath: `${instance?.prettyName ?? "Screenshot"}.png`,
					});
					if (!savePath) return;

					const blob = await canvasToBlob(outputCanvas, "image/png");
					await writeFile(savePath, new Uint8Array(await blob.arrayBuffer()));
					toast.success("Screenshot saved");
					return;
				}

				const blobCanvas = canvasNeedsTransparency(outputCanvas, project)
					? outputCanvas
					: withWhiteBackground(outputCanvas);

				const blob = await canvasToBlob(blobCanvas, "image/png");
				try {
					if (
						typeof ClipboardItem === "undefined" ||
						!navigator.clipboard?.write
					)
						throw new Error("ClipboardItem unavailable");
					await navigator.clipboard.write([
						new ClipboardItem({ "image/png": blob }),
					]);
				} catch {
					// Falls back to the OS clipboard through Tauri, which takes raw
					// RGBA rather than an encoded PNG.
					const ctx = blobCanvas.getContext("2d");
					if (!ctx) throw new Error("Canvas not ready");
					const data = ctx.getImageData(
						0,
						0,
						blobCanvas.width,
						blobCanvas.height,
					);
					await writeImage(
						await Image.new(data.data, blobCanvas.width, blobCanvas.height),
					);
				}
				toast.success("Screenshot copied to clipboard");
			} catch (error) {
				console.error("Failed to export screenshot:", error);
				toast.error(
					error instanceof Error ? error.message : "Failed to export",
				);
			} finally {
				setExportStatus("idle");
				setIsExporting(false);
			}
		},
		[isExporting, project, instance, renderExportCanvas],
	);

	return { exportImage, exportStatus, isExporting };
}
