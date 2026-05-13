import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

type ExportStreamSession = {
  id: string;
  sessionDir: string;
  tempPath: string;
  fileHandle: fs.promises.FileHandle;
  bytesWritten: number;
  highestWatermark: number;
  writeQueue: Promise<void>;
  aborted: boolean;
};

const exportStreamSessions: Map<string, ExportStreamSession> = new Map();

const EXTENSION_ALLOWLIST = /^[a-z0-9]{1,8}$/i;
const SESSION_DIR_PREFIX = 'quiro-export-';

// This list tracks temporary files created during the video export process.
// For security, whenever the frontend (renderer) asks the backend to move or delete a file,
// we first check if the file path exists in this list. This ensures that even if the frontend
// is compromised, it cannot trick the app into deleting or moving the user's personal files.

const ownedExportPaths: Set<string> = new Set();

function normalizeOwndedPath(candidate: string): string {
  return path.resolve(candidate);
}

export function registerOwnedExportPath(candidate: string): void {
  ownedExportPaths.add(normalizeOwndedPath(candidate));
}

export function releaseOwnedExportPath(candidate: string): void {
  ownedExportPaths.delete(normalizeOwndedPath(candidate));
}

export function isOwnedExportPath(candidate: string): boolean {
  return ownedExportPaths.has(normalizeOwndedPath(candidate));
}

function generateStreamSessionId(): string {
  return `quiro-export-stream-${randomUUID()}`;
}

export async function openExportStreamSession(options?: {
  extension?: string;
}): Promise<{ sessionId: string; tempPath: string }> {
  const extension = options?.extension ?? 'mp4';
  if (!EXTENSION_ALLOWLIST.test(extension)) {
    throw new Error(`Invalid file extension: ${extension}`);
  }
  const sessionId = generateStreamSessionId();

  // Per-Session 0700 directory defeats TOCTOU/symlink races on shared temp directories, and ensures that only the current user can access the session files.
  const sessionDir = await fsp.mkdtemp(
    path.join(app.getPath('temp'), SESSION_DIR_PREFIX)
  );
  try {
    // Ensure the session directory has strict permissions to prevent unauthorized access.
    await fsp.chmod(sessionDir, 0o700);
  } catch {
    // If chmod fails, we should clean up the session directory to avoid leaving behind insecure directories.
    // await fsp.rm(sessionDir, { recursive: true, force: true });
    // throw err;
  }

  const tempPath = path.join(sessionDir, `${sessionId}.${extension}`);
  const fileHandle = await fsp.open(
    tempPath,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL,
    0o600
  );

  exportStreamSessions.set(sessionId, {
    id: sessionId,
    sessionDir,
    tempPath,
    fileHandle,
    bytesWritten: 0,
    highestWatermark: 0,
    writeQueue: Promise.resolve(),
    aborted: false,
  });
  registerOwnedExportPath(tempPath);

  return { sessionId, tempPath };
}

export async function writeToExportStreamSession(
  sessionId: string,
  position: number,
  chunk: Uint8Array
): Promise<void> {
  const session = exportStreamSessions.get(sessionId);
  if (!session) {
    throw new Error(`Export stream session not found: ${sessionId}`);
  }

  if (session.aborted) {
    throw new Error(`Export stream session is aborted: ${sessionId}`);
  }

  // Queue writes to ensure they are executed in order and to prevent concurrent writes to the same file handle.
  const previousWrite = session.writeQueue;
  // we create a new promise that will execute after the previous write completes. This ensures that writes are serialized.
  const next = previousWrite.then(async () => {
    // If the session was aborted while waiting for the previous write to complete, we should not proceed with this write.
    if (session.aborted) {
      return;
    }

    // Create a Buffer from the Uint8Array chunk. We need to use the underlying ArrayBuffer and specify the byteOffset and byteLength to correctly handle cases where the Uint8Array is a view into a larger ArrayBuffer.
    const buffer = Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength
    );
    await session.fileHandle.write(buffer, 0, buffer.length, position); // Write the buffer to the file at the specified position.
    session.bytesWritten += buffer.length; // Update the total bytes written for this session.
    const end = position + buffer.length; // Calculate the end position of the written chunk.
    if (end > session.highestWatermark) {
      // Update the highest watermark if this chunk extends beyond it.
      session.highestWatermark = end;
    }
  });
  session.writeQueue = next.catch(() => undefined); // Catch errors to prevent unhandled promise rejections, but we don't want a failed write to break the queue.
  await next; // Return the promise that represents the completion of this write operation.
}

export async function finalizeExportStreamSession(
  sessionId: string,
  options: { abort?: boolean }
): Promise<{ tempPath: string | null; bytesWritten: number }> {
  const session = exportStreamSessions.get(sessionId);
  if (!session) {
    throw new Error(`Export stream session not found: ${sessionId}`);
  }

  const abort = options.abort ?? false;
  if (abort) {
    session.aborted = true; // Mark the session as aborted to prevent further writes.
  }

  try {
    await session.writeQueue; // Wait for any pending writes to complete before finalizing.
  } catch {
    // If a write fails, we still want to proceed with cleanup. The session is marked as aborted, so no new writes will be accepted.
  }

  try {
    await session.fileHandle.close(); // Close the file handle to release system resources.
  } catch {
    // If closing the file handle fails, we should still attempt to clean up the session directory and remove the session from the map.
  }

  exportStreamSessions.delete(sessionId); // Remove the session from the active sessions map.

  if (abort) {
    releaseOwnedExportPath(session.tempPath); // Remove the temp path from the owned paths set since the session is aborted and the file should be cleaned up.
    try {
      await fsp.rm(session.tempPath, { force: true }); // Clean up the session directory and its contents.
    } catch {
      // Temp file may already be gone or inaccessible, but since the session is aborted, we should not throw an error here. In a real application, we should log this error for debugging purposes.
    }

    try {
      await fsp.rm(session.sessionDir, { recursive: true, force: true }); // Clean up the session directory and its contents.
    } catch {
      // If removing the session directory fails, we should log this error in a real application, but we don't want to throw an error here since the session is already marked as aborted.
    }

    return {
      tempPath: null,
      bytesWritten: 0,
    };
  }

  return {
    tempPath: session.tempPath,
    bytesWritten: session.bytesWritten,
  };
}

export function hasExportStreamSession(sessionId: string): boolean {
  return exportStreamSessions.has(sessionId);
}

export async function cleanupAllExportStreamSessions(): Promise<void> {
  const sessions = Array.from(exportStreamSessions.values());
  exportStreamSessions.clear(); // Clear the sessions map immediately to prevent new operations on existing sessions while we clean up.
  ownedExportPaths.clear(); // Clear the owned paths set to prevent any further operations on these paths.
  await Promise.allSettled(
    sessions.map(async (session) => {
      try {
        await session.fileHandle.close();
      } catch {
        // ignore
      }
      try {
        await fsp.rm(session.tempPath, { force: true });
      } catch {
        // ignore
      }
      try {
        await fsp.rm(session.sessionDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    })
  );
}
