// Client for the frame websocket `frame_ws.rs` serves.
//
// Cap's equivalent (`utils/socket.ts`) is ~1400 lines because it also drives
// video playback: a decode worker, WebGPU/WebGL paths, FPS statistics, frame
// pacing. A screenshot is a single still that only re-renders when the
// project config changes, so none of that applies — what is needed is the
// wire format, which is read straight from `pack_ws_frame`.
//
// Layout, little-endian, metadata *appended after* the pixel data:
//   [ RGBA pixels ][ stride u32 | height u32 | width u32 | frame u32 | time u64 ]
// NV12 adds a 4-byte format magic; the screenshot renderer only ever sends
// RGBA (see screenshot_editor.rs), so that variant is not handled here.
const RGBA_TRAILER_BYTES = 24;

export type SocketFrame = {
	bitmap: ImageBitmap;
	width: number;
	height: number;
	/** The renderer echoes the config revision here, so a frame can be matched
	 * to the edit that produced it and stale frames ignored. */
	frameNumber: number;
};

export function connectFrameSocket(
	url: string,
	onFrame: (frame: SocketFrame) => void,
	onClose?: () => void,
	options?: { unpremultiply?: boolean },
): () => void {
	let socket: WebSocket | null = new WebSocket(url);
	socket.binaryType = "arraybuffer";
	let closed = false;
	// `createImageBitmap` is awaited, so without a chain two messages can
	// finish decoding out of order. Harmless for a single still, wrong for a
	// sequential stream.
	let decoding: Promise<void> = Promise.resolve();

	socket.onmessage = (event) => {
		if (closed || !(event.data instanceof ArrayBuffer)) return;
		decoding = decoding.then(() =>
			decodeFrame(
				event,
				onFrame,
				() => closed,
				options?.unpremultiply === true,
			),
		);
	};

	socket.onclose = () => {
		if (!closed) onClose?.();
	};
	socket.onerror = (event) => {
		console.error("Screenshot frame socket error:", event);
	};

	return () => {
		closed = true;
		socket?.close();
		socket = null;
	};
}

/**
 * Undoes the premultiplication wgpu's alpha blending leaves behind.
 *
 * A layer rendered onto a cleared, transparent target comes back as
 * `rgb * a` — that is what `BlendState::ALPHA_BLENDING` computes when there is
 * nothing underneath. `ImageData` is defined as straight alpha, so handing it
 * premultiplied pixels darkens every partly transparent one: the capture's
 * shadow and its antialiased edge, exactly where it is most visible.
 *
 * Only the composited layers need this, and only their soft edges do the work —
 * fully opaque and fully transparent pixels, which is nearly the whole buffer,
 * are skipped outright.
 */
function unpremultiplyInPlace(pixels: Uint8ClampedArray) {
	for (let i = 3; i < pixels.length; i += 4) {
		const alpha = pixels[i];
		if (alpha === 0 || alpha === 255) continue;
		const scale = 255 / alpha;
		pixels[i - 3] *= scale;
		pixels[i - 2] *= scale;
		pixels[i - 1] *= scale;
	}
}

async function decodeFrame(
	event: MessageEvent,
	onFrame: (frame: SocketFrame) => void,
	isClosed: () => boolean,
	unpremultiply: boolean,
) {
	const buffer = event.data as ArrayBuffer;
	if (buffer.byteLength <= RGBA_TRAILER_BYTES) return;

	const view = new DataView(buffer);
	const trailerAt = buffer.byteLength - RGBA_TRAILER_BYTES;
	const stride = view.getUint32(trailerAt, true);
	const height = view.getUint32(trailerAt + 4, true);
	const width = view.getUint32(trailerAt + 8, true);
	const frameNumber = view.getUint32(trailerAt + 12, true);

	if (width === 0 || height === 0) return;

	// GPU readback rows are padded to an alignment boundary, so `stride` is
	// usually wider than width*4. ImageData has no stride concept, so rows
	// are copied out individually when there is padding to drop.
	const rowBytes = width * 4;
	const pixels = new Uint8ClampedArray(rowBytes * height);
	const source = new Uint8Array(buffer, 0, trailerAt);

	if (stride === rowBytes) {
		pixels.set(source.subarray(0, rowBytes * height));
	} else {
		for (let row = 0; row < height; row++) {
			const from = row * stride;
			pixels.set(source.subarray(from, from + rowBytes), row * rowBytes);
		}
	}

	if (unpremultiply) unpremultiplyInPlace(pixels);

	try {
		const bitmap = await createImageBitmap(
			new ImageData(pixels, width, height),
		);
		if (isClosed()) {
			bitmap.close();
			return;
		}
		onFrame({ bitmap, width, height, frameNumber });
	} catch (error) {
		console.error("Failed to decode screenshot frame:", error);
	}
}
