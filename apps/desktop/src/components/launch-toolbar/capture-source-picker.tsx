import { Popover } from "@base-ui/react/popover";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import CheckIcon from "~icons/lucide/check";
import ChevronIcon from "~icons/lucide/chevron-down";
import CrosshairIcon from "~icons/lucide/crosshair";
import MonitorIcon from "~icons/lucide/monitor";
import WindowIcon from "~icons/lucide/panels-top-left";
import AreaIcon from "~icons/lucide/scan";
import SearchIcon from "~icons/lucide/search";
import CloseIcon from "~icons/lucide/x";
import type { LaunchToolbarState } from "./launch-toolbar";
import "./capture-source-picker.css";

type CaptureKind = LaunchToolbarState["target"];
type ListedKind = Exclude<CaptureKind, "area">;
type Source = { id: string; kind: ListedKind; name: string; detail: string };

const sources: Source[] = [
	{
		id: "display-main",
		kind: "display",
		name: "Built-in display",
		detail: "1920 × 1080 · Primary",
	},
	{
		id: "display-studio",
		kind: "display",
		name: "Studio display",
		detail: "2560 × 1440 · Extended",
	},
	{
		id: "window-browser",
		kind: "window",
		name: "Quero — Browser",
		detail: "Browser · 1440 × 900",
	},
	{
		id: "window-editor",
		kind: "window",
		name: "Project — Editor",
		detail: "Editor · 1280 × 800",
	},
	{
		id: "window-notes",
		kind: "window",
		name: "Launch notes",
		detail: "Notes · 960 × 720",
	},
];
const categories = [
	{ kind: "display", label: "Displays", icon: MonitorIcon },
	{ kind: "window", label: "Windows", icon: WindowIcon },
	{ kind: "area", label: "Area", icon: AreaIcon },
] as const;
const spring = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function CaptureTargetSelector({
	target,
	onChange,
	onPickerRequest,
	onTargetChoice,
}: {
	target: CaptureKind;
	onChange: (target: CaptureKind) => void;
	onPickerRequest?: (target: CaptureKind) => void;
	onTargetChoice?: (target: ListedKind, label: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [category, setCategory] = useState<CaptureKind>(target);
	const [query, setQuery] = useState("");
	const [selectedIds, setSelectedIds] = useState({
		display: "display-main",
		window: "window-browser",
	});
	const reducedMotion = useReducedMotion();
	const id = useId();
	const visibleSources = sources.filter(
		(source) =>
			source.kind === category &&
			`${source.name} ${source.detail}`
				.toLowerCase()
				.includes(query.trim().toLowerCase()),
	);
	const chooseCategory = (kind: CaptureKind) => {
		setCategory(kind);
		setQuery("");
	};
	const pickOnScreen = () => {
		onChange(category);
		onPickerRequest?.(category);
		setOpen(false);
	};
	return (
		<motion.div
			layout="position"
			transition={reducedMotion ? { duration: 0 } : spring}
			className="capture-source-control"
		>
			<Popover.Root
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setQuery("");
					}
				}}
			>
				<div
					className="capture-source-buttons"
					role="group"
					aria-label="Capture target"
				>
					{categories.map(({ kind, label, icon: Icon }) => {
						const selected = target === kind;
						const isListed = kind !== "area";
						return (
							<div
								key={kind}
								className={`capture-source-button${selected ? " is-selected" : ""}${open && category === kind ? " is-open" : ""}`}
							>
								<button
									type="button"
									className="capture-source-button-main"
									aria-label={`Pick ${label.toLowerCase()} on screen`}
									aria-pressed={selected}
									onClick={() => {
										onChange(kind);
										onPickerRequest?.(kind);
									}}
								>
									<Icon />
									<span>{label}</span>
								</button>
								{isListed && (
									<Popover.Trigger
										className="capture-source-button-menu"
										aria-label={`Browse ${label.toLowerCase()} targets`}
										onClick={() => {
											setCategory(kind);
											setQuery("");
										}}
									>
										<ChevronIcon />
									</Popover.Trigger>
								)}
							</div>
						);
					})}
				</div>
				<Popover.Portal>
					<Popover.Positioner
						sideOffset={12}
						align="center"
						collisionPadding={12}
						className="capture-source-positioner"
					>
						<Popover.Popup className="capture-source-panel">
							<div className="capture-source-heading">
								<div>
									<Popover.Title>What would you like to capture?</Popover.Title>
									<Popover.Description>
										Choose a source, or pick it on your screen.
									</Popover.Description>
								</div>
								<Popover.Close aria-label="Close capture sources">
									<CloseIcon />
								</Popover.Close>
							</div>
							<LayoutGroup id={id}>
								<div
									className="capture-source-categories"
									role="tablist"
									aria-label="Source type"
								>
									{categories.map(({ kind, label, icon: Icon }, index) => (
										<button
											key={kind}
											type="button"
											role="tab"
											aria-selected={category === kind}
											aria-controls={`${id}-panel`}
											id={`${id}-${kind}`}
											tabIndex={category === kind ? 0 : -1}
											onClick={() => chooseCategory(kind)}
											onKeyDown={(event) => {
												const nextIndex =
													event.key === "ArrowRight"
														? (index + 1) % 3
														: event.key === "ArrowLeft"
															? (index + 2) % 3
															: event.key === "Home"
																? 0
																: event.key === "End"
																	? 2
																	: -1;
												if (nextIndex < 0) return;
												event.preventDefault();
												chooseCategory(categories[nextIndex].kind);
												(
													event.currentTarget.parentElement?.children[
														nextIndex
													] as HTMLButtonElement | undefined
												)?.focus();
											}}
										>
											{category === kind && (
												<motion.span
													layoutId="source-tab"
													className="capture-source-tab-highlight"
													transition={reducedMotion ? { duration: 0 } : spring}
												/>
											)}
											<Icon />
											<span>{label}</span>
										</button>
									))}
								</div>
							</LayoutGroup>
							<div
								role="tabpanel"
								id={`${id}-panel`}
								aria-labelledby={`${id}-${category}`}
								className="capture-source-body"
							>
								{category !== "area" ? (
									<>
										<label className="capture-source-search">
											<SearchIcon />
											<input
												aria-label="Search capture sources"
												placeholder={
													category === "display"
														? "Find a display…"
														: "Find a window or app…"
												}
												value={query}
												onChange={(event) => setQuery(event.target.value)}
											/>
											{query && (
												<button
													type="button"
													aria-label="Clear source search"
													onClick={() => setQuery("")}
												>
													<CloseIcon />
												</button>
											)}
										</label>
										<div className="capture-source-list-heading">
											<span>
												{category === "display"
													? "Available displays"
													: "Open windows"}
											</span>
											<span>{visibleSources.length}</span>
										</div>
										<div className="capture-source-list">
											{visibleSources.map((source) => {
												const Icon =
													source.kind === "display" ? MonitorIcon : WindowIcon;
												const selected =
													target === source.kind &&
													selectedIds[source.kind] === source.id;
												return (
													<motion.button
														key={source.id}
														type="button"
														className="capture-source-option"
														aria-pressed={selected}
														whileTap={
															reducedMotion ? undefined : { scale: 0.96 }
														}
														transition={spring}
														onClick={() => {
															setSelectedIds({
																...selectedIds,
																[source.kind]: source.id,
															});
															onChange(source.kind);
															onTargetChoice?.(source.kind, source.name);
															setOpen(false);
														}}
													>
														<span className="capture-source-option-icon">
															<Icon />
														</span>
														<span className="capture-source-option-copy">
															<b>{source.name}</b>
															<small>{source.detail}</small>
														</span>
														<span className="capture-source-check">
															{selected && <CheckIcon />}
														</span>
													</motion.button>
												);
											})}
											{visibleSources.length === 0 && (
												<div className="capture-source-empty">
													<SearchIcon />
													<b>No sources match “{query}”</b>
													<span>Try a different name or choose on screen.</span>
												</div>
											)}
										</div>
									</>
								) : (
									<div className="capture-source-area">
										<div className="capture-source-region" aria-hidden="true">
											<AreaIcon />
										</div>
										<h3>Just the part you need.</h3>
										<p>
											Draw a region around anything on your screen. Everything
											outside stays out of the capture.
										</p>
									</div>
								)}
							</div>
							<div className="capture-source-footer">
								<button
									type="button"
									className="capture-source-pick"
									onClick={pickOnScreen}
								>
									<CrosshairIcon />
									<span>
										<b>
											{category === "area"
												? "Draw an area"
												: "Choose on screen"}
										</b>
										<small>
											{category === "area"
												? "Drag to define your capture region"
												: `Point at the ${category} you want to capture`}
										</small>
									</span>
									<span aria-hidden="true">↗</span>
								</button>
								<p>Sample sources · Preview only</p>
							</div>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</motion.div>
	);
}
