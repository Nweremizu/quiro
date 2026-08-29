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
): () => void {
	let socket: WebSocket | null = new WebSocket(url);
	socket.binaryType = "arraybuffer";
	let closed = false;

	socket.onmessage = async (event) => {
		if (closed || !(event.data instanceof ArrayBuffer)) return;
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

		try {
			const bitmap = await createImageBitmap(
				new ImageData(pixels, width, height),
			);
			if (closed) {
				bitmap.close();
				return;
			}
			onFrame({ bitmap, width, height, frameNumber });
		} catch (error) {
			console.error("Failed to decode screenshot frame:", error);
		}
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
