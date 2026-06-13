import { useEffect } from "react";
import { toast } from "sonner";
import { assessSystemHealth } from "@/lib/systemHealth";

/**
 * Warn once per session per issue so entering/leaving the editor or starting
 * several recordings doesn't repeat the same toast.
 */
const warnedIssues = new Set<string>();

/**
 * Runs the GPU/CPU health assessment and surfaces any problems to the user
 * as warning toasts. Non-blocking — callers should not await this before
 * starting their flow.
 */
export async function showSystemHealthWarnings(): Promise<void> {
  try {
    const { warnings } = await assessSystemHealth();
    for (const warning of warnings) {
      if (warnedIssues.has(warning.issue)) {
        continue;
      }
      warnedIssues.add(warning.issue);
      toast.warning(warning.title, {
        description: warning.detail,
        duration: 12000,
      });
    }
  } catch (error) {
    console.warn("System health check failed:", error);
  }
}

/**
 * Runs the health check once on mount. Use in performance-sensitive windows
 * (editor) so users are told up front when GPU acceleration is unavailable
 * or the CPU is already saturated.
 */
export function useSystemHealthWarning() {
  useEffect(() => {
    void showSystemHealthWarnings();
  }, []);
}
