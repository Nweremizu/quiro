import { useQuery } from "@tanstack/react-query";
import { commands } from "@/utils/tauri";
import CrtFrame from "./CrtFrame";

// The display picker's hint: the same CRT, but with the whole screen shown as
// selected, plus which monitor this actually is. Without it the display
// overlay is just a dimmed screen with a border, which signals very little.

function formatResolution(size: { width: number; height: number } | null) {
	if (!size || size.width <= 0 || size.height <= 0) return null;
	return `${Math.round(size.width)} × ${Math.round(size.height)}`;
}

/** `refresh_rate` arrives as a string and is "0" on displays that don't report one. */
function formatRefreshRate(rate: string | null | undefined) {
	if (!rate) return null;
	const parsed = Number.parseFloat(rate);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return `${Math.round(parsed)} Hz`;
}

export default function DisplayHint({
	show,
	displayId,
	footer,
}: {
	show: boolean;
	displayId: string;
	/** The picker's confirm panel — needs pointer events the rest of this
	 * (deliberately click-through) hint doesn't. */
	footer: React.ReactNode;
}) {
	const info = useQuery({
		queryKey: ["displayInformation", displayId] as const,
		queryFn: async () => {
			const result = await commands.displayInformation(displayId);
			return result.status === "ok" ? result.data : null;
		},
		enabled: displayId !== "",
		// A monitor's identity doesn't change while the picker is open.
		staleTime: 5 * 60 * 1000,
	});

	if (!show) return null;

	const name = info.data?.name?.trim() || "This display";
	const meta = [
		formatResolution(info.data?.physical_size ?? null),
		formatRefreshRate(info.data?.refresh_rate),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-4">
			<div className="flex flex-col items-center gap-6 text-center">
				<CrtFrame>
					<div className="quiro-crt-hint__fullscreen" />
				</CrtFrame>

				<div className="flex flex-col items-center gap-1.5">
					<p className="max-w-md truncate font-sans text-2xl font-semibold text-white drop-shadow-lg">
						{name}
					</p>
					{meta && (
						<p className="font-sans text-lg font-medium tabular-nums text-white drop-shadow-lg">
							{meta}
						</p>
					)}
				</div>

				{footer}
			</div>
		</div>
	);
}
