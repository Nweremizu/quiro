import { useEffect, useRef, useState } from "react";

// Decodes the wire format the Rust side packs in frame_ws.rs
// (pack_frame_data/pack_ws_frame): raw pixel bytes followed by a small
// little-endian trailer. RGBA frames: stride,height,width,frame_number
// (u32 each) + target_time_ns (u64) = 24 bytes. NV12 frames: the same five
// fields plus a 4-byte format magic = 28 bytes, magic distinguishing
// limited- vs full-range color.
//
// This is a deliberately small subset of Cap's utils/socket.ts: no
// SharedArrayBuffer/Worker/WebGPU pipeline, no FPS telemetry, no mirror
// canvas — just main-thread WebSocket -> Canvas2D, which is what a ~230px
// preview bubble actually needs. Add the rest only if this measurably
// can't keep up.

const RGBA_TRAILER_SIZE = 24;
const NV12_TRAILER_SIZE = 28;
const NV12_MAGIC = 0x4e563132; // "NV12"
const NV12_FULL_MAGIC = 0x4e563146; // "NV1F" — full-range variant

type FrameMeta = {
	width: number;
	height: number;
	stride: number;
	nv12FullRange: boolean | null; // null when the frame is plain RGBA
};

function readTrailer(buffer: ArrayBuffer): FrameMeta | null {
	if (buffer.byteLength >= NV12_TRAILER_SIZE) {
		const magic = new DataView(buffer, buffer.byteLength - 4, 4).getUint32(
			0,
			true,
		);
		if (magic === NV12_MAGIC || magic === NV12_FULL_MAGIC) {
			const meta = new DataView(
				buffer,
				buffer.byteLength - NV12_TRAILER_SIZE,
				NV12_TRAILER_SIZE,
			);
			return {
				stride: meta.getUint32(0, true),
				height: meta.getUint32(4, true),
				width: meta.getUint32(8, true),
				nv12FullRange: magic === NV12_FULL_MAGIC,
			};
		}
	}

	if (buffer.byteLength >= RGBA_TRAILER_SIZE) {
		const meta = new DataView(
			buffer,
			buffer.byteLength - RGBA_TRAILER_SIZE,
			RGBA_TRAILER_SIZE,
		);
		return {
			stride: meta.getUint32(0, true),
			height: meta.getUint32(4, true),
			width: meta.getUint32(8, true),
			nv12FullRange: null,
		};
	}

	return null;
}

// YUV 4:2:0 (NV12) -> RGBA, BT.601 — matches Cap's convertNv12ToRgbaMainThread.
function nv12ToRgba(
	src: Uint8ClampedArray,
	width: number,
	height: number,
	stride: number,
	fullRange: boolean,
	out: Uint8ClampedArray,
) {
	const ySize = stride * height;
	const uv = src.subarray(ySize);

	for (let row = 0; row < height; row++) {
		const yRow = row * stride;
		const uvRow = (row >> 1) * stride;
		const outRow = row * width * 4;

		for (let col = 0; col < width; col++) {
			const y = src[yRow + col];
			const uvCol = (col >> 1) * 2;
			const u = uv[uvRow + uvCol] - 128;
			const v = uv[uvRow + uvCol + 1] - 128;

			let r: number;
			let g: number;
			let b: number;
			if (fullRange) {
				r = y + ((359 * v + 128) >> 8);
				g = y - ((88 * u + 183 * v + 128) >> 8);
				b = y + ((454 * u + 128) >> 8);
			} else {
				const c = 298 * (y - 16);
				r = (c + 409 * v + 128) >> 8;
				g = (c - 100 * u - 208 * v + 128) >> 8;
				b = (c + 516 * u + 128) >> 8;
			}

			const o = outRow + col * 4;
			out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
			out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
			out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
			out[o + 3] = 255;
		}
	}
}

