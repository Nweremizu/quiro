import { LayoutGroup } from "motion/react";
import { useState } from "react";
import CheckIcon from "~icons/lucide/check";
import ChevronIcon from "~icons/lucide/chevron-down";
import MonitorIcon from "~icons/lucide/monitor";
import WindowIcon from "~icons/lucide/panels-top-left";
import AreaIcon from "~icons/lucide/scan";
import "./capture-target-variants.css";

type TargetKind = "display" | "window" | "area";
type Variant = {
	id: string;
	name: string;
	note: string;
	className: string;
	recommended?: boolean;
};
const kinds: { value: TargetKind; label: string; Icon: typeof MonitorIcon }[] =
	[
		{ value: "display", label: "Display", Icon: MonitorIcon },
		{ value: "window", label: "Window", Icon: WindowIcon },
		{ value: "area", label: "Area", Icon: AreaIcon },
	];
const variants: Variant[] = [
	{
		id: "tiles",
		name: "Icon tiles",
		note: "Quiet labels, strong glyphs",
		className: "is-tiles",
		recommended: true,
	},
	{
		id: "tiles-soft",
		name: "Soft tiles",
		note: "Larger glyphs, quieter chrome",
		className: "is-tiles-soft",
	},
	{
		id: "tiles-outline",
		name: "Outline tiles",
		note: "Airy borders keep it light",
		className: "is-tiles-outline",
	},
	{
		id: "tiles-vertical",
		name: "Vertical tiles",
		note: "Tall targets with clear rhythm",
		className: "is-tiles-vertical",
	},
	{
		id: "tiles-notch",
		name: "Notched tiles",
		note: "Chevron tucks into the corner",
		className: "is-tiles-notch",
	},
	{
		id: "tiles-contrast",
		name: "Contrast tiles",
		note: "High signal for fast scanning",
		className: "is-tiles-contrast",
	},
	{
		id: "rail",
		name: "Glyph rail",
		note: "One compact segmented line",
		className: "is-rail",
	},
	{
		id: "halo",
		name: "Halo buttons",
		note: "Selection floats around the icon",
		className: "is-halo",
	},
	{
		id: "stack",
		name: "Micro stack",
		note: "Tiny caption anchors the glyph",
		className: "is-stack",
	},
	{
		id: "dock",
		name: "Icon dock",
		note: "A shared selection capsule",
		className: "is-dock",
	},
	{
		id: "split",
		name: "Split glyphs",
		note: "Separate picker and list affordances",
		className: "is-split",
	},
	{
		id: "cards",
		name: "Floating cards",
		note: "Soft depth for three sources",
		className: "is-cards",
	},
	{
		id: "ring",
		name: "Focus ring",
		note: "Minimal, keyboard-friendly",
		className: "is-ring",
	},
];

export function CaptureTargetVariants() {
	const [selected, setSelected] = useState<Record<string, TargetKind>>({});
	const [open, setOpen] = useState<string | null>(null);
	return (
		<div className="capture-target-variants">
			{variants.map((variant) => {
				const value = selected[variant.id] ?? "display";
				return (
					<article
						key={variant.id}
						className={`capture-target-variant ${variant.className} ${variant.recommended ? "is-recommended" : ""}`}
					>
						<div className="capture-target-variant-heading">
							<div>
								<span>
									{String(variants.indexOf(variant) + 1).padStart(2, "0")}
								</span>
								<h3>{variant.name}</h3>
							</div>
							{variant.recommended && (
								<span className="capture-target-variant-badge">
									Selected direction
								</span>
							)}
							<p>{variant.note}</p>
						</div>
						<LayoutGroup id={`target-variant-${variant.id}`}>
							<div className="capture-target-variant-stage">
								{kinds.map(({ value: kind, label, Icon }) => (
									<div
										key={kind}
										className={`capture-target-variant-button ${value === kind ? "is-selected" : ""}`}
									>
										<button
											type="button"
											aria-label={`${label} picker`}
											aria-pressed={value === kind}
											onClick={() => {
												setSelected({ ...selected, [variant.id]: kind });
												setOpen(null);
											}}
										>
											<Icon />
											<span>{label}</span>
										</button>
										{kind !== "area" && (
											<button
												type="button"
												className="capture-target-variant-chevron"
												aria-label={`${label} target list`}
												aria-expanded={open === `${variant.id}-${kind}`}
												onClick={() =>
													setOpen(
														open === `${variant.id}-${kind}`
															? null
															: `${variant.id}-${kind}`,
													)
												}
											>
												<ChevronIcon />
											</button>
										)}
										{open === `${variant.id}-${kind}` && (
											<div className="capture-target-variant-menu">
												<button
													type="button"
													onClick={() => {
														setSelected({ ...selected, [variant.id]: kind });
														setOpen(null);
													}}
												>
													<span>
														{kind === "display"
															? "Built-in display"
															: "Quero — Browser"}
													</span>
													<CheckIcon />
												</button>
												<button type="button" onClick={() => setOpen(null)}>
													<span>
														{kind === "display"
															? "Studio display"
															: "Project — Editor"}
													</span>
												</button>
											</div>
										)}
									</div>
								))}
							</div>
						</LayoutGroup>
						<div className="capture-target-variant-caption">
							<span>Primary action picks on screen</span>
							<span>⌄ browses sources</span>
						</div>
					</article>
				);
			})}
		</div>
	);
}
