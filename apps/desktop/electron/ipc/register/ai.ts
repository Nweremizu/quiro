import { ipcMain } from "electron";
import {
  hasApiKey,
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

export function registerAiHandlers() {
  ipcMain.handle(
    AI_COMPLETE,
    async (_event, request: AiCompleteRequestWire) => {
      try {
        return await runAiComplete(request);
      } catch (error) {
        console.error("ai:complete failed:", error);
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
    return { hasKey: hasApiKey() };
  });
}
