import { useState } from "react";
import { ZoomSegmentSettings } from "@/routes/editor/SegmentConfig";
import type { ZoomSegment } from "@/utils/tauri";

type Scenario = {
	label: string;
	width: number;
	segment: ZoomSegment;
};

const SCENARIOS: Scenario[] = [
	{
		label: "Follow cursor · 1.0×",
		width: 416,
		segment: {
			start: 12,
			end: 18,
			amount: 1,
			mode: "auto",
			motion: {},
		},
	},
	{
		label: "Manual focus · centre · 2.5×",
		width: 416,
		segment: {
			start: 24,
			end: 36,
			amount: 2.5,
			mode: { manual: { x: 0.5, y: 0.5 } },
			motion: { offsetX: -0.08, tiltY: 12 },
		},
	},
	{
		label: "Manual focus · top-right · 4.0× · maximum movement",
		width: 416,
		segment: {
			start: 42,
			end: 48,
			amount: 4,
			mode: { manual: { x: 1, y: 0 } },
			motion: {
				offsetX: 0.5,
				offsetY: -0.5,
				rotation: 45,
				tiltX: -45,
				tiltY: 45,
				spin: -45,
			},
		},
	},
	{
		label: "Manual focus · bottom-left · 320px sidebar",
		width: 320,
		segment: {
			start: 54,
			end: 66,
			amount: 3.2,
			mode: { manual: { x: 0, y: 1 } },
			motion: { spin: 45 },
		},
	},
];

export default function ZoomSegmentSettingsBreak() {
	return (
		<main className="custom-scroll h-full overflow-y-auto p-6 text-gray-12">
			<h1 className="text-xl font-semibold">Zoom segment settings break</h1>
			<p className="mt-1 text-sm text-gray-10">
				Each fixture is interactive and uses the production settings component.
			</p>
			<div className="mt-6 flex flex-col gap-8">
				{SCENARIOS.map((scenario) => (
					<ScenarioCard key={scenario.label} scenario={scenario} />
				))}
			</div>
		</main>
	);
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
	const [segment, setSegment] = useState(scenario.segment);

	return (
		<section>
			<p className="mb-2 text-sm text-gray-11">{scenario.label}</p>
			<div
				className="h-144 overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2"
				style={{ width: scenario.width }}
			>
				<ZoomSegmentSettings
					segment={segment}
					onChange={(patch) =>
						setSegment((current) => ({ ...current, ...patch }))
					}
					onDone={() => undefined}
				/>
			</div>
		</section>
	);
}
