import { useEffect, useRef, useState } from "react";

/** Number of peak bins to produce — enough for smooth display at any zoom. */
const TARGET_PEAK_COUNT = 2048;

export interface AudioPeaksData {
	/** One normalised amplitude value (0–1) per bin, covering the full duration. */
	peaks: Float32Array;
	/** Total duration of the decoded audio in milliseconds. */
	durationMs: number;
}

/**
 * Decode audio from a media file URL and produce a fixed-length array of peak
 * amplitudes suitable for waveform visualisation.
 *
 * Returns `null` while loading or if the file has no decodeable audio.
 */
export function useAudioPeaks(fileUrl: string | null | undefined): AudioPeaksData | null {
	const [data, setData] = useState<AudioPeaksData | null>(null);
	const urlRef = useRef(fileUrl);

	useEffect(() => {
		urlRef.current = fileUrl;
		setData(null);

		if (!fileUrl) {
			return;
		}

		let cancelled = false;

		(async () => {
			try {
				const response = await fetch(fileUrl);
				if (cancelled) return;

				const arrayBuffer = await response.arrayBuffer();
				if (cancelled) return;

				const audioCtx = new OfflineAudioContext(1, 1, 44100);
				const decoded = await audioCtx.decodeAudioData(arrayBuffer);
				if (cancelled) return;

				const channelData = decoded.getChannelData(0);
				const durationMs = decoded.duration * 1000;
				const binSize = Math.max(1, Math.floor(channelData.length / TARGET_PEAK_COUNT));
				const peakCount = Math.ceil(channelData.length / binSize);
				const peaks = new Float32Array(peakCount);

				for (let i = 0; i < peakCount; i++) {
					const start = i * binSize;
					const end = Math.min(start + binSize, channelData.length);
					let max = 0;
					for (let j = start; j < end; j++) {
						const abs = Math.abs(channelData[j]);
						if (abs > max) max = abs;
					}
					peaks[i] = max;
				}

				// Normalise to 0–1 range.
				let globalMax = 0;
				for (let i = 0; i < peaks.length; i++) {
					if (peaks[i] > globalMax) globalMax = peaks[i];
				}
				if (globalMax > 0) {
					for (let i = 0; i < peaks.length; i++) {
						peaks[i] /= globalMax;
					}
				}

				if (!cancelled && urlRef.current === fileUrl) {
					setData({ peaks, durationMs });
				}
			} catch {
				// File has no audio or decoding failed — leave as null.
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [fileUrl]);

	return data;
}
