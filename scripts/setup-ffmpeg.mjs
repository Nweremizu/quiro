// Fetches the FFmpeg shared libraries the recording/encoding crates link
// against and the desktop bundle ships next to the executable.
//
// `.cargo/config.toml` points FFMPEG_DIR at target/native-deps for the
// link-time .lib/.h files; this also drops the runtime DLLs in target/ffmpeg/bin
// so `tauri.windows.conf.json` can bundle them. Without the DLLs the installed
// app fails to start with "avcodec-61.dll not found".
//
// Windows only. On Linux CI the -dev packages come from apt; on macOS from brew.

import { exec as execCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execCb);
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const targetDir = path.join(rootDir, "target");

// FFmpeg 7.1 — must match the ABI the `ffmpeg-sys-next` build expects
// (avcodec 61 / avformat 61 / avutil 59 / …). BtbN ships a versioned tag.
const TAG = "n7.1";
const ASSET = `ffmpeg-${TAG}-latest-win64-gpl-shared.zip`;
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${ASSET}`;

const DLLS = [
	"avcodec-61.dll",
	"avdevice-61.dll",
	"avfilter-10.dll",
	"avformat-61.dll",
	"avutil-59.dll",
	"postproc-58.dll",
	"swresample-5.dll",
	"swscale-8.dll",
];

const exists = (p) =>
	fs
		.access(p)
		.then(() => true)
		.catch(() => false);

async function main() {
	if (os.platform() !== "win32") {
		console.log("setup-ffmpeg: non-Windows, nothing to do (use apt/brew).");
		return;
	}

	const binDir = path.join(targetDir, "ffmpeg", "bin");
	const nativeLib = path.join(targetDir, "native-deps", "lib");
	const nativeInc = path.join(targetDir, "native-deps", "include");
	const marker = path.join(binDir, "asset.txt");

	// Respect an existing working setup (e.g. a hand-placed gyan.dev build) —
	// only fetch when a required DLL or the link libs are actually missing.
	const haveDlls = (
		await Promise.all(DLLS.map((d) => exists(path.join(binDir, d))))
	).every(Boolean);
	if (
		haveDlls &&
		(await exists(path.join(nativeLib, "avcodec.lib"))) &&
		(await exists(nativeInc))
	) {
		if (!(await exists(marker))) await fs.writeFile(marker, "pre-existing");
		console.log(
			"Using existing FFmpeg in target/ (all DLLs + link libs present)",
		);
		return;
	}

	await fs.mkdir(targetDir, { recursive: true });
	const zipPath = path.join(targetDir, ASSET);
	if (!(await exists(zipPath))) {
		console.log(`Downloading ${ASSET}…`);
		const res = await fetch(URL);
		if (!res.ok) throw new Error(`Failed to download ${URL}: ${res.status}`);
		await fs.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
	} else {
		console.log(`Using cached archive ${ASSET}`);
	}

	const extractRoot = path.join(targetDir, "ffmpeg-extract");
	await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
	await fs.mkdir(extractRoot, { recursive: true });
	await exec(
		`Expand-Archive -Path "${zipPath}" -DestinationPath "${extractRoot}" -Force`,
		{ shell: "powershell.exe" },
	);

	// The archive has a single top-level folder.
	const [top] = await fs.readdir(extractRoot);
	const src = path.join(extractRoot, top);

	await fs.mkdir(binDir, { recursive: true });
	for (const dll of DLLS) {
		await fs.copyFile(path.join(src, "bin", dll), path.join(binDir, dll));
	}

	// Link-time libs + headers for FFMPEG_DIR.
	await fs.rm(nativeLib, { recursive: true, force: true }).catch(() => {});
	await fs.rm(nativeInc, { recursive: true, force: true }).catch(() => {});
	await fs.cp(path.join(src, "lib"), nativeLib, { recursive: true });
	await fs.cp(path.join(src, "include"), nativeInc, { recursive: true });

	await fs.writeFile(marker, ASSET);
	await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
	console.log(`Prepared FFmpeg at ${binDir}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
