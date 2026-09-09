import { cn } from "@quiro/ui";
import { type as osType } from "@tauri-apps/plugin-os";

// Cap's loading state: the real chrome, drawn as pulses, so the window has the
// editor's shape from the first paint rather than snapping into place when the
// instance finishes building.

const DEFAULT_TIMELINE_HEIGHT = 240;
const RESIZE_HANDLE_HEIGHT = 12;
const GRIP_MARKS = [0, 1, 2];
const SIDEBAR_TABS = [0, 1, 2, 3, 4];
const WALLPAPER_TILES = [0, 1, 2, 3, 4, 5, 6, 7];

function Pulse({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"animate-pulse rounded-sm bg-gray-3 dark:bg-gray-4",
				className,
			)}
		/>
	);
}

function PulseButton({ className }: { className?: string }) {
	return <Pulse className={cn("h-9 w-9 rounded-lg", className)} />;
}

function HeaderSkeleton() {
	return (
		<div
			data-tauri-drag-region
			className="relative flex h-14 w-full flex-row items-center"
		>
			<div
				data-tauri-drag-region
				className="flex h-full flex-1 flex-row items-center gap-2 px-4"
			>
				{osType() === "macos" && <div className="h-full w-16" />}
				<PulseButton />
				<PulseButton />
				<Pulse className="h-5 w-32" />
				<div data-tauri-drag-region className="h-full flex-1" />
			</div>

			<div
				data-tauri-drag-region
				className="flex flex-col justify-center border-x border-gray-3 px-4"
			>
				<Pulse className="h-9 w-28 rounded-lg" />
			</div>

			<div
				data-tauri-drag-region
				className="flex h-full flex-1 flex-row items-center gap-2 px-2"
			>
				<PulseButton />
				<PulseButton />
				<div data-tauri-drag-region className="h-full flex-1" />
				<Pulse className="h-[40px] w-[100px] rounded-xl" />
			</div>
		</div>
	);
}

function PlayerSkeleton() {
	return (
		<div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex items-center justify-between gap-3 p-3">
					<Pulse className="h-9 w-36 rounded-lg" />
					<div className="flex items-center gap-2">
						<Pulse className="h-4 w-24" />
						<Pulse className="h-9 w-32 rounded-lg" />
					</div>
				</div>

				<div className="relative flex flex-1 items-center justify-center p-4">
					<div className="flex aspect-video w-full max-w-[85%] items-center justify-center rounded-lg bg-gray-3 dark:bg-gray-4" />
				</div>

				<div className="z-10 flex flex-row items-center justify-between gap-3 overflow-hidden p-5">
					<div className="flex flex-1 items-center gap-1">
						<Pulse className="h-4 w-12" />
						<Pulse className="h-4 w-3" />
						<Pulse className="h-4 w-12" />
					</div>
					<div className="flex flex-row items-center justify-center gap-8">
						<Pulse className="size-3 rounded-sm" />
						<Pulse className="size-9 rounded-full" />
						<Pulse className="size-3 rounded-sm" />
					</div>
					<div className="flex flex-1 flex-row items-center justify-end gap-4">
						<PulseButton />
					</div>
				</div>
			</div>

			<div
				style={{ height: `${RESIZE_HANDLE_HEIGHT}px` }}
				className="flex shrink-0 flex-col items-center justify-center gap-0.5 border-t border-gray-4 bg-gray-2/95 dark:border-gray-5 dark:bg-gray-3/55"
			>
				{GRIP_MARKS.map((mark) => (
					<div
						key={mark}
						className="h-0.5 w-20 max-w-[85%] rounded-full bg-gray-6 dark:bg-gray-7"
					/>
				))}
			</div>
		</div>
	);
}

function SidebarSkeleton() {
	return (
		<div className="z-10 flex min-h-0 max-w-104 flex-1 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="sticky top-0 z-60 flex h-16 shrink-0 flex-row items-center justify-center gap-4 border-b border-gray-3 bg-gray-1 dark:bg-gray-2">
				{SIDEBAR_TABS.map((tab) => (
					<Pulse key={tab} className="size-9 rounded-lg" />
				))}
			</div>

			<div className="flex-1 space-y-4 overflow-hidden p-4">
				<Pulse className="h-4 w-20" />
				<Pulse className="h-9 w-full rounded-lg" />
				<div className="grid grid-cols-4 gap-2">
					{WALLPAPER_TILES.map((tile) => (
						<Pulse key={tile} className="aspect-video rounded-sm" />
					))}
				</div>
				<Pulse className="h-px w-full" />
				<Pulse className="h-4 w-16" />
				<Pulse className="h-8 w-full rounded-lg" />
			</div>
		</div>
	);
}

function TimelineSkeleton() {
	return (
		<div className="h-full overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="relative flex h-full flex-col gap-2 px-4 pt-8">
				<div className="relative flex h-[32px] items-end">
					<div className="flex w-full items-center gap-8 pl-10">
						{SIDEBAR_TABS.map((tick) => (
							<Pulse key={tick} className="h-3 w-8" />
						))}
					</div>
				</div>
				<div className="relative min-h-0 flex-1 space-y-2">
					{[0, 1].map((track) => (
						<div key={track} className="flex items-stretch gap-2">
							<Pulse className="h-13 w-8 rounded-lg" />
							<Pulse className="h-13 flex-1 rounded-xl" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function EditorSkeleton() {
	return (
		<div className="flex h-full min-h-0 max-h-full w-full flex-col overflow-hidden bg-gray-1">
			<HeaderSkeleton />

			<div
				data-tauri-drag-region
				className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-hidden leading-5"
			>
				<div className="flex min-h-0 basis-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 flex-1 flex-row gap-2 overflow-hidden px-2">
						<PlayerSkeleton />
						<SidebarSkeleton />
					</div>
					<div
						className="relative min-h-0 flex-none overflow-hidden px-2 pb-2"
						style={{ height: `${DEFAULT_TIMELINE_HEIGHT}px` }}
					>
						<TimelineSkeleton />
					</div>
				</div>
			</div>
		</div>
	);
}
