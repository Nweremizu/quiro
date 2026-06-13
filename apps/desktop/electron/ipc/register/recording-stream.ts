import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { getFfmpegBinaryPath } from "@electron/ipc/ffmpeg/binary";
import { getRecordingsDir } from "@electron/utils";
import { finalizeStoredVideo } from "../recording/mac";

const execFileAsync = promisify(execFile);

/**
 * Streamed recording persistence.
 *
 * The renderer used to buffer every MediaRecorder chunk, build one Blob,
 * call arrayBuffer() on it, and ship the whole recording across IPC in a
 * single message — a 30-minute capture peaked at several GB of renderer
 * memory at the exact moment the user pressed stop. These handlers let the
 * renderer append each timeslice chunk as it arrives, so memory stays flat
 * regardless of recording length.
 *
 * MediaRecorder WebM output has no duration header, so finalize remuxes the
 * file with ffmpeg (-c copy, no re-encode) which rebuilds the container with
 * duration and seek cues — the on-disk equivalent of fixWebmDuration.
 */
interface RecordingStreamSession {
  stream: WriteStream;
  partPath: string;
  finalPath: string;
  writeFailure: Error | null;
}

const recordingStreamSessions = new Map<string, RecordingStreamSession>();

async function removeSessionFiles(session: RecordingStreamSession) {
  await fs.rm(session.partPath, { force: true }).catch(() => undefined);
}

async function endSessionStream(session: RecordingStreamSession) {
  await new Promise<void>((resolve) => {
    session.stream.end(() => resolve());
  });
}

async function remuxToFixDuration(partPath: string, finalPath: string) {
  const ffmpegPath = getFfmpegBinaryPath();
  await execFileAsync(
    ffmpegPath,
    ["-y", "-hide_banner", "-loglevel", "error", "-i", partPath, "-c", "copy", finalPath],
    { windowsHide: true },
  );
}

export function cleanupRecordingStreamSessions() {
  for (const session of recordingStreamSessions.values()) {
    try {
      session.stream.destroy();
    } catch {
      // already closed
    }
    void removeSessionFiles(session);
  }
  recordingStreamSessions.clear();
}

export function registerRecordingStreamHandlers() {
  ipcMain.handle("recording-stream-begin", async (_event, fileName: string) => {
    try {
      const recordingsDir = await getRecordingsDir();
      const safeName = path.basename(String(fileName));
      const finalPath = path.join(recordingsDir, safeName);
      const partPath = `${finalPath}.part`;

      const stream = createWriteStream(partPath);
      const session: RecordingStreamSession = {
        stream,
        partPath,
        finalPath,
        writeFailure: null,
      };
      stream.on("error", (error) => {
        session.writeFailure = error;
      });

      const sessionId = randomUUID();
      recordingStreamSessions.set(sessionId, session);
      return { success: true, sessionId };
    } catch (error) {
      console.error("Failed to begin recording stream:", error);
      return { success: false, message: String(error) };
    }
  });

  ipcMain.handle(
    "recording-stream-append",
    async (_event, sessionId: string, chunk: ArrayBuffer) => {
      const session = recordingStreamSessions.get(sessionId);
      if (!session) {
        return { success: false, message: "Unknown recording stream session" };
      }
      if (session.writeFailure) {
        return { success: false, message: String(session.writeFailure) };
      }

      try {
        await new Promise<void>((resolve, reject) => {
          session.stream.write(Buffer.from(chunk), (error) =>
            error ? reject(error) : resolve(),
          );
        });
        return { success: true };
      } catch (error) {
        session.writeFailure =
          error instanceof Error ? error : new Error(String(error));
        return { success: false, message: String(error) };
      }
    },
  );

  ipcMain.handle(
    "recording-stream-finalize",
    async (_event, sessionId: string) => {
      const session = recordingStreamSessions.get(sessionId);
      recordingStreamSessions.delete(sessionId);
      if (!session) {
        return { success: false, message: "Unknown recording stream session" };
      }

      try {
        await endSessionStream(session);

        if (session.writeFailure) {
          await removeSessionFiles(session);
          return { success: false, message: String(session.writeFailure) };
        }

        try {
          await remuxToFixDuration(session.partPath, session.finalPath);
          await fs.rm(session.partPath, { force: true });
        } catch (remuxError) {
          // The raw stream is still a playable WebM (without a duration
          // header); keep the recording rather than discarding it.
          console.warn(
            "Recording remux failed, keeping raw stream output:",
            remuxError,
          );
          await fs.rename(session.partPath, session.finalPath);
        }

        return await finalizeStoredVideo(session.finalPath);
      } catch (error) {
        console.error("Failed to finalize recording stream:", error);
        await removeSessionFiles(session);
        return { success: false, message: String(error) };
      }
    },
  );

  ipcMain.handle(
    "recording-stream-abort",
    async (_event, sessionId: string) => {
      const session = recordingStreamSessions.get(sessionId);
      recordingStreamSessions.delete(sessionId);
      if (!session) {
        return { success: true };
      }

      try {
        session.stream.destroy();
      } catch {
        // already closed
      }
      await removeSessionFiles(session);
      return { success: true };
    },
  );
}
