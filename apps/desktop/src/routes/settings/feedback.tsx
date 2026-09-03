import { Button, toast } from "@quiro/ui";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { commands } from "@/utils/tauri";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideTriangleAlert from "~icons/lucide/triangle-alert";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

// Cap posts feedback to its web API and uploads logs to its own servers. Quiro
// has neither a backend nor a configured git remote, so this page splits into
// the two halves that work without infrastructure: feedback opens the user's
// mail client with the report pre-filled, and diagnostics stay entirely local —
// displayed, copyable, with a button to reveal the log folder.
const FEEDBACK_EMAIL = "bnweremizu@gmail.com";

function diagnosticsToText(
	groups: Awaited<ReturnType<typeof commands.getSystemDiagnostics>>,
) {
	return groups
		.map((group) => {
			const rows = group.entries
				.map((e) => `  ${e.label}: ${e.value}`)
				.join("\n");
			return `${group.title}\n${rows}`;
		})
		.join("\n\n");
}

export default function FeedbackSettings() {
	const [message, setMessage] = useState("");

	const diagnostics = useQuery({
		queryKey: ["system-diagnostics"],
		queryFn: () => commands.getSystemDiagnostics(),
	});

	const logsDir = useQuery({
		queryKey: ["logs-dir"],
		queryFn: async () => {
			const result = await commands.getLogsDir();
			if (result.status === "error") throw new Error(result.error);
			return result.data;
		},
	});

	const trimmed = message.trim();

	const handleSend = async () => {
		if (!trimmed) return;

		// The version and platform are the two things every bug report needs and
		// nobody remembers to include, so they go in the body automatically. The
		// full diagnostics dump is deliberately NOT auto-attached — it's long,
		// and the user should choose to send it.
		const version = await getVersion().catch(() => "unknown");
		const subject = `Quiro feedback (v${version})`;
		const body = [
			trimmed,
			"",
			"---",
			`Version: ${version}`,
			`Platform: ${navigator.userAgent}`,
		].join("\n");

		const href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
			subject,
		)}&body=${encodeURIComponent(body)}`;

		try {
			await openUrl(href);
		} catch (error) {
			console.error("Failed to open mail client:", error);
			toast.error("Couldn't open your mail client");
		}
	};

	const handleCopyDiagnostics = async () => {
		if (!diagnostics.data) return;
		try {
			await writeText(diagnosticsToText(diagnostics.data));
			toast.success("Diagnostics copied to clipboard");
		} catch (error) {
			console.error("Failed to copy diagnostics:", error);
			toast.error("Failed to copy diagnostics");
		}
	};

	const handleRevealLogs = async () => {
		if (!logsDir.data) return;
		try {
			await revealItemInDir(logsDir.data);
		} catch (error) {
			console.error("Failed to reveal logs folder:", error);
			toast.error("Couldn't open the logs folder");
		}
	};

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<SettingsPageContent>
				<Section
					title="Send feedback"
					description="Opens your mail client with the message and your app version filled in."
				>
					<SectionCard padded>
						<textarea
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							rows={5}
							placeholder="What's working, what isn't, what you wish it did…"
							className="w-full resize-y rounded-lg border border-gray-5 bg-gray-1 px-3 py-2 text-[13px] text-gray-12 outline-none placeholder:text-gray-9 focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
						/>
						<div className="mt-3 flex items-center justify-between gap-3">
							<p className="text-xs text-gray-10">Goes to {FEEDBACK_EMAIL}</p>
							<Button
								variant="accent"
								size="sm"
								disabled={!trimmed}
								onClick={() => void handleSend()}
							>
								Compose email
							</Button>
						</div>
					</SectionCard>
				</Section>

				<Section
					title="Diagnostics"
					description="What Quiro sees on this machine. Copy this into a bug report — it answers most of the questions a recording problem raises."
					right={
						<Button
							variant="gray"
							size="sm"
							disabled={!diagnostics.data}
							onClick={() => void handleCopyDiagnostics()}
							className="flex items-center gap-1.5"
						>
							<IconLucideCopy className="size-3.5" />
							Copy all
						</Button>
					}
				>
					{diagnostics.isPending && (
						<SectionCard padded>
							<div className="space-y-2" aria-hidden="true">
								<div className="h-3 w-48 animate-pulse rounded-full bg-gray-4" />
								<div className="h-3 w-64 animate-pulse rounded-full bg-gray-4" />
							</div>
						</SectionCard>
					)}

					{diagnostics.isError && (
						<SectionCard padded>
							<p className="text-[13px] text-gray-12">
								Couldn't collect diagnostics.
							</p>
							<p className="mt-1 text-xs text-gray-10">
								{String(diagnostics.error)}
							</p>
						</SectionCard>
					)}

					{diagnostics.data && (
						<div className="space-y-3">
							{diagnostics.data.map((group) => (
								<SectionCard
									key={group.title}
									className="divide-y divide-gray-3"
								>
									<p className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-10">
										{group.title}
									</p>
									{group.entries.map((item) => (
										<div
											key={`${group.title}-${item.label}`}
											className="flex items-start justify-between gap-4 px-4 py-2.5"
										>
											<p className="min-w-0 shrink-0 text-[13px] text-gray-11">
												{item.label}
											</p>
											<p
												className={
													item.warning
														? "flex min-w-0 items-center gap-1.5 text-right text-[13px] font-medium text-red-10"
														: "min-w-0 text-right text-[13px] text-gray-12"
												}
											>
												{item.warning && (
													<IconLucideTriangleAlert className="size-3.5 shrink-0" />
												)}
												<span className="break-words">{item.value}</span>
											</p>
										</div>
									))}
								</SectionCard>
							))}
						</div>
					)}
				</Section>

				<Section
					title="Logs"
					description="Quiro writes a log file for every session. If something crashed, this is what to attach."
				>
					<SectionCard padded>
						<div className="flex items-center justify-between gap-3">
							<p className="min-w-0 flex-1 truncate text-xs text-gray-11">
								{logsDir.data ?? "Loading…"}
							</p>
							<Button
								variant="dark"
								size="sm"
								disabled={!logsDir.data}
								onClick={() => void handleRevealLogs()}
								className="flex shrink-0 items-center gap-1.5"
							>
								<IconLucideFolder className="size-3.5" />
								Reveal
							</Button>
						</div>
					</SectionCard>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
