import { toast } from "sonner";

export async function openExternalLink(url: string, errorMessage: string) {
  try {
    const result = await window.electronAPI.openExternalUrl(url);
    if (!result.success) {
      toast.error(result.error || errorMessage);
    }
  } catch (error) {
    toast.error(`${errorMessage} ${String(error)}`);
  }
}
