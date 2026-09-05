// Self-check for the preview decoder's codec-string parser. Run via
// `pnpm check`, or alone:
//
//   npx esbuild src/routes/screenshot-editor/codec-config.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/cc.cjs && node /tmp/cc.cjs
//
// `VideoDecoder.configure` rejects a codec string that disagrees with the
// stream, and ffmpeg emits its parameter sets in two different shapes depending
// on the encoder — `avcC` from most hardware encoders, Annex-B from others. A
// wrong parse here is a preview that silently never decodes a single frame, so
// both shapes are pinned.

import { codecFromConfig } from "./frameSocket";

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

let assertions = 0;
function check(actual: string, expected: string, message: string) {
	assert(
		actual === expected,
		`${message}: expected ${expected}, got ${actual}`,
	);
	assertions++;
}

// avcC: [version=1][profile][compat][level][...]
check(
	codecFromConfig(new Uint8Array([1, 0x42, 0xe0, 0x1e, 0xff, 0xe1])),
	"avc1.42e01e",
	"avcC baseline 3.0",
);
check(
	codecFromConfig(new Uint8Array([1, 0x64, 0x00, 0x28, 0xff])),
	"avc1.640028",
	"avcC high 4.0",
);

// Annex-B, 4-byte start code, SPS NAL (type 7) then profile/compat/level.
check(
	codecFromConfig(
		new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9]),
	),
	"avc1.64001f",
	"Annex-B 4-byte start code",
);

// Annex-B, 3-byte start code.
check(
	codecFromConfig(new Uint8Array([0, 0, 1, 0x67, 0x42, 0xc0, 0x1e, 0x8c])),
	"avc1.42c01e",
	"Annex-B 3-byte start code",
);

// A leading non-SPS NAL (e.g. AUD) must be skipped rather than parsed.
check(
	codecFromConfig(
		new Uint8Array([
			0, 0, 0, 1, 0x09, 0x10, 0, 0, 0, 1, 0x67, 0x4d, 0x40, 0x1f, 0xaa,
		]),
	),
	"avc1.4d401f",
	"skips a non-SPS NAL to find the SPS",
);

// Unparseable input must still yield a decodable guess, not a crash or "".
const fallback = codecFromConfig(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
assert(
	fallback.startsWith("avc1."),
	"garbage input falls back to a valid codec",
);
assertions++;
assert(
	codecFromConfig(new Uint8Array([])).startsWith("avc1."),
	"empty is safe",
);
assertions++;

console.log(`codec-config: ALL PASS (${assertions} assertions)`);
