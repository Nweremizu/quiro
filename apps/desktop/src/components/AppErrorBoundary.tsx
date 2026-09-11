import { Button, toast } from "@quiro/ui";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PropsWithChildren } from "react";
import { ErrorBoundary } from "react-error-boundary";
import ClipboardCopyIcon from "~icons/lucide/clipboard-copy";
import TriangleAlertIcon from "~icons/lucide/triangle-alert";

export function AppErrorBoundary({ children }: PropsWithChildren) {
	return (
		<ErrorBoundary
			onError={(error) => console.error(error)}
			fallbackRender={({ error }) => <Crashed error={error} />}
		>
			{children}
		</ErrorBoundary>
	);
}

function Crashed({ error }: { error: unknown }) {
	const err = error instanceof Error ? error : new Error(String(error));
	const trace = `${err.toString()}\n\n${err.stack ?? ""}`;

	const copyDetails = async () => {
		try {
			// Uses the Web Clipboard API, not the Tauri clipboard plugin: this
			// boundary must still work if the crash happened before Tauri's IPC
			// bridge finished initializing.
			await navigator.clipboard.writeText(trace);
			toast.success("Error details copied");
		} catch (error) {
			console.error("Failed to copy error details to clipboard:", error);
			toast.error("Couldn't copy to clipboard");
		}
	};

	return (
		<div className="flex h-screen max-h-screen w-full flex-col items-center justify-center gap-4 overflow-hidden bg-gray-1 px-8 text-center max-sm:gap-2">
			<div className="flex size-14 items-center justify-center rounded-full border border-red-6 bg-red-2 text-red-11 max-sm:size-12">
				<TriangleAlertIcon className="size-7 max-sm:size-6" />
			</div>
			<h1 className="text-2xl font-semibold text-gray-12 max-sm:text-xl">
				Quiro hit a snag
			</h1>
			<p className="max-w-sm text-sm text-gray-10">
				Something went wrong and the app couldn't recover. Reloading usually
				fixes it — copy the error details first if it keeps happening.
			</p>
			<div className="flex flex-row gap-3 max-sm:flex-col max-sm:gap-2">
				<Button
					variant="outline"
					icon={<ClipboardCopyIcon className="size-4" />}
					onClick={copyDetails}
				>
					Copy Error Details
				</Button>
				<Button variant="gray" onClick={() => location.reload()}>
					Reload Quiro
				</Button>
				<Button
					variant="destructive"
					onClick={() => getCurrentWebviewWindow().close()}
				>
					Close Window
				</Button>
			</div>
			{import.meta.env.DEV && (
				<pre className="mt-6 max-w-lg overflow-auto rounded-lg border border-gray-4 bg-gray-2 p-3 text-left text-xs text-gray-10">
					{`${err.toString()}\n\n${(err.stack ?? "").split("\n").slice(0, 10).join("\n")}`}
				</pre>
			)}
		</div>
	);
}
