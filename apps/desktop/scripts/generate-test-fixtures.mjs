import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "tests", "fixtures", "generated");

function resolveFfmpegPath() {
  if (typeof ffmpegStatic === "string" && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with ${code}\n${stderr}`));
    });
  });
}

async function ensureFixture(fileName, args) {
  const outputPath = path.join(outputDir, fileName);
  if (existsSync(outputPath)) {
    return outputPath;
  }

  await runFfmpeg([...args, outputPath]);
  return outputPath;
}

await fs.mkdir(outputDir, { recursive: true });

const videoPath = await ensureFixture("editor-fixture.mp4", [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=30:duration=6",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000:duration=6",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-preset",
  "ultrafast",
  "-g",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-movflags",
  "+faststart",
]);

const audioPath = await ensureFixture("voiceover-fixture.wav", [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=3",
  "-c:a",
  "pcm_s16le",
]);

console.log(JSON.stringify({ videoPath, audioPath }, null, 2));
