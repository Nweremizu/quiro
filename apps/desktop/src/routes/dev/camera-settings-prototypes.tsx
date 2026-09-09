import { type CSSProperties, type ReactNode, useId } from "react";
import "./camera-settings-prototypes.css";

export type CameraPrototypeVariant = "spatial" | "rack" | "recipes";

export type CameraPrototypeSettings = {
	hide: boolean;
	mirror: boolean;
	position: { x: "left" | "center" | "right"; y: "top" | "bottom" };
	manualPosition: { x: number; y: number } | null;
	size: number;
	rounding: number;
	shadow: number;
	shape: "square" | "source";
	scaleDuringZoom: number;
	backgroundBlur: "off" | "light" | "heavy";
};

export const INITIAL_CAMERA_SETTINGS: CameraPrototypeSettings = {
	hide: false,
	mirror: false,
	position: { x: "right", y: "bottom" },
	manualPosition: null,
	size: 34,
	rounding: 38,
	shadow: 42,
	shape: "source",
	scaleDuringZoom: 0.7,
	backgroundBlur: "light",
};

export const CAMERA_VARIANTS: Array<{
	id: CameraPrototypeVariant;
	label: string;
}> = [
	{ id: "spatial", label: "Spatial stage" },
	{ id: "rack", label: "Lens rack" },
	{ id: "recipes", label: "Director recipes" },
];

type CameraPrototypeProps = {
	variant: CameraPrototypeVariant;
	settings: CameraPrototypeSettings;
	onChange: (settings: CameraPrototypeSettings) => void;
	disabled?: boolean;
};

export function CameraSettingsPrototype(props: CameraPrototypeProps) {
	return (
		<section
			className={`camera-prototype camera-prototype--${props.variant}`}
			aria-label={`${CAMERA_VARIANTS.find((item) => item.id === props.variant)?.label} camera settings`}
		>
			{props.variant === "spatial" && <SpatialStage {...props} />}
			{props.variant === "rack" && <LensRack {...props} />}
			{props.variant === "recipes" && <DirectorRecipes {...props} />}
		</section>
	);
}

function SpatialStage({ settings, onChange, disabled }: CameraPrototypeProps) {
	const positions = [
		["left", "top"],
		["center", "top"],
		["right", "top"],
		["left", "bottom"],
		["center", "bottom"],
		["right", "bottom"],
	] as const;

	return (
		<fieldset disabled={disabled} className="camera-reset-fieldset">
			<PrototypeHeader
				eyebrow="Camera layer"
				title="Place yourself in the scene"
				description="Treat the canvas as the control. Fine details live one step below it."
				settings={settings}
				onChange={onChange}
			/>

			<div className="spatial-stage" aria-label="Camera position">
				<div className="spatial-stage__screen">
					<div className="spatial-stage__content">
						<span />
						<span />
						<span />
					</div>
					{positions.map(([x, y]) => {
						const active =
							!settings.manualPosition &&
							settings.position.x === x &&
							settings.position.y === y;
						return (
							<button
								key={`${x}-${y}`}
								type="button"
								className="spatial-stage__anchor"
								aria-label={`${y} ${x}`}
								aria-pressed={active}
								onClick={() =>
									onChange({
										...settings,
										position: { x, y },
										manualPosition: null,
									})
								}
							>
								<span
									className="spatial-stage__camera"
									style={
										{
											"--camera-rounding": `${settings.rounding}%`,
										} as CSSProperties
									}
								/>
							</button>
						);
					})}
				</div>
				<div className="spatial-stage__legend">
					<span>
						{settings.manualPosition
							? "Custom position"
							: `${settings.position.y} ${settings.position.x}`}
					</span>
					<span>{Math.round(settings.size)}% frame</span>
				</div>
			</div>

			<div className="spatial-shape-row" aria-label="Camera shape">
				<ShapeButton
					label="Natural"
					shape="source"
					active={settings.shape === "source"}
					onClick={() => onChange({ ...settings, shape: "source" })}
				/>
				<ShapeButton
					label="Square"
					shape="square"
					active={settings.shape === "square"}
					onClick={() => onChange({ ...settings, shape: "square" })}
				/>
				<ShapeButton
					label="Bubble"
					shape="bubble"
					active={settings.rounding >= 90}
					onClick={() => onChange({ ...settings, rounding: 100 })}
				/>
			</div>

			<div className="spatial-sliders">
				<PrototypeRange
					label="Presence"
					value={settings.size}
					min={10}
					max={80}
					suffix="%"
					onChange={(size) => onChange({ ...settings, size })}
				/>
				<PrototypeRange
					label="Softness"
					value={settings.rounding}
					min={0}
					max={100}
					suffix="%"
					onChange={(rounding) => onChange({ ...settings, rounding })}
				/>
				<PrototypeRange
					label="Lift"
					value={settings.shadow}
					min={0}
					max={100}
					suffix="%"
					onChange={(shadow) => onChange({ ...settings, shadow })}
				/>
			</div>

			<SpatialTreatment settings={settings} onChange={onChange} />
		</fieldset>
	);
}

