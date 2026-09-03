import { useEffect, useMemo, useRef, useState } from "react";
import { CameraPanel, MicrophonePanel } from "@/components/DeviceMenu";
import type { CameraWithDetails, MicrophoneWithDetails } from "@/utils/devices";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import type {
	CameraDeviceSettings,
	CaptureDisplayWithThumbnail,
	CaptureWindowWithThumbnail,
	DeviceOrModelID,
	MicrophoneDeviceSettings,
	OSPermissionsCheck,
} from "@/utils/tauri";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideImport from "~icons/lucide/import";
import IconLucideSearch from "~icons/lucide/search";
import TargetMenuGrid from "./TargetMenuGrid";

function matchesQuery(value: string | null | undefined, query: string) {
	return !!value && value.toLowerCase().includes(query);
}

type CaptureSourcePanelProps =
	| {
			variant: "display";
			targets?: CaptureDisplayWithThumbnail[];
			onSelect: (target: CaptureDisplayWithThumbnail) => void;
	  }
	| {
			variant: "window";
			targets?: CaptureWindowWithThumbnail[];
			onSelect: (target: CaptureWindowWithThumbnail) => void;
	  }
	| {
			variant: "recording";
			targets?: RecordingWithPath[];
			onSelect: (target: RecordingWithPath) => void;
			onViewAll?: () => void;
			onRefetch?: () => void;
	  }
	| {
			variant: "screenshot";
			targets?: ScreenshotWithPath[];
			onSelect: (target: ScreenshotWithPath) => void;
			onViewAll?: () => void;
	  }
	| {
			variant: "camera";
			targets?: CameraWithDetails[];
			selectedId: DeviceOrModelID | null;
			onSelect: (id: DeviceOrModelID | null) => void;
			permissions?: OSPermissionsCheck;
			cameraDeviceSettings: Record<string, CameraDeviceSettings>;
			onCameraSettingsChange: (
				camera: CameraWithDetails,
				settings: CameraDeviceSettings,
			) => void;
			initialSettingsTarget?: CameraWithDetails | null;
	  }
	| {
			variant: "microphone";
			targets?: MicrophoneWithDetails[];
			selectedName: string | null;
			onSelect: (name: string | null) => void;
			permissions?: OSPermissionsCheck;
			microphoneDeviceSettings: Record<string, MicrophoneDeviceSettings>;
			onMicrophoneSettingsChange: (
				name: string,
				settings: MicrophoneDeviceSettings,
			) => void;
			initialSettingsTarget?: MicrophoneWithDetails | null;
	  };

type SharedCaptureSourcePanelProps = {
	isLoading: boolean;
	errorMessage?: string;
	disabled: boolean;
	onBack: () => void;
	onImport?: () => void;
};

const PLACEHOLDER_BY_VARIANT: Record<
	CaptureSourcePanelProps["variant"],
	string
> = {
	display: "Search displays",
	window: "Search windows",
	recording: "Search recordings",
	screenshot: "Search screenshots",
	camera: "Search cameras",
	microphone: "Search microphones",
};

const NO_RESULTS_BY_VARIANT: Record<
	CaptureSourcePanelProps["variant"],
	string
> = {
	display: "No matching displays",
	window: "No matching windows",
	recording: "No matching recordings",
	screenshot: "No matching screenshots",
	camera: "No matching cameras",
	microphone: "No matching microphones",
};

