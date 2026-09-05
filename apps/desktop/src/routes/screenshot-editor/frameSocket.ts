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
/** Formats that carry a magic word gain four bytes over the RGBA trailer. */
const TAGGED_TRAILER_BYTES = 28;
/** "H264" little-endian, matching `frame_ws.rs`. */
const H264_MAGIC = 0x48323634;

export type SocketFrame = {
	/** A `VideoFrame` on the fast path, an `ImageBitmap` on the fallback. Both
	 * are valid `drawImage`/`texImage2D` sources and both have `close()`. */
	bitmap: ImageBitmap | VideoFrame;
	width: number;
	height: number;
	/** The renderer echoes the config revision here, so a frame can be matched
	 * to the edit that produced it and stale frames ignored. */
	frameNumber: number;
};

/** Reads the codec string out of the encoder's own SPS, rather than assuming a
 * profile the hardware encoder may not have chosen. Handles both shapes ffmpeg
 * emits: `avcC` (starts with 0x01, profile/compat/level at bytes 1-3) and
 * Annex-B (a start code, then an SPS NAL whose next three bytes are the same
 * fields). */
export function codecFromConfig(config: Uint8Array): string {
	const hex = (a: number, b: number, c: number) =>
		`avc1.${[a, b, c].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

	if (config.length >= 4 && config[0] === 1)
		return hex(config[1], config[2], config[3]);

	for (let i = 0; i + 4 < config.length; i++) {
		const startCode =
			config[i] === 0 &&
			config[i + 1] === 0 &&
			(config[i + 2] === 1 || (config[i + 2] === 0 && config[i + 3] === 1));
		if (!startCode) continue;
		const nal = config[i + 2] === 1 ? i + 3 : i + 4;
		if ((config[nal] & 0x1f) === 7 && nal + 3 < config.length) {
			return hex(config[nal + 1], config[nal + 2], config[nal + 3]);
		}
	}
	// Constrained baseline 3.1 — a decodable guess if the SPS could not be read.
	return "avc1.42E01F";
}

/** Wraps a `VideoDecoder` for the preview's all-intra H.264 stream.
 *
 * Every frame is a keyframe, so there is no reference chain to protect: a
 * dropped frame costs one picture and nothing after it. That is what lets the
 * socket keep dropping stale frames the way it always has. */
function createH264Decoder(
	onFrame: (frame: SocketFrame) => void,
	isClosed: () => boolean,
) {
	let decoder: VideoDecoder | null = null;
	let configured = "";
	let seenOutput = false;
	/** Whether the decoder was configured with an `avcC` description. Decides
	 * whether each chunk must carry its own parameter sets. */
	let usesDescription = false;
	let pending: { width: number; height: number; frameNumber: number }[] = [];

	const ensure = (config: Uint8Array, width: number, height: number) => {
		const codec = codecFromConfig(config);
		const key = `${codec}:${width}x${height}`;
		if (decoder && configured === key) return;

		decoder?.close();
		pending = [];
		decoder = new VideoDecoder({
			output: (frame) => {
				if (isClosed()) {
					frame.close();
					return;
				}
				if (!seenOutput) {
					seenOutput = true;
					console.info(
						`Preview decoder producing frames: ${frame.displayWidth}x${frame.displayHeight}`,
					);
				}
				const meta = pending.shift();
				onFrame({
					bitmap: frame,
					width: frame.displayWidth,
					height: frame.displayHeight,
					frameNumber: meta?.frameNumber ?? 0,
				});
			},
			error: (error) => {
				console.error("Preview decoder error:", error);
				decoder = null;
				configured = "";
			},
		});

		// `avcC` needs the description; Annex-B carries its parameter sets
		// in-band and must not have one.
		const isAvcC = config.length > 0 && config[0] === 1;
		decoder.configure(
			isAvcC
				? { codec, description: config, codedWidth: width, codedHeight: height }
				: { codec, codedWidth: width, codedHeight: height },
		);
		configured = key;
		usesDescription = isAvcC;
		console.info(
			`Preview decoder configured: ${codec} ${width}x${height}, ` +
				`${isAvcC ? "avcC description" : "in-band Annex-B"}`,
		);
	};

	return {
		/** `payload` is the whole wire payload: `[config][encoded frame]`. */
		decode(
			payload: Uint8Array,
			configLen: number,
			width: number,
			height: number,
			frameNumber: number,
		) {
			// Some encoders report no extradata and carry SPS/PPS in-band
			// instead. The parameter sets are then the only description
			// available, and since every frame is a keyframe one is always
			// present.
			const config = configLen > 0 ? payload.subarray(0, configLen) : payload;
			ensure(config, width, height);
			if (!decoder || decoder.state !== "configured") return;

			// An `avcC` description already carries the parameter sets, so the
			// chunk is frame data alone. Annex-B has no description, so the
			// parameter sets must stay *in* the chunk — stripping them left the
			// decoder with nothing to decode against, and it silently produced
			// no frames at all.
			const data = usesDescription ? payload.subarray(configLen) : payload;

			pending.push({ width, height, frameNumber });
			decoder.decode(
				new EncodedVideoChunk({
					type: "key",
					timestamp: frameNumber,
					data,
				}),
			);
		},
		close() {
			decoder?.close();
			decoder = null;
		},
	};
}

/** Encoded frames end with a magic word; raw RGBA frames have no tag, so the
 * check has to be on the trailer rather than a guess at the length. */
function isH264Frame(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength <= TAGGED_TRAILER_BYTES) return false;
	const view = new DataView(buffer);
	return view.getUint32(buffer.byteLength - 4, true) === H264_MAGIC;
}

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
	// Built on the first encoded frame; a raw-only stream never allocates one.
	let h264: ReturnType<typeof createH264Decoder> | null = null;

	socket.onmessage = (event) => {
		if (closed || !(event.data instanceof ArrayBuffer)) return;
		const buffer = event.data as ArrayBuffer;

		// The encoded path is synchronous and self-ordering — `VideoDecoder`
		// emits in decode order — so it skips the promise chain the ImageData
		// path needs.
		if (isH264Frame(buffer)) {
			const view = new DataView(buffer);
			const trailerAt = buffer.byteLength - TAGGED_TRAILER_BYTES;
			const configLen = view.getUint32(trailerAt, true);
			const height = view.getUint32(trailerAt + 4, true);
			const width = view.getUint32(trailerAt + 8, true);
			const frameNumber = view.getUint32(trailerAt + 12, true);

			if (!h264) h264 = createH264Decoder(onFrame, () => closed);
			h264.decode(
				new Uint8Array(buffer, 0, trailerAt),
				configLen,
				width,
				height,
				frameNumber,
			);
			return;
		}

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
		h264?.close();
		h264 = null;
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

	// Fast path: hand the padded buffer straight to a `VideoFrame`.
	//
	// `layout.stride` means the GPU's row padding needs no unpacking at all,
	// which removes the whole-frame allocation, the per-row copy and the
	// `createImageBitmap` round trip below — three passes over an 8MB buffer at
	// full quality, every frame. It is also synchronous, so frames stop
	// queueing behind an awaited decode.
	//
	// Not usable when the pixels need unpremultiplying: that rewrites them, and
	// `VideoFrame` has no premultiplied RGBA format to declare.
	if (!unpremultiply && typeof VideoFrame === "function") {
		try {
			const frame = new VideoFrame(new Uint8Array(buffer, 0, stride * height), {
				format: "RGBA",
				codedWidth: width,
				codedHeight: height,
				timestamp: frameNumber,
				layout: [{ offset: 0, stride }],
			});
			if (isClosed()) {
				frame.close();
				return;
			}
			onFrame({ bitmap: frame, width, height, frameNumber });
			return;
		} catch (error) {
			// Fall through to the ImageData path rather than dropping the frame.
			console.warn("VideoFrame path unavailable, falling back:", error);
		}
	}

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
