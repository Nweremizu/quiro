import { cn } from "@quiro/ui";
import { type as osType } from "@tauri-apps/plugin-os";

// React port of Cap's `screenshot-editor-skeleton.tsx`, reshaped to Quiro's
// layout. Cap's skeleton draws one long toolbar across the top because that is
// where their controls live; Quiro's sit in a floating pill at the bottom, so
// mirroring Cap's shape here would flash the wrong layout and then jump.

function SkeletonPulse({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"animate-pulse rounded-sm bg-gray-3 dark:bg-gray-4",
				className,
			)}
		/>
	);
}

function SkeletonButton({ className }: { className?: string }) {
	return <SkeletonPulse className={cn("size-8 rounded-lg", className)} />;
}

// Named rather than counted, so each placeholder has a stable key and stands
// for the control that will replace it.
const TOOL_SLOTS = ["select", "arrow", "rectangle", "mask", "circle", "text"];
const FRAME_SLOTS = ["background", "padding", "rounding", "shadow", "border"];

export function ScreenshotEditorSkeleton() {
	// Matches Header: on macOS this row is the only chrome, so it reserves the
	// same space for the native traffic lights.
	const isMacOS = osType() === "macos";

	return (
		<div className="flex h-screen w-screen flex-col bg-gray-1">
			<div
				data-tauri-drag-region
				className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-gray-3 bg-gray-1 px-4"
			>
				{isMacOS && <div className="w-16 shrink-0" data-tauri-drag-region />}
				<SkeletonPulse className="h-3.5 w-40 rounded-full" />
				<div className="flex items-center gap-2">
					<SkeletonButton />
					<SkeletonButton />
					<SkeletonButton />
				</div>
			</div>

			<div className="relative min-h-0 flex-1 bg-gray-2">
				<div className="absolute inset-x-0 bottom-11 flex justify-center">
					<div className="flex items-center gap-1 rounded-2xl border border-gray-a5 bg-transparent-window p-1.5 shadow-xl backdrop-blur-xl">
						<SkeletonButton />
						<div className="mx-1 h-6 w-px bg-gray-4" />
						{TOOL_SLOTS.map((slot) => (
							<SkeletonButton key={slot} />
						))}
						<div className="mx-1 h-6 w-px bg-gray-4" />
						{FRAME_SLOTS.map((slot) => (
							<SkeletonButton key={slot} />
						))}
						<div className="mx-1 h-6 w-px bg-gray-4" />
						<SkeletonPulse className="h-8 w-32 rounded-lg" />
					</div>
				</div>
			</div>
		</div>
	);
}
