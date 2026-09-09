import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./zoom-segment-settings-variants.css";

type VariantId = "guided" | "balanced" | "dense";
type FocusMode = "follow" | "fixed";
type MotionPreset = "push" | "left" | "right" | "tilt" | "lean" | "skew";

type ZoomSettings = {
	amount: number;
	focus: FocusMode;
	x: number;
	y: number;
	motion: MotionPreset;
};

const VARIANTS: Array<{ id: VariantId; label: string }> = [
	{ id: "guided", label: "Guided" },
	{ id: "balanced", label: "Balanced" },
	{ id: "dense", label: "Dense" },
];

const MOTION_OPTIONS: Array<{ id: MotionPreset; label: string }> = [
	{ id: "push", label: "Push in" },
	{ id: "left", label: "Drift left" },
	{ id: "right", label: "Drift right" },
	{ id: "tilt", label: "Tilt" },
	{ id: "lean", label: "Lean back" },
	{ id: "skew", label: "Skew" },
];

const INITIAL_SETTINGS: ZoomSettings = {
	amount: 2.5,
	focus: "follow",
	x: 0.5,
	y: 0.5,
	motion: "push",
};

export default function ZoomSegmentSettingsVariants() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [settings, setSettings] = useState(INITIAL_SETTINGS);
	const requested = searchParams.get("variant");
	const active: VariantId = VARIANTS.some((variant) => variant.id === requested)
		? (requested as VariantId)
		: "guided";

	const selectVariant = useCallback(
		(variant: VariantId) => {
			setSearchParams((current) => {
				const next = new URLSearchParams(current);
				next.set("variant", variant);
				return next;
			});
		},
		[setSearchParams],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				target?.matches("button, input, select, textarea")
			)
				return;

			const current = VARIANTS.findIndex((variant) => variant.id === active);
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				selectVariant(
					VARIANTS[(current - 1 + VARIANTS.length) % VARIANTS.length].id,
				);
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				selectVariant(VARIANTS[(current + 1) % VARIANTS.length].id);
			}
			if (event.key === "1" || event.key === "2" || event.key === "3") {
				selectVariant(VARIANTS[Number(event.key) - 1].id);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [active, selectVariant]);

	return (
		<main className="custom-scroll h-full overflow-y-auto bg-gray-2 p-6 pb-28 text-gray-12">
			<div className="mx-auto w-full max-w-104">
				<p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-gray-10">
					Zoom segment settings
				</p>
				{active === "guided" && (
					<GuidedVariant settings={settings} onChange={setSettings} />
				)}
				{active === "balanced" && (
					<BalancedVariant settings={settings} onChange={setSettings} />
				)}
				{active === "dense" && (
					<DenseVariant settings={settings} onChange={setSettings} />
				)}
			</div>

			<nav className="variant-picker" aria-label="Variants">
				{VARIANTS.map((variant) => (
					<button
						key={variant.id}
						type="button"
						aria-current={active === variant.id ? "true" : undefined}
						onClick={() => selectVariant(variant.id)}
					>
						{variant.label}
					</button>
				))}
			</nav>
		</main>
	);
}

function GuidedVariant({
	settings,
	onChange,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
}) {
	return (
		<Panel title="Zoom">
			<div className="flex flex-col gap-6">
				<RangeControl
					id="guided-amount"
					label="Zoom amount"
					value={settings.amount}
					min={1}
					max={4}
					step={0.1}
					format={(value) => `${value.toFixed(1)}×`}
					onChange={(amount) => onChange({ ...settings, amount })}
				/>
				<SettingsGroup
					title="Keep the action in frame"
					description="Follow the cursor, or hold a composition you choose."
				>
					<FocusChoices
						settings={settings}
						onChange={onChange}
						emphasis="cards"
					/>
				</SettingsGroup>
				<SettingsGroup
					title="Add movement"
					description="Choose the feel of the zoom while it is active."
				>
					<MotionChoices settings={settings} onChange={onChange} kind="cards" />
				</SettingsGroup>
				<details className="rounded-lg bg-gray-2 px-3 py-2 text-sm text-gray-11">
					<summary className="cursor-pointer font-medium text-gray-12">
						Fine tune the focus
					</summary>
					<div className="mt-4">
						<FocusPosition settings={settings} onChange={onChange} />
					</div>
				</details>
			</div>
		</Panel>
	);
}

function BalancedVariant({
	settings,
	onChange,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
}) {
	return (
		<Panel title="Zoom segment">
			<div className="flex flex-col gap-6">
				<RangeControl
					id="balanced-amount"
					label="Amount"
					value={settings.amount}
					min={1}
					max={4}
					step={0.1}
					format={(value) => `${value.toFixed(1)}×`}
					onChange={(amount) => onChange({ ...settings, amount })}
				/>
				<SettingsGroup title="Focus">
					<FocusChoices
						settings={settings}
						onChange={onChange}
						emphasis="rows"
					/>
					{settings.focus === "fixed" && (
						<div className="mt-4">
							<FocusPosition settings={settings} onChange={onChange} />
						</div>
					)}
				</SettingsGroup>
				<SettingsGroup title="Movement">
					<MotionChoices settings={settings} onChange={onChange} kind="chips" />
				</SettingsGroup>
			</div>
		</Panel>
	);
}

