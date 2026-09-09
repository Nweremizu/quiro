import type { ProjectConfiguration } from "@/utils/tauri";

export type ScreenshotExportStatus = "idle" | "rendering" | "encoding";
export type Rect = { x: number; y: number; width: number; height: number };

const hasNoVisibleBackground = (
	source: ProjectConfiguration["background"]["source"],
) => {
	if (source.type === "color") return (source.alpha ?? 255) === 0;
	if (source.type === "wallpaper" || source.type === "image")
		return !source.path;
	return false;
};

export function nativeFrameToCanvas(renderedBitmap: ImageBitmap) {
	const canvas = document.createElement("canvas");
	canvas.width = renderedBitmap.width;
	canvas.height = renderedBitmap.height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Could not get canvas context");
	context.drawImage(renderedBitmap, 0, 0);
	return canvas;
}

export const canvasToBlob = (
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number,
) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Failed to create blob")),
			type,
			quality,
		),
	);

export const canvasNeedsTransparency = (
	canvas: HTMLCanvasElement,
	project: ProjectConfiguration,
) => {
	if (!hasNoVisibleBackground(project.background.source)) return false;

	const context = canvas.getContext("2d");
	if (!context) return true;

	const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
	for (let index = 3; index < data.length; index += 4) {
		if (data[index] !== 255) return true;
	}
	return false;
};
