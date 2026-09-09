import { toast } from "@quiro/ui";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { CaptionSegment } from "@/utils/tauri";

export type CaptionExportFormat = "srt" | "vtt";

function timestamp(seconds: number, separator: "," | ".") {
	const total = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(total / 3_600_000);
	const minutes = Math.floor((total % 3_600_000) / 60_000);
	const secs = Math.floor((total % 60_000) / 1000);
	const millis = total % 1000;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function formatCaptionFile(
	format: CaptionExportFormat,
	segments: Pick<CaptionSegment, "start" | "end" | "text">[],
) {
	const separator = format === "srt" ? "," : ".";
	const body = segments
		.filter(
			(segment) =>
				segment.text.trim().length > 0 &&
				Number.isFinite(segment.start) &&
				Number.isFinite(segment.end) &&
				segment.end > segment.start,
		)
		.sort((a, b) => a.start - b.start || a.end - b.end)
		.map((segment, index) => {
			const text = segment.text.trim().replace(/\r\n?/g, "\n");
			const escaped =
				format === "vtt"
					? text
							.replace(/&/g, "&amp;")
							.replace(/</g, "&lt;")
							.replace(/>/g, "&gt;")
					: text;
			return `${index + 1}\n${timestamp(segment.start, separator)} --> ${timestamp(Math.max(segment.end, segment.start + 0.001), separator)}\n${escaped}`;
		})
		.join("\n\n");
	return `${format === "vtt" ? "WEBVTT\n\n" : ""}${body}${body ? "\n" : ""}`;
}

export async function saveCaptionFile(
	format: CaptionExportFormat,
	name: string,
	segments: Pick<CaptionSegment, "start" | "end" | "text">[],
) {
	const path = await save({
		defaultPath: `${name}.${format}`,
		filters: [{ name: format.toUpperCase(), extensions: [format] }],
	});
	if (!path) return;
	await writeTextFile(path, formatCaptionFile(format, segments));
	toast.success(`${format.toUpperCase()} saved`);
}