function DenseVariant({
	settings,
	onChange,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
}) {
	return (
		<Panel title="Zoom">
			<div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
				<RangeControl
					id="dense-amount"
					label="Amount"
					value={settings.amount}
					min={1}
					max={4}
					step={0.1}
					format={(value) => `${value.toFixed(1)}×`}
					onChange={(amount) => onChange({ ...settings, amount })}
				/>
				<fieldset className="rounded-lg bg-gray-2 p-3">
					<legend className="px-1 text-xs font-medium text-gray-12">
						Focus
					</legend>
					<div className="mt-2 flex gap-1">
						<ChoiceButton
							active={settings.focus === "follow"}
							onClick={() => onChange({ ...settings, focus: "follow" })}
						>
							Follow
						</ChoiceButton>
						<ChoiceButton
							active={settings.focus === "fixed"}
							onClick={() => onChange({ ...settings, focus: "fixed" })}
						>
							Fixed
						</ChoiceButton>
					</div>
				</fieldset>
			</div>
			{settings.focus === "fixed" && (
				<div className="mt-3">
					<FocusPosition settings={settings} onChange={onChange} compact />
				</div>
			)}
			<SettingsGroup title="Movement" className="mt-5">
				<MotionChoices settings={settings} onChange={onChange} kind="dense" />
			</SettingsGroup>
		</Panel>
	);
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
	const navigate = useNavigate();

	return (
		<section className="overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="flex h-16 items-center border-b border-gray-3 px-4">
				<h1 className="text-sm font-semibold text-gray-12">{title}</h1>
				<button
					type="button"
					onClick={() => navigate("/debug")}
					className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-gray-10 hover:bg-gray-3 hover:text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring"
				>
					Done
				</button>
			</div>
			<div className="p-4">{children}</div>
		</section>
	);
}

function SettingsGroup({
	title,
	description,
	className,
	children,
}: {
	title: string;
	description?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={className}>
			<h2 className="text-sm font-medium text-gray-12">{title}</h2>
			{description && (
				<p className="mt-1 text-xs text-gray-10">{description}</p>
			)}
			<div className="mt-3">{children}</div>
		</section>
	);
}

function RangeControl({
	id,
	label,
	value,
	min,
	max,
	step,
	format,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	format: (value: number) => string;
	onChange: (value: number) => void;
}) {
	return (
		<div className="rounded-lg bg-gray-2 p-3">
			<div className="mb-3 flex items-center justify-between gap-3">
				<label htmlFor={id} className="text-sm font-medium text-gray-12">
					{label}
				</label>
				<output
					htmlFor={id}
					className="font-mono text-xs tabular-nums text-gray-10"
				>
					{format(value)}
				</output>
			</div>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				className="w-full accent-gray-12"
			/>
		</div>
	);
}

function FocusChoices({
	settings,
	onChange,
	emphasis,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
	emphasis: "cards" | "rows";
}) {
	const card = emphasis === "cards";

	return (
		<div className={card ? "grid gap-2" : "flex flex-col gap-1"}>
			<FocusChoice
				active={settings.focus === "follow"}
				description={card ? "Frame the cursor automatically." : undefined}
				onClick={() => onChange({ ...settings, focus: "follow" })}
			>
				Follow cursor
			</FocusChoice>
			<FocusChoice
				active={settings.focus === "fixed"}
				description={card ? "Hold the composition in one place." : undefined}
				onClick={() => onChange({ ...settings, focus: "fixed" })}
			>
				Fixed focus
			</FocusChoice>
			{settings.focus === "fixed" && card && (
				<div className="pt-2">
					<FocusPosition settings={settings} onChange={onChange} />
				</div>
			)}
		</div>
	);
}

function FocusChoice({
	active,
	description,
	onClick,
	children,
}: {
	active: boolean;
	description?: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={
				active
					? "rounded-lg border border-gray-7 bg-gray-4 px-3 py-2 text-left text-sm font-medium text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring"
					: "rounded-lg border border-transparent bg-gray-2 px-3 py-2 text-left text-sm font-medium text-gray-11 hover:bg-gray-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring"
			}
		>
			<span className="block">{children}</span>
			{description && (
				<span className="mt-0.5 block text-xs font-normal">{description}</span>
			)}
		</button>
	);
}

function FocusPosition({
	settings,
	onChange,
	compact = false,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
	compact?: boolean;
}) {
	return (
		<div className={compact ? "grid grid-cols-2 gap-2" : "flex flex-col gap-3"}>
			<RangeControl
				id="focus-horizontal"
				label="Horizontal"
				value={settings.x}
				min={0}
				max={1}
				step={0.01}
				format={(value) => `${Math.round(value * 100)}%`}
				onChange={(x) => onChange({ ...settings, x })}
			/>
			<RangeControl
				id="focus-vertical"
				label="Vertical"
				value={settings.y}
				min={0}
				max={1}
				step={0.01}
				format={(value) => `${Math.round(value * 100)}%`}
				onChange={(y) => onChange({ ...settings, y })}
			/>
		</div>
	);
}

function MotionChoices({
	settings,
	onChange,
	kind,
}: {
	settings: ZoomSettings;
	onChange: (settings: ZoomSettings) => void;
	kind: "cards" | "chips" | "dense";
}) {
	const className =
		kind === "cards"
			? "grid grid-cols-2 gap-2"
			: kind === "dense"
				? "grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1.5"
				: "flex flex-wrap gap-1.5";

	return (
		<div className={className}>
			{MOTION_OPTIONS.map((option) => (
				<ChoiceButton
					key={option.id}
					active={settings.motion === option.id}
					onClick={() => onChange({ ...settings, motion: option.id })}
				>
					{option.label}
				</ChoiceButton>
			))}
		</div>
	);
}

function ChoiceButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={
				active
					? "min-h-9 rounded-md bg-gray-5 px-2 py-1 text-xs font-medium text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring"
					: "min-h-9 rounded-md bg-gray-3 px-2 py-1 text-xs font-medium text-gray-11 hover:bg-gray-4 hover:text-gray-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring"
			}
		>
			{children}
		</button>
	);
}
