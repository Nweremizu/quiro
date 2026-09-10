// Fetches the ONNX Runtime shared library that camera background blur needs.
//
// `quiro-camera-effects` builds `ort` with the `load-dynamic` feature on
// Windows/macOS/Linux, which means ONNX Runtime is NOT linked into the binary
// or downloaded by cargo — it is dlopen'd at runtime from whatever
// ORT_DYLIB_PATH points at. Without this step `SegmentationModel::new()` fails,
// `init_headless_blur()` returns None, and the blur toggle silently does
// nothing (see camera_legacy.rs's WsBlurState::process).
//
// Ported from Cap's scripts/setup.js, trimmed to just the ONNX Runtime part —
// Quiro's FFmpeg deps are already configured via FFMPEG_DIR in
// .cargo/config.toml.

import { exec as execCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const targetDir = path.join(rootDir, "target");

// Must satisfy the `api-23` feature the ort dependency pins (ONNX Runtime
// >= 1.23). Keep in sync with packages/crates/camera-effects/Cargo.toml.
const VERSION = "1.24.2";

const ASSETS = {
	win32: {
		x64: `onnxruntime-win-x64-${VERSION}.zip`,
		arm64: `onnxruntime-win-arm64-${VERSION}.zip`,
	},
	darwin: {
		arm64: `onnxruntime-osx-arm64-${VERSION}.tgz`,
		x64: `onnxruntime-osx-x86_64-${VERSION}.tgz`,
	},
	linux: {
		x64: `onnxruntime-linux-x64-${VERSION}.tgz`,
		arm64: `onnxruntime-linux-aarch64-${VERSION}.tgz`,
	},
};

const DYLIB_NAME = {
	win32: "onnxruntime.dll",
	darwin: "libonnxruntime.dylib",
	linux: "libonnxruntime.so",
};

const fileExists = (p) =>
	fs
		.access(p)
		.then(() => true)
		.catch(() => false);

async function main() {
	const platform = os.platform();
	const arch = os.arch();

	const assetName = ASSETS[platform]?.[arch];
	if (!assetName) {
		throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
	}

	const outputDir = path.join(targetDir, "native-deps", "onnxruntime", "lib");
	const outputPath = path.join(outputDir, DYLIB_NAME[platform]);
	const markerPath = path.join(outputDir, "asset.txt");

	const marker = await fs
		.readFile(markerPath, "utf-8")
		.then((v) => v.trim())
		.catch(() => null);

	if ((await fileExists(outputPath)) && marker === assetName) {
		console.log(`Using cached ONNX Runtime (${assetName})`);
		return outputPath;
	}

	const url = `https://github.com/microsoft/onnxruntime/releases/download/v${VERSION}/${assetName}`;
	const archivePath = path.join(targetDir, assetName);

	// A release build downloads this on every CI runner, so an occasional
	// connect timeout to github.com is a matter of when, not if — one took a
	// whole release run down. 4xx isn't retried: a wrong URL won't fix itself.
	async function fetchWithRetry(target, attempts = 3) {
		for (let attempt = 1; ; attempt++) {
			try {
				const res = await fetch(target);
				if (res.ok) return res;
				if (res.status < 500) {
					throw new Error(`Failed to download ${target}: ${res.status}`);
				}
				throw new Error(`${target} returned ${res.status}`);
			} catch (error) {
				const fatal = /: 4\d\d$/.test(error.message);
				if (fatal || attempt >= attempts) throw error;
				const backoffMs = attempt * 2000;
				console.log(
					`  attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${backoffMs}ms`,
				);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	}

	await fs.mkdir(targetDir, { recursive: true });
	if (!(await fileExists(archivePath))) {
		console.log(`Downloading ${assetName}…`);
		const res = await fetchWithRetry(url);
		await fs.writeFile(archivePath, Buffer.from(await res.arrayBuffer()));
	} else {
		console.log(`Using cached archive ${assetName}`);
	}

	const extractedName = assetName.replace(/\.(zip|tgz)$/, "");
	const extractDir = path.join(targetDir, extractedName);
	await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});

	if (assetName.endsWith(".zip")) {
		await exec(
			`Expand-Archive -Path "${archivePath}" -DestinationPath "${targetDir}" -Force`,
			{ shell: "powershell.exe" },
		);
	} else {
		await exec(`tar -xzf "${archivePath}" -C "${targetDir}"`);
	}

	const libDir = path.join(extractDir, "lib");
	const libNames = await fs.readdir(libDir);
	if (!libNames.includes(DYLIB_NAME[platform])) {
		throw new Error(`Archive is missing ${DYLIB_NAME[platform]}`);
	}

	await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
	await fs.mkdir(outputDir, { recursive: true });

	// Copy every sibling library too — on Windows the DirectML execution
	// provider pulls in its own DLLs that must sit next to onnxruntime.dll.
	const suffix = { win32: ".dll", darwin: ".dylib", linux: ".so" }[platform];
	for (const name of libNames) {
		if (!name.toLowerCase().includes(suffix)) continue;
		const src = path.join(libDir, name);
		if (!(await fs.stat(src)).isFile()) continue;
		await fs.copyFile(src, path.join(outputDir, name));
	}

	await fs.writeFile(markerPath, assetName);
	console.log(`Prepared ONNX Runtime at ${outputPath}`);
	return outputPath;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