export function useCameraFrameSocket(
	wsUrl: string | null,
	/** Reports the source frame's dimensions, for aspect-ratio-aware layout. */
	onFrameSize?: (size: { width: number; height: number }) => void,
) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [connected, setConnected] = useState(false);
	const [hasFrame, setHasFrame] = useState(false);

	// Kept in a ref so a caller passing an inline arrow function doesn't tear
	// down and reopen the socket on every render.
	const onFrameSizeRef = useRef(onFrameSize);
	onFrameSizeRef.current = onFrameSize;

	useEffect(() => {
		setConnected(false);
		setHasFrame(false);
		if (!wsUrl) return;

		let cancelled = false;
		let ctx: CanvasRenderingContext2D | null = null;
		let cachedImageData: ImageData | null = null;
		let rgbaScratch: Uint8ClampedArray | null = null;
		let pendingBuffer: ArrayBuffer | null = null;
		let rafId: number | null = null;
		let paintedFirstFrame = false;
		let reportedWidth = 0;
		let reportedHeight = 0;

		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";
		ws.onopen = () => !cancelled && setConnected(true);
		ws.onclose = () => !cancelled && setConnected(false);
		ws.onerror = () => !cancelled && setConnected(false);

		const paint = () => {
			rafId = null;
			const buffer = pendingBuffer;
			pendingBuffer = null;
			if (!buffer || cancelled) return;

			const meta = readTrailer(buffer);
			const canvas = canvasRef.current;
			if (!meta || meta.width <= 0 || meta.height <= 0 || !canvas) return;

			if (canvas.width !== meta.width || canvas.height !== meta.height) {
				canvas.width = meta.width;
				canvas.height = meta.height;
				cachedImageData = null;
			}
			if (!ctx || ctx.canvas !== canvas) {
				ctx = canvas.getContext("2d", { alpha: false });
			}
			if (!ctx) return;
			if (
				!cachedImageData ||
				cachedImageData.width !== meta.width ||
				cachedImageData.height !== meta.height
			) {
				cachedImageData = new ImageData(meta.width, meta.height);
			}

			if (meta.nv12FullRange !== null) {
				const pixels = new Uint8ClampedArray(
					buffer,
					0,
					buffer.byteLength - NV12_TRAILER_SIZE,
				);
				const rgbaLen = meta.width * meta.height * 4;
				if (!rgbaScratch || rgbaScratch.length < rgbaLen) {
					rgbaScratch = new Uint8ClampedArray(rgbaLen);
				}
				nv12ToRgba(
					pixels,
					meta.width,
					meta.height,
					meta.stride,
					meta.nv12FullRange,
					rgbaScratch,
				);
				cachedImageData.data.set(rgbaScratch.subarray(0, rgbaLen));
			} else {
				const rowBytes = meta.width * 4;
				const pixels = new Uint8ClampedArray(
					buffer,
					0,
					buffer.byteLength - RGBA_TRAILER_SIZE,
				);
				if (meta.stride === rowBytes) {
					cachedImageData.data.set(pixels.subarray(0, rowBytes * meta.height));
				} else {
					// Rows are padded to `stride` bytes — copy row-by-row to strip it.
					for (let row = 0; row < meta.height; row++) {
						const start = row * meta.stride;
						cachedImageData.data.set(
							pixels.subarray(start, start + rowBytes),
							row * rowBytes,
						);
					}
				}
			}

			ctx.putImageData(cachedImageData, 0, 0);
			if (!paintedFirstFrame) {
				paintedFirstFrame = true;
				setHasFrame(true);
			}
			// Only on change — a camera can switch resolution mid-stream, but
			// firing this every frame would re-render the consumer at 60fps.
			if (reportedWidth !== meta.width || reportedHeight !== meta.height) {
				reportedWidth = meta.width;
				reportedHeight = meta.height;
				onFrameSizeRef.current?.({ width: meta.width, height: meta.height });
			}
		};

		ws.onmessage = (event) => {
			if (cancelled) return;
			pendingBuffer = event.data as ArrayBuffer;
			if (rafId === null) rafId = requestAnimationFrame(paint);
		};

		return () => {
			cancelled = true;
			if (rafId !== null) cancelAnimationFrame(rafId);
			ws.close();
		};
	}, [wsUrl]);

	return { canvasRef, connected, hasFrame };
}