function LensRack({ settings, onChange, disabled }: CameraPrototypeProps) {
	return (
		<fieldset disabled={disabled} className="camera-reset-fieldset rack-shell">
			<PrototypeHeader
				eyebrow="Live camera"
				title="Lens rack"
				description="A compact signal chain for people who tune by numbers."
				settings={settings}
				onChange={onChange}
			/>

			<div className="rack-meter" aria-hidden="true">
				<span />
				<span />
				<span />
				<span />
				<span />
				<span />
			</div>

			<div className="rack-position">
				<div>
					<p className="rack-label">Dock</p>
					<p className="rack-readout">
						{settings.position.x.slice(0, 1).toUpperCase()} ·{" "}
						{settings.position.y === "top" ? "T" : "B"}
					</p>
				</div>
				<div className="rack-position__pad" aria-label="Camera dock">
					{(["left", "center", "right"] as const).map((x) =>
						(["top", "bottom"] as const).map((y) => (
							<button
								key={`${x}-${y}`}
								type="button"
								aria-label={`${y} ${x}`}
								aria-pressed={
									settings.position.x === x && settings.position.y === y
								}
								onClick={() =>
									onChange({
										...settings,
										position: { x, y },
										manualPosition: null,
									})
								}
							/>
						)),
					)}
				</div>
			</div>

			<div className="rack-channels">
				<RackChannel
					code="SIZ"
					label="Size"
					value={settings.size}
					min={10}
					max={80}
					onChange={(size) => onChange({ ...settings, size })}
				/>
				<RackChannel
					code="RAD"
					label="Radius"
					value={settings.rounding}
					min={0}
					max={100}
					onChange={(rounding) => onChange({ ...settings, rounding })}
				/>
				<RackChannel
					code="LFT"
					label="Shadow"
					value={settings.shadow}
					min={0}
					max={100}
					onChange={(shadow) => onChange({ ...settings, shadow })}
				/>
				<RackChannel
					code="ZOM"
					label="In zoom"
					value={settings.scaleDuringZoom * 100}
					min={30}
					max={100}
					onChange={(value) =>
						onChange({ ...settings, scaleDuringZoom: value / 100 })
					}
				/>
			</div>

			<div className="rack-switchboard">
				<RackChoice
					label="Aspect"
					value={settings.shape === "source" ? "Native" : "1:1"}
					onClick={() =>
						onChange({
							...settings,
							shape: settings.shape === "source" ? "square" : "source",
						})
					}
				/>
				<RackChoice
					label="Backdrop"
					value={
						settings.backgroundBlur === "off"
							? "Clear"
							: settings.backgroundBlur
					}
					onClick={() =>
						onChange({
							...settings,
							backgroundBlur: nextBlur(settings.backgroundBlur),
						})
					}
				/>
			</div>
		</fieldset>
	);
}

type RecipeId = "commentary" | "portrait" | "reaction" | "quiet";

