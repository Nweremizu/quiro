import type {
	CaptionSegment,
	CaptionTrackSegment,
	CaptionWord,
	ProjectConfiguration,
	SegmentRecordings,
	TimelineSegment,
} from "@/utils/tauri";
import { type ClipTransition, clipTimelineOffsets } from "./clip-transitions";

const CAPTION_EDL_SEPARATOR = "::edl";
const MAX_CAPTION_WORD_DURATION = 2.5;

type SourceMapping = {
	segmentIndex: number;
	sourceStart: number;
	sourceEnd: number;
	editedStart: number;
	timescale: number;
};

export function sourceCaptionId(trackId: string) {
	const index = trackId.indexOf(CAPTION_EDL_SEPARATOR);
	return index < 0 ? trackId : trackId.slice(0, index);
}

function mappings(
	timelineSegments: TimelineSegment[],
	recordings: SegmentRecordings[],
	transitions: ClipTransition[],
): SourceMapping[] {
	const recordingOffsets: number[] = [];
	let sourceOffset = 0;
	for (const recording of recordings) {
		recordingOffsets.push(sourceOffset);
		sourceOffset += recording.display.duration;
	}

	const editedOffsets = clipTimelineOffsets(timelineSegments, transitions);
	return timelineSegments.map((segment, index) => {
		const recordingIndex = segment.recordingSegment ?? 0;
		const recordingOffset = recordingOffsets[recordingIndex] ?? 0;
		return {
			segmentIndex: index,
			sourceStart: recordingOffset + segment.start,
			sourceEnd: recordingOffset + segment.end,
			editedStart: editedOffsets[index] ?? 0,
			timescale: segment.timescale || 1,
		};
	});
}

function mapRange(start: number, end: number, mapping: SourceMapping) {
	const overlapStart = Math.max(start, mapping.sourceStart);
	const overlapEnd = Math.min(end, mapping.sourceEnd);
	if (overlapStart >= overlapEnd) return null;
	return {
		start:
			mapping.editedStart +
			(overlapStart - mapping.sourceStart) / mapping.timescale,
		end:
			mapping.editedStart +
			(overlapEnd - mapping.sourceStart) / mapping.timescale,
	};
}

function captionText(words: CaptionWord[]) {
	return words
		.map((word) => word.text.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+([,.!?;:%)\]}])/g, "$1");
}

function sanitizeCaption(segment: CaptionSegment): CaptionSegment {
	const sourceWords = segment.words ?? [];
	if (sourceWords.length === 0) return { ...segment, words: [] };
	const words = sourceWords.map((word) => ({
		...word,
		end: Math.min(word.end, word.start + MAX_CAPTION_WORD_DURATION),
	}));
	return {
		...segment,
		end: Math.min(segment.end, words[words.length - 1]?.end ?? segment.end),
		words,
	};
}

