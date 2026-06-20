import { ipcMain } from "electron";
import {
  getKeyStatus,
  runAiComplete,
  type AiCompleteRequestWire,
} from "../../ai/client";

/**
 * AI (Quiro Director) IPC — Sprint 0, task S0-2.
 *
 * Channel names mirror `AI_IPC` in `src/lib/ai/contract.ts`. Keep in sync with
 * both `electron-env.d.ts` files and `preload.ts`.
 */
const AI_COMPLETE = "ai:complete";
const AI_GET_KEY_STATUS = "ai:get-key-status";

function streamAiText(event: Electron.IpcMainInvokeEvent, requestId: string, text: string) {
  let cursor = 0;
  const chunkSize = 24;
  while (cursor < text.length) {
    const next = Math.min(text.length, cursor + chunkSize);
    const chunk = text.slice(cursor, next);
    event.sender.send("ai:stream-event", {
      type: "delta",
      requestId,
      text: chunk,
    });
    cursor = next;
  }
}

export function registerAiHandlers() {
  ipcMain.handle(
    AI_COMPLETE,
    async (event, request: AiCompleteRequestWire) => {
      try {
        const result = await runAiComplete(request);
        if (request.stream) {
          for (const block of result.content) {
            if (block.type === "text" && typeof block.text === "string") {
              streamAiText(event, request.requestId, block.text);
            }
          }
          event.sender.send("ai:stream-event", {
            type: "done",
            requestId: request.requestId,
            result,
          });
        }
        return result;
      } catch (error) {
        console.error("ai:complete failed:", error);
        if (request.stream) {
          event.sender.send("ai:stream-event", {
            type: "error",
            requestId: request.requestId,
            message: String(error),
          });
        }
        return {
          requestId: request?.requestId ?? "",
          stopReason: "error",
          content: [
            { type: "text", text: `ai:complete failed: ${String(error)}` },
          ],
        };
      }
    },
  );

  ipcMain.handle(AI_GET_KEY_STATUS, async () => {
    return getKeyStatus();
  });
}
