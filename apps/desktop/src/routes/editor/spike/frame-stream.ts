import { invoke } from "@tauri-apps/api/core";
import {
	connectFrameSocket,
	type SocketFrame,
} from "../../screenshot-editor/frameSocket";

/** A decoded frame, or — when only Rust's throughput is being measured — a
 * counted one. Nothing decodes NV12 on the frontend yet, so those arrive
 * without a bitmap. */
export type StreamFrame = SocketFrame | { bitmap: null; frameNumber: number };

/** Frames in arrival order, from `start_frame_stream`.
 *
 * `maxFrames` lets Rust stop of its own accord rather than being cut off by a
 * closing socket — which matters because the renderer only logs its stage
 * profile on a clean finish.
 *
 * The scrub API (`RenderFrameEvent`) is a watch channel — last value wins — so
 * a compositor built on it serialises: ask, wait for Rust, composite, ask
 * again. This feed instead has Rust render ahead into a bounded queue, so
 * compositing frame N overlaps rendering N+1.
 *
 * `invoke` rather than `commands`: the generated bindings only refresh on a
 * Rust rebuild, and nothing else should depend on a throwaway spike command. */
export async function* streamFrames(
	fps: number,
	resolutionBase: { width: number; height: number },
	nv12 = false,
	maxFrames: number | null = null,
): AsyncGenerator<StreamFrame> {
	const url = await invoke<string>("start_frame_stream", {
		fps,
		resolutionBase: { x: resolutionBase.width, y: resolutionBase.height },
		nv12,
		maxFrames,
	});

	const queue: StreamFrame[] = [];
	let notify: (() => void) | null = null;
	let done = false;

	const wake = () => {
		notify?.();
		notify = null;
	};

	// ponytail: the socket client reads eagerly, so the only backpressure is
	// TCP and Rust's queue depth — fine while compositing is far cheaper than
	// rendering. Add a pull-based reader if that stops being true.
	if (nv12) {
		// No decoder for NV12 here: count the frames off the wire so the run
		// measures the renderer and nothing else.
		const socket = new WebSocket(url);
		socket.binaryType = "arraybuffer";
		let counted = 0;
		socket.onmessage = () => {
			queue.push({ bitmap: null, frameNumber: counted++ });
			wake();
		};
		socket.onclose = () => {
			done = true;
			wake();
		};

		try {
			yield* drainQueue(
				queue,
				() => done,
				(resolve) => {
					notify = resolve;
				},
			);
		} finally {
			socket.close();
		}
		return;
	}

	const disconnect = connectFrameSocket(
		url,
		(frame) => {
			queue.push(frame);
			wake();
		},
		() => {
			// Rust closes when it runs out of frames, so the caller doesn't have
			// to guess a count.
			done = true;
			wake();
		},
	);

	try {
		yield* drainQueue(
			queue,
			() => done,
			(resolve) => {
				notify = resolve;
			},
		);
	} finally {
		disconnect();
		for (const frame of queue) frame.bitmap?.close();
	}
}

async function* drainQueue(
	queue: StreamFrame[],
	isDone: () => boolean,
	waitForNext: (resolve: () => void) => void,
): AsyncGenerator<StreamFrame> {
	while (true) {
		const frame = queue.shift();
		if (frame) {
			yield frame;
			continue;
		}
		if (isDone()) return;
		await new Promise<void>(waitForNext);
	}
}
