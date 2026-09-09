import { useState } from "react";
import {
	type CameraPrototypeSettings,
	type CameraPrototypeVariant,
	CameraSettingsPrototype,
	INITIAL_CAMERA_SETTINGS,
	PrototypeShell,
} from "./camera-settings-prototypes";
import "./camera-settings-break.css";

type Scenario = {
	label: string;
	width: number | "squeezed";
	variant: CameraPrototypeVariant;
	settings: CameraPrototypeSettings;
	disabled?: boolean;
};

const SCENARIOS: Scenario[] = [
	{
		label: "Spatial stage · real 416px sidebar · visible",
		width: 416,
		variant: "spatial",
		settings: INITIAL_CAMERA_SETTINGS,
	},
	{
		label: "Lens rack · 320px container · maximum treatment",
		width: 320,
		variant: "rack",
		settings: {
			...INITIAL_CAMERA_SETTINGS,
			size: 80,
			rounding: 100,
			shadow: 100,
			scaleDuringZoom: 1,
			backgroundBlur: "heavy",
		},
	},
	{
		label: "Director recipes · squeezed by preview sibling · hidden camera",
		width: "squeezed",
		variant: "recipes",
		settings: { ...INITIAL_CAMERA_SETTINGS, hide: true },
	},
	{
		label: "Spatial stage · very wide · custom position state",
		width: 680,
		variant: "spatial",
		settings: {
			...INITIAL_CAMERA_SETTINGS,
			manualPosition: { x: 0.43, y: 0.27 },
		},
	},
	{
		label: "Lens rack · disabled state",
		width: 416,
		variant: "rack",
		settings: INITIAL_CAMERA_SETTINGS,
		disabled: true,
	},
];

export default function CameraSettingsBreak() {
	return (
		<main className="camera-break-page">
			<header>
				<p>Camera inspector stress harness</p>
				<h1>Container pressure and component state</h1>
				<span>
					Tab through every fixture to check focus order and disabled behavior.
				</span>
			</header>
			<div className="camera-break-page__scenarios">
				{SCENARIOS.map((scenario) => (
					<ScenarioCard key={scenario.label} scenario={scenario} />
				))}
			</div>
		</main>
	);
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
	const [settings, setSettings] = useState(scenario.settings);
	const style =
		scenario.width === "squeezed" ? undefined : { width: scenario.width };

	return (
		<section
			className={
				scenario.width === "squeezed"
					? "camera-break-card camera-break-card--squeezed"
					: "camera-break-card"
			}
		>
			<p>{scenario.label}</p>
			<div className="camera-break-card__fixture" style={style}>
				<PrototypeShell>
					<CameraSettingsPrototype
						variant={scenario.variant}
						settings={settings}
						onChange={setSettings}
						disabled={scenario.disabled}
					/>
				</PrototypeShell>
			</div>
		</section>
	);
}
