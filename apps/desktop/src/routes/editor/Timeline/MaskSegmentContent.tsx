import { cn } from "@quiro/ui";
import type { ComponentType } from "react";
import type { MaskMode, MaskSegment } from "@/utils/tauri";
import IconPhApertureFill from "~icons/ph/aperture-fill";
import IconPhCirclesThreePlusFill from "~icons/ph/circles-three-plus-fill";
import IconPhEyeSlashFill from "~icons/ph/eye-slash-fill";
import IconPhGridFourFill from "~icons/ph/grid-four-fill";
import IconPhShieldCheckFill from "~icons/ph/shield-check-fill";
import IconPhSparkleFill from "~icons/ph/sparkle-fill";

const MODE_DETAILS: Record<
	MaskMode,
	{ label: string; icon: ComponentType<{ className?: string }> }
> = {
	blur: { label: "Blur", icon: IconPhCirclesThreePlusFill },
	pixelate: { label: "Pixelate", icon: IconPhGridFourFill },
	redact: { label: "Redact", icon: IconPhShieldCheckFill },
	spotlight: { label: "Spotlight", icon: IconPhApertureFill },
};

export function MaskSegmentContent({
	segment,
	width,
}: {
	segment: MaskSegment;
	width: number;
}) {
	const mode = segment.mode ?? "blur";
	const details = MODE_DETAILS[mode];
	const Icon = details.icon;
	const enabled = segment.enabled ?? true;
	const animated = mode === "spotlight" && (segment.fadeDuration ?? 0.2) > 0;

	return (
		<div
			className={cn(
				"flex min-w-0 items-center justify-center gap-1.5 overflow-hidden text-[var(--track-label)]",
				!enabled && "opacity-50",
			)}
		>
			<span className="shrink-0" title={details.label}>
				<Icon className="size-4" />
			</span>
			{width >= 64 && (
				<span className="truncate text-[0.625rem] font-semibold">
					{details.label}
				</span>
			)}
			{animated && width >= 96 && (
				<span
					className="shrink-0"
					title={`${(segment.fadeDuration ?? 0.2).toFixed(2)} second fade`}
				>
					<IconPhSparkleFill className="size-3.5" />
				</span>
			)}
			{!enabled && width >= 96 && (
				<span className="shrink-0" title="Disabled">
					<IconPhEyeSlashFill className="size-3.5" />
				</span>
			)}
		</div>
	);
}
