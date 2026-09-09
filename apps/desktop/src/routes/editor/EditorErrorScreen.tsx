import { Button } from "@quiro/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import IconLucideTriangleAlert from "~icons/lucide/triangle-alert";

// Cap's error screen: a recording that can't be opened is usually a missing or
// half-written file, so the screen names the failure and offers the two things
// that actually help — look at the files, or close the window.

export function EditorErrorScreen({
	error,
	path,
}: {
	error: string;
	path?: string;
}) {
	return (
		<div className="flex h-full min-h-0 max-h-full w-full flex-col items-center justify-center gap-4 overflow-hidden bg-gray-1 px-8">
			<div className="flex size-12 items-center justify-center rounded-full bg-red-3 text-red-9">
				<IconLucideTriangleAlert className="size-6" />
			</div>

			<div className="flex flex-col items-center gap-1 text-center">
				<h1 className="text-sm font-medium text-gray-12">
					This recording couldn't be opened
				</h1>
				<p role="alert" className="max-w-md text-pretty text-xs text-gray-10">
					{error}
				</p>
			</div>

			<div className="flex items-center gap-2">
				{path && (
					<Button
						variant="gray"
						onClick={() => void revealItemInDir(`${path}/`)}
					>
						Open recording folder
					</Button>
				)}
				<Button onClick={() => void getCurrentWindow().close()}>Close</Button>
			</div>
		</div>
	);
}