export function mapCaptionsToEditedTimeline(
	segments: CaptionSegment[],
	timelineSegments: TimelineSegment[],
	recordings: SegmentRecordings[],
	transitions: ClipTransition[] = [],
) {
	const sourceMappings = mappings(timelineSegments, recordings, transitions);
	const result: CaptionSegment[] = [];

	for (const rawCaption of segments) {
		const caption = sanitizeCaption(rawCaption);
		const projected: CaptionSegment[] = sourceMappings.flatMap((mapping) => {
			const captionWords = caption.words ?? [];
			if (captionWords.length > 0) {
				const words = captionWords.flatMap((word) => {
					const range = mapRange(word.start, word.end, mapping);
					return range ? [{ ...word, ...range }] : [];
				});
				if (words.length === 0) return [];
				return [
					{
						...caption,
						start: words[0].start,
						end: words[words.length - 1]?.end ?? words[0].end,
						text: captionText(words),
						words,
					},
				];
			}

			const range = mapRange(caption.start, caption.end, mapping);
			return range ? [{ ...caption, ...range }] : [];
		});

		projected.forEach((segment, index) => {
			result.push({
				...segment,
				id:
					projected.length === 1
						? caption.id
						: `${caption.id}${CAPTION_EDL_SEPARATOR}${index}`,
			});
		});
	}

	return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function deriveCaptionTrackSegments(
	segments: CaptionSegment[],
	timelineSegments: TimelineSegment[],
	recordings: SegmentRecordings[],
	previous: CaptionTrackSegment[],
	transitions: ClipTransition[] = [],
): CaptionTrackSegment[] {
	const overrides = new Map<
		string,
		Pick<
			CaptionTrackSegment,
			| "fadeDurationOverride"
			| "lingerDurationOverride"
			| "positionOverride"
			| "colorOverride"
			| "backgroundColorOverride"
			| "fontSizeOverride"
		>
	>();
	for (const segment of previous) {
		const id = sourceCaptionId(segment.id);
		if (!overrides.has(id)) {
			overrides.set(id, {
				fadeDurationOverride: segment.fadeDurationOverride,
				lingerDurationOverride: segment.lingerDurationOverride,
				positionOverride: segment.positionOverride,
				colorOverride: segment.colorOverride,
				backgroundColorOverride: segment.backgroundColorOverride,
				fontSizeOverride: segment.fontSizeOverride,
			});
		}
	}

	return mapCaptionsToEditedTimeline(
		segments,
		timelineSegments,
		recordings,
		transitions,
	).map((segment) => ({
		id: segment.id,
		start: segment.start,
		end: segment.end,
		text: segment.text,
		words: segment.words,
		fadeDurationOverride: null,
		lingerDurationOverride: null,
		positionOverride: null,
		colorOverride: null,
		backgroundColorOverride: null,
		fontSizeOverride: null,
		...overrides.get(sourceCaptionId(segment.id)),
	}));
}

export function normalizeCaptionProject(
	project: ProjectConfiguration,
	recordings: SegmentRecordings[],
): ProjectConfiguration {
	const captions = project.captions;
	const timeline = project.timeline;
	if (!captions || !timeline) return project;
	if (captions.segments.length === 0) {
		if ((timeline.captionSegments ?? []).length === 0) return project;
		return {
			...project,
			timeline: { ...timeline, captionSegments: [] },
		};
	}
	if (!captions.sourceTimed) {
		if ((timeline.captionSegments ?? []).length > 0) return project;
		return {
			...project,
			timeline: {
				...timeline,
				captionSegments: captions.segments.map((segment) => ({
					...segment,
					fadeDurationOverride: null,
					lingerDurationOverride: null,
					positionOverride: null,
					colorOverride: null,
					backgroundColorOverride: null,
					fontSizeOverride: null,
				})),
			},
		};
	}

	return {
		...project,
		timeline: {
			...timeline,
			captionSegments: deriveCaptionTrackSegments(
				captions.segments,
				timeline.segments,
				recordings,
				timeline.captionSegments ?? [],
				timeline.transitions ?? [],
			),
		},
	};
}

export function mapSourceTimeToEdited(
	sourceTime: number,
	timelineSegments: TimelineSegment[],
	recordings: SegmentRecordings[],
	transitions: ClipTransition[] = [],
) {
	for (const mapping of mappings(timelineSegments, recordings, transitions)) {
		if (sourceTime >= mapping.sourceStart && sourceTime <= mapping.sourceEnd) {
			return (
				mapping.editedStart +
				(sourceTime - mapping.sourceStart) / mapping.timescale
			);
		}
	}
	return null;
}

export function mapEditedTimeToSource(
	editedTime: number,
	timelineSegments: TimelineSegment[],
	recordings: SegmentRecordings[],
	transitions: ClipTransition[] = [],
	sourceRange?: { start: number; end: number },
	overlapPreference: "outgoing" | "incoming" = "outgoing",
) {
	let fallback: number | null = null;
	for (const mapping of mappings(timelineSegments, recordings, transitions)) {
		const editedEnd =
			mapping.editedStart +
			(mapping.sourceEnd - mapping.sourceStart) / mapping.timescale;
		if (editedTime >= mapping.editedStart && editedTime <= editedEnd) {
			const sourceTime =
				mapping.sourceStart +
				(editedTime - mapping.editedStart) * mapping.timescale;
			if (
				sourceRange &&
				sourceRange.start < mapping.sourceEnd &&
				sourceRange.end > mapping.sourceStart
			) {
				return sourceTime;
			}
			if (fallback === null || overlapPreference === "incoming") {
				fallback = sourceTime;
			}
		}
	}
	return fallback;
}

export function retimeCaptionSegment(
	segment: CaptionSegment,
	start: number,
	end: number,
): CaptionSegment {
	const nextStart = Math.max(0, Math.min(start, end - 0.001));
	const nextEnd = Math.max(nextStart + 0.001, end);
	const previousDuration = segment.end - segment.start;
	const nextDuration = nextEnd - nextStart;
	const words = (segment.words ?? []).map((word) => {
		const relativeStart =
			previousDuration > 0
				? (word.start - segment.start) / previousDuration
				: 0;
		const relativeEnd =
			previousDuration > 0 ? (word.end - segment.start) / previousDuration : 1;
		return {
			...word,
			start: nextStart + Math.min(1, Math.max(0, relativeStart)) * nextDuration,
			end: nextStart + Math.min(1, Math.max(0, relativeEnd)) * nextDuration,
		};
	});

	return { ...segment, start: nextStart, end: nextEnd, words };
}

export function syncCaptionWordsWithText(
	text: string,
	words: CaptionWord[],
	start: number,
	end: number,
) {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [];
	if (tokens.length === words.length) {
		return words.map((word, index) => ({ ...word, text: tokens[index] }));
	}
	const step = Math.max(0, end - start) / tokens.length;
	return tokens.map((token, index) => ({
		text: token,
		start: start + step * index,
		end: index === tokens.length - 1 ? end : start + step * (index + 1),
	}));
}