export default function CaptureSourcePanel(
	props: CaptureSourcePanelProps & SharedCaptureSourcePanelProps,
) {
	const [search, setSearch] = useState("");
	const trimmedSearch = search.trim();
	const normalizedQuery = trimmedSearch.toLowerCase();
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	const placeholder = PLACEHOLDER_BY_VARIANT[props.variant];
	const noResultsMessage = NO_RESULTS_BY_VARIANT[props.variant];

	const filteredDisplayTargets = useMemo<CaptureDisplayWithThumbnail[]>(() => {
		if (props.variant !== "display") return [];
		const targets = props.targets ?? [];
		if (!normalizedQuery) return targets;
		return targets.filter(
			(target) =>
				matchesQuery(target.name, normalizedQuery) ||
				matchesQuery(target.id, normalizedQuery),
		);
	}, [props.variant, props.targets, normalizedQuery]);

	const filteredWindowTargets = useMemo<CaptureWindowWithThumbnail[]>(() => {
		if (props.variant !== "window") return [];
		const targets = props.targets ?? [];
		if (!normalizedQuery) return targets;
		return targets.filter(
			(target) =>
				matchesQuery(target.name, normalizedQuery) ||
				matchesQuery(target.owner_name, normalizedQuery) ||
				matchesQuery(target.id, normalizedQuery),
		);
	}, [props.variant, props.targets, normalizedQuery]);

	const filteredRecordingTargets = useMemo<RecordingWithPath[]>(() => {
		if (props.variant !== "recording") return [];
		const targets = props.targets ?? [];
		if (!normalizedQuery) return targets;
		return targets.filter((target) =>
			matchesQuery(target.prettyName, normalizedQuery),
		);
	}, [props.variant, props.targets, normalizedQuery]);

	const filteredScreenshotTargets = useMemo<ScreenshotWithPath[]>(() => {
		if (props.variant !== "screenshot") return [];
		const targets = props.targets ?? [];
		if (!normalizedQuery) return targets;
		return targets.filter((target) =>
			matchesQuery(target.prettyName, normalizedQuery),
		);
	}, [props.variant, props.targets, normalizedQuery]);

	// Recordings/screenshots refetch periodically (see queries.ts); without
	// this, a mid-scroll refetch that reorders the list yanks the scroll
	// position back to the top out from under the user.
	const savedScrollTopRef = useRef(0);
	const restoringScrollRef = useRef(false);
	const preservesScroll =
		props.variant === "recording" || props.variant === "screenshot";

	// biome-ignore lint/correctness/useExhaustiveDependencies: search is intentionally the trigger here, not a value read in the body.
	useEffect(() => {
		savedScrollTopRef.current = 0;
	}, [search]);

	useEffect(() => {
		if (!preservesScroll) return;
		const container = scrollContainerRef.current;
		if (!container) return;

		const onScroll = () => {
			if (!restoringScrollRef.current) {
				savedScrollTopRef.current = container.scrollTop;
			}
		};
		container.addEventListener("scroll", onScroll, { passive: true });

		const observer = new MutationObserver(() => {
			if (
				savedScrollTopRef.current > 0 &&
				Math.abs(container.scrollTop - savedScrollTopRef.current) > 1
			) {
				restoringScrollRef.current = true;
				container.scrollTop = savedScrollTopRef.current;
				requestAnimationFrame(() => {
					restoringScrollRef.current = false;
				});
			}
		});
		observer.observe(container, { childList: true, subtree: true });

		return () => {
			container.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [preservesScroll]);

	const renderBody = () => {
		switch (props.variant) {
			case "display":
				return (
					<TargetMenuGrid
						variant="display"
						targets={filteredDisplayTargets}
						isLoading={props.isLoading}
						errorMessage={props.errorMessage}
						onSelect={props.onSelect}
						disabled={props.disabled}
						highlightQuery={trimmedSearch}
						emptyMessage={trimmedSearch ? noResultsMessage : undefined}
					/>
				);
			case "window":
				return (
					<TargetMenuGrid
						variant="window"
						targets={filteredWindowTargets}
						isLoading={props.isLoading}
						errorMessage={props.errorMessage}
						onSelect={props.onSelect}
						disabled={props.disabled}
						highlightQuery={trimmedSearch}
						emptyMessage={trimmedSearch ? noResultsMessage : undefined}
					/>
				);
			case "recording":
				return (
					<TargetMenuGrid
						variant="recording"
						targets={filteredRecordingTargets}
						isLoading={props.isLoading}
						errorMessage={props.errorMessage}
						onSelect={props.onSelect}
						disabled={props.disabled}
						highlightQuery={trimmedSearch}
						emptyMessage={trimmedSearch ? noResultsMessage : undefined}
						onRefetch={props.onRefetch}
						onViewAll={props.onViewAll}
					/>
				);
			case "screenshot":
				return (
					<TargetMenuGrid
						variant="screenshot"
						targets={filteredScreenshotTargets}
						isLoading={props.isLoading}
						errorMessage={props.errorMessage}
						onSelect={props.onSelect}
						disabled={props.disabled}
						highlightQuery={trimmedSearch}
						emptyMessage={trimmedSearch ? noResultsMessage : undefined}
						onViewAll={props.onViewAll}
					/>
				);
			case "camera":
				return (
					<CameraPanel
						cameras={props.targets ?? []}
						isLoading={props.isLoading}
						selectedId={props.selectedId}
						onSelect={props.onSelect}
						cameraDeviceSettings={props.cameraDeviceSettings}
						onSettingsChange={props.onCameraSettingsChange}
						permissions={props.permissions}
						onBack={props.onBack}
						searchQuery={search}
						showHeader={false}
						initialExpandedId={props.initialSettingsTarget?.device_id ?? null}
					/>
				);
			case "microphone":
				return (
					<MicrophonePanel
						microphones={props.targets ?? []}
						isLoading={props.isLoading}
						selectedName={props.selectedName}
						onSelect={props.onSelect}
						microphoneDeviceSettings={props.microphoneDeviceSettings}
						onSettingsChange={props.onMicrophoneSettingsChange}
						permissions={props.permissions}
						onBack={props.onBack}
						searchQuery={search}
						showHeader={false}
						initialExpandedId={props.initialSettingsTarget?.name ?? null}
					/>
				);
		}
	};

	return (
		<div className="flex flex-col w-full h-full min-h-0">
			<div className="flex gap-3 items-center mt-3 min-h-9">
				<button
					type="button"
					onClick={props.onBack}
					className="flex h-9 gap-1 items-center shrink-0 rounded-md px-2 text-xs text-gray-11 transition-colors hover:text-gray-12 hover:bg-gray-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1"
					aria-label="Back"
				>
					<IconLucideArrowLeft className="size-3 text-gray-11" />
					<span className="font-medium text-gray-12">Back</span>
				</button>
				<div className="flex gap-2 flex-1 min-w-0">
					<div className="relative flex-1 min-w-0 h-[36px] flex items-center">
						<IconLucideSearch className="absolute left-2 top-[48%] -translate-y-1/2 pointer-events-none size-3 text-gray-10" />
						<input
							type="search"
							className="py-2 pl-6 h-full w-full rounded-lg bg-gray-2 hover:ring-1 hover:ring-gray-5 font-normal placeholder:text-gray-9 text-xs caret-gray-10 transition-shadow duration-200 focus:ring-offset-1 focus:bg-gray-3 focus:ring-offset-gray-1 focus:ring-1 focus:ring-gray-10 pr-2 outline-hidden text-gray-12"
							value={search}
							onChange={(event) => setSearch(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape" && search) {
									event.preventDefault();
									setSearch("");
								}
							}}
							placeholder={placeholder}
							autoCapitalize="off"
							autoCorrect="off"
							autoComplete="off"
							spellCheck={false}
							aria-label={placeholder}
						/>
					</div>
					{(props.variant === "recording" || props.variant === "screenshot") &&
						props.onImport && (
							<button
								type="button"
								onClick={props.onImport}
								className="h-9 px-3 shrink-0 flex items-center gap-1.5 rounded-lg bg-gray-3 text-xs font-medium text-gray-12 hover:bg-gray-4 transition-colors"
							>
								<IconLucideImport className="size-3.5" />
								<span>
									{props.variant === "screenshot" ? "Import image" : "Import"}
								</span>
							</button>
						)}
				</div>
			</div>
			<div className="flex flex-col flex-1 min-h-0 pt-4">
				<div
					ref={scrollContainerRef}
					className="px-2 custom-scroll flex-1 overflow-y-auto"
					style={{ overflowAnchor: "none" }}
				>
					{renderBody()}
				</div>
			</div>
		</div>
	);
}
