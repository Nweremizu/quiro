import { commands } from "@/utils/tauri";

const activeCaptionGenerationIds = new Set<string>();

export function registerCaptionGeneration(jobId: string) {
	activeCaptionGenerationIds.add(jobId);
}

export function unregisterCaptionGeneration(jobId: string) {
	activeCaptionGenerationIds.delete(jobId);
}

export async function cancelActiveCaptionGenerations() {
	const jobIds = [...activeCaptionGenerationIds];
	activeCaptionGenerationIds.clear();
	await Promise.all(
		jobIds.map((jobId) => commands.cancelCaptionGeneration(jobId)),
	);
}