const RECIPES: Array<{ id: RecipeId; title: string; note: string }> = [
	{ id: "commentary", title: "Commentary", note: "Confident corner presence" },
	{ id: "portrait", title: "Portrait", note: "Soft, elevated and focused" },
	{ id: "reaction", title: "Reaction", note: "Large circular cutout" },
	{ id: "quiet", title: "Quiet guide", note: "Small and unobtrusive" },
];

function DirectorRecipes({
	settings,
	onChange,
	disabled,
}: CameraPrototypeProps) {
	const applyRecipe = (recipe: RecipeId) => {
		const next: Record<RecipeId, Partial<CameraPrototypeSettings>> = {
			commentary: {
				size: 34,
				rounding: 24,
				shadow: 46,
				shape: "source",
				backgroundBlur: "light",
			},
			portrait: {
				size: 40,
				rounding: 42,
				shadow: 64,
				shape: "source",
				backgroundBlur: "heavy",
			},
			reaction: {
				size: 46,
				rounding: 100,
				shadow: 54,
				shape: "square",
				backgroundBlur: "light",
			},
			quiet: {
				size: 20,
				rounding: 28,
				shadow: 18,
				shape: "source",
				backgroundBlur: "off",
			},
		};
		onChange({ ...settings, ...next[recipe] });
	};

	return (
		<fieldset
			disabled={disabled}
			className="camera-reset-fieldset recipes-shell"
		>
			<PrototypeHeader
				eyebrow="Direction"
				title="How should you appear?"
				description="Start from an editorial intention, then tune only what matters."
				settings={settings}
				onChange={onChange}
			/>

			<div className="recipe-list">
				{RECIPES.map((recipe, index) => (
					<button
						key={recipe.id}
						type="button"
						className="recipe-card"
						onClick={() => applyRecipe(recipe.id)}
					>
						<span
							className={`recipe-card__portrait recipe-card__portrait--${recipe.id}`}
							aria-hidden="true"
						/>
						<span className="recipe-card__copy">
							<strong>{recipe.title}</strong>
							<small>{recipe.note}</small>
						</span>
						<span className="recipe-card__number">0{index + 1}</span>
					</button>
				))}
			</div>

			<details className="recipe-details" open>
				<summary>Refine the direction</summary>
				<div className="recipe-details__body">
					<PrototypeRange
						label="Screen presence"
						value={settings.size}
						min={10}
						max={80}
						suffix="%"
						onChange={(size) => onChange({ ...settings, size })}
					/>
					<PrototypeRange
						label="Edge character"
						value={settings.rounding}
						min={0}
						max={100}
						suffix="%"
						onChange={(rounding) => onChange({ ...settings, rounding })}
					/>
					<PrototypeRange
						label="Separation"
						value={settings.shadow}
						min={0}
						max={100}
						suffix="%"
						onChange={(shadow) => onChange({ ...settings, shadow })}
					/>
					<PrototypeRange
						label="Presence during zoom"
						value={settings.scaleDuringZoom * 100}
						min={30}
						max={100}
						suffix="%"
						onChange={(value) =>
							onChange({ ...settings, scaleDuringZoom: value / 100 })
						}
					/>
				</div>
			</details>

			<div className="recipe-footer">
				<label>
					<span>Position</span>
					<select
						value={`${settings.position.y}-${settings.position.x}`}
						onChange={(event) => {
							const [y, x] = event.target.value.split("-") as [
								"top" | "bottom",
								"left" | "center" | "right",
							];
							onChange({
								...settings,
								position: { x, y },
								manualPosition: null,
							});
						}}
					>
						<option value="top-left">Top left</option>
						<option value="top-right">Top right</option>
						<option value="bottom-left">Bottom left</option>
						<option value="bottom-right">Bottom right</option>
					</select>
				</label>
				<label>
					<span>Frame</span>
					<select
						value={settings.shape}
						onChange={(event) =>
							onChange({
								...settings,
								shape: event.target.value as CameraPrototypeSettings["shape"],
							})
						}
					>
						<option value="source">Natural</option>
						<option value="square">Square</option>
					</select>
				</label>
				<label>
					<span>Backdrop</span>
					<select
						value={settings.backgroundBlur}
						onChange={(event) =>
							onChange({
								...settings,
								backgroundBlur: event.target
									.value as CameraPrototypeSettings["backgroundBlur"],
							})
						}
					>
						<option value="off">Natural</option>
						<option value="light">Soft</option>
						<option value="heavy">Studio</option>
					</select>
				</label>
			</div>
		</fieldset>
	);
}

