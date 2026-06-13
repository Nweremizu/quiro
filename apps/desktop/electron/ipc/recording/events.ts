import { BrowserWindow } from 'electron';

/**
 * Emits a 'recording-interrupted' event to all renderer windows with the given reason and message.
 * The renderer can use this information to inform the user about why their recording was interrupted, and potentially offer options to recover or retry.
 * @param reason A short string code representing the reason for the interruption (e.g., 'disk-full', 'permission-lost', 'unexpected-error').
 * @param message A more detailed message that can be displayed to the user or logged for debugging purposes.
 * This function should be called whenever a recording is interrupted due to an error or system event that prevents it from continuing. The renderer can then handle this event to update the UI accordingly.
 * Note: This function assumes that the main process is responsible for detecting recording interruptions and that the renderer processes are listening for the 'recording-interrupted' event to update their state/UI.
 * Example usage:
 * emitRecordingInterrupted('disk-full', 'Recording stopped because the disk is full. Please free up some space and try again.');
 */

export function emitRecordingInterrupted(reason: string, message: string) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('recording-interrupted', { reason, message });
    }
  });
}
