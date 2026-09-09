import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(
	new URL("./frameSocket.ts", import.meta.url),
	"utf8",
);
const { outputText } = ts.transpileModule(source, {
	compilerOptions: {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ES2022,
	},
});
const { connectFrameSocket } = await import(
	`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("paused socket frames drain a decoder that holds its newest output", async () => {
	const originals = [
		globalThis.WebSocket,
		globalThis.VideoDecoder,
		globalThis.EncodedVideoChunk,
	];
	let socket;
	let decoder;
	let playing = false;
	const displayed = [];
	globalThis.WebSocket = class {
		constructor() {
			socket = this;
		}
		close() {}
	};
	globalThis.EncodedVideoChunk = class {
		constructor(init) {
			Object.assign(this, init);
		}
	};
	globalThis.VideoDecoder = class {
		state = "unconfigured";
		decodeQueueSize = 0;
		pending = [];
		flushes = 0;
		constructor(callbacks) {
			this.callbacks = callbacks;
			decoder = this;
		}
		configure(config) {
			this.config = config;
			this.state = "configured";
		}
		emit() {
			const chunk = this.pending.shift();
			this.callbacks.output({
				timestamp: chunk.timestamp,
				displayWidth: 1920,
				displayHeight: 1080,
				close() {},
			});
		}
		decode(chunk) {
			this.pending.push(chunk);
			if (this.pending.length > 1) this.emit();
		}
		async flush() {
			this.flushes++;
			while (this.pending.length) this.emit();
		}
		close() {
			this.state = "closed";
		}
	};
	let disconnect;
	try {
		disconnect = connectFrameSocket(
			"ws://test",
			(frame) => displayed.push(frame.frameNumber),
			undefined,
			{ flushAfterDecode: () => !playing },
		);
		const send = (frame) => {
			const buffer = new ArrayBuffer(33);
			new Uint8Array(buffer).set([1, 66, 0, 31, 0]);
			const view = new DataView(buffer);
			[4, 1080, 1920, frame].forEach((value, index) => {
				view.setUint32(5 + index * 4, value, true);
			});
			view.setUint32(29, 0x48323634, true);
			socket.onmessage({ data: buffer });
		};
		for (const frame of [0, 86, 890, 86, 86]) {
			send(frame);
			await Promise.resolve();
			assert.equal(displayed.at(-1), frame);
			assert.equal(decoder.pending.length, 0);
		}
		playing = true;
		send(100);
		send(101);
		assert.equal(decoder.flushes, 5);
		playing = false;
		send(890);
		await Promise.resolve();
		assert.equal(displayed.at(-1), 890);
		assert.equal(decoder.pending.length, 0);
	} finally {
		disconnect?.();
		[
			globalThis.WebSocket,
			globalThis.VideoDecoder,
			globalThis.EncodedVideoChunk,
		] = originals;
	}
});