function PrototypeHeader({
	eyebrow,
	title,
	description,
	settings,
	onChange,
}: {
	eyebrow: string;
	title: string;
	description: string;
	settings: CameraPrototypeSettings;
	onChange: (settings: CameraPrototypeSettings) => void;
}) {
	return (
		<header className="camera-prototype__header">
			<div>
				<p className="camera-prototype__eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				<p className="camera-prototype__description">{description}</p>
			</div>
			<div className="camera-prototype__quick-actions">
				<ToggleButton
					label="Mirror"
					active={settings.mirror}
					onClick={() => onChange({ ...settings, mirror: !settings.mirror })}
				/>
				<ToggleButton
					label={settings.hide ? "Show" : "Hide"}
					active={settings.hide}
					onClick={() => onChange({ ...settings, hide: !settings.hide })}
				/>
			</div>
		</header>
	);
}

function SpatialTreatment({
	settings,
	onChange,
}: Pick<CameraPrototypeProps, "settings" | "onChange">) {
	return (
		<div className="spatial-treatment">
			<div>
				<p>When the screen zooms</p>
				<strong>
					{Math.round(settings.scaleDuringZoom * 100)}% camera size
				</strong>
			</div>
			<input
				aria-label="Camera size during zoom"
				type="range"
				min="30"
				max="100"
				step="5"
				value={settings.scaleDuringZoom * 100}
				onChange={(event) =>
					onChange({
						...settings,
						scaleDuringZoom: Number(event.target.value) / 100,
					})
				}
			/>
			<div className="spatial-blur-options" aria-label="Background blur">
				{(["off", "light", "heavy"] as const).map((blur) => (
					<button
						key={blur}
						type="button"
						aria-pressed={settings.backgroundBlur === blur}
						onClick={() => onChange({ ...settings, backgroundBlur: blur })}
					>
						{blur}
					</button>
				))}
			</div>
		</div>
	);
}

function PrototypeRange({
	label,
	value,
	min,
	max,
	suffix,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	suffix: string;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<label className="prototype-range" htmlFor={id}>
			<span>{label}</span>
			<output htmlFor={id}>
				{Math.round(value)}
				{suffix}
			</output>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		</label>
	);
}

function ShapeButton({
	label,
	shape,
	active,
	onClick,
}: {
	label: string;
	shape: "source" | "square" | "bubble";
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="spatial-shape"
			aria-pressed={active}
			onClick={onClick}
		>
			<span className={`spatial-shape__icon spatial-shape__icon--${shape}`} />
			{label}
		</button>
	);
}

function ToggleButton({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="prototype-toggle"
			aria-pressed={active}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

function RackChannel({
	code,
	label,
	value,
	min,
	max,
	onChange,
}: {
	code: string;
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
}) {
	const id = useId();
	return (
		<label className="rack-channel" htmlFor={id}>
			<span className="rack-channel__code">{code}</span>
			<output htmlFor={id}>{Math.round(value)}</output>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<span className="rack-channel__label">{label}</span>
		</label>
	);
}

function RackChoice({
	label,
	value,
	onClick,
}: {
	label: string;
	value: string;
	onClick: () => void;
}) {
	return (
		<button type="button" className="rack-choice" onClick={onClick}>
			<span>{label}</span>
			<strong>{value}</strong>
		</button>
	);
}

function nextBlur(
	current: CameraPrototypeSettings["backgroundBlur"],
): CameraPrototypeSettings["backgroundBlur"] {
	if (current === "off") return "light";
	if (current === "light") return "heavy";
	return "off";
}

export function PrototypeShell({ children }: { children: ReactNode }) {
	return <div className="camera-prototype-shell">{children}</div>;
}
