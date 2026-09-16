import { useState } from "react";
import { CaptureTargetVariants } from "../../components/launch-toolbar/capture-target-variants";
import {
	CaptureModeSwitch,
	CaptureTargetSelector,
	initialLaunchToolbarState,
	LaunchToolbar,
	type LaunchToolbarState,
} from "../../components/launch-toolbar/launch-toolbar";
import { LaunchToolbar as IntegratedToolbar } from "../launch/toolbar";
import "./launch-toolbar-preview.css";

function IntegratedToolbarExample({
	state,
	setState,
	playgroundAction,
	setPlaygroundAction,
}: {
	state: LaunchToolbarState;
	setState: (state: LaunchToolbarState) => void;
	playgroundAction: string;
	setPlaygroundAction: (action: string) => void;
}) {
	const [moreOpen, setMoreOpen] = useState(false);
	return (
		<>
			<IntegratedToolbar
				recording={state.mode === "recording"}
				targetMode={state.target}
				microphone={state.microphone}
				microphoneLabel={
					state.microphone ? "Studio USB Microphone" : "No microphone selected"
				}
				systemAudio={state.systemAudio}
				camera={false}
				cameraLabel="No webcam selected"
				moreOpen={moreOpen}
				panel={null}
				panelKey={null}
				onMode={(recording) =>
					setState({
						...state,
						mode: recording ? "recording" : "screenshot",
					})
				}
				onTarget={(target) => {
					setState({ ...state, target });
					setPlaygroundAction(`${target} picker requested`);
				}}
				onBrowse={(target) =>
					setPlaygroundAction(`${target} target list requested`)
				}
				onMicrophone={() =>
					setState({ ...state, microphone: !state.microphone })
				}
				onCamera={() => setPlaygroundAction("Webcam toggle requested")}
				onSystemAudio={() =>
					setState({ ...state, systemAudio: !state.systemAudio })
				}
				onMore={() => setMoreOpen((open) => !open)}
				onMinimize={() => setPlaygroundAction("Hide launch window requested")}
				onClose={() => setPlaygroundAction("Close launch window requested")}
			/>
			<p role="status" className="mt-3 text-xs text-gray-11">
				{playgroundAction} · Preview only
			</p>
		</>
	);
}

function ToolbarExample({ mode }: { mode: LaunchToolbarState["mode"] }) {
	const [state, setState] = useState({ ...initialLaunchToolbarState, mode });
	const [action, setAction] = useState("");
	return (
		<div className="ltp-example">
			<div className="ltp-example-label">
				<span>
					{mode === "screenshot" ? "01 / Screenshot" : "02 / Recording"}
				</span>
				<span>
					{state.mode === "screenshot" ? "Image capture" : "Video + audio"}
				</span>
			</div>
			<div className="ltp-example-toolbar">
				<LaunchToolbar
					state={state}
					onChange={setState}
					onAction={(next) => setAction(`${next} preview selected`)}
					onPickerRequest={(target) =>
						setAction(`${target} on-screen picker requested`)
					}
					onTargetChoice={(_, label) => setAction(`${label} selected`)}
				/>
			</div>
			<span className="ltp-example-status" role="status">
				{action || "Interactive · local state only"}
			</span>
		</div>
	);
}

export default function LaunchToolbarPreview() {
	const [state, setState] = useState<LaunchToolbarState>({
		...initialLaunchToolbarState,
		mode: "recording",
	});
	const [surface, setSurface] = useState("light");
	const [windowState, setWindowState] = useState("open");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [playgroundAction, setPlaygroundAction] = useState("Ready to explore");
	const reset = () => {
		setState({ ...initialLaunchToolbarState, mode: "recording" });
		setWindowState("open");
		setSettingsOpen(false);
		setPlaygroundAction("Ready to explore");
	};
	return (
		<main className="ltp-page">
			<header className="ltp-header">
				<a href="/debug/launch-toolbar" className="ltp-brand">
					<span>q</span> quiro <b>/ design lab</b>
				</a>
				<span className="ltp-badge">
					<i /> Isolated preview
				</span>
			</header>
			<section className="ltp-intro">
				<p className="ltp-eyebrow">LAUNCH WINDOW / EXPLORATION 01</p>
				<h1>
					A little space.
					<br />
					<em>Everything you need.</em>
				</h1>
				<p>
					A compact home for every capture. Explore the toolbar, its building
					blocks, and the states in between.
				</p>
			</section>
			<section aria-labelledby="variants-heading">
				<div className="mb-8 overflow-hidden rounded-2xl border border-gray-5 bg-gray-1 p-3">
					<h2 className="mb-3 text-sm font-semibold text-gray-12">
						Selected launch window · Icon tiles
					</h2>
					<IntegratedToolbarExample
						state={state}
						setState={setState}
						playgroundAction={playgroundAction}
						setPlaygroundAction={setPlaygroundAction}
					/>
				</div>
				<div className="ltp-section-heading">
					<h2 id="variants-heading">The two essentials</h2>
					<span>01 — Variants</span>
				</div>
				<div className="ltp-variants">
					<ToolbarExample mode="screenshot" />
					<ToolbarExample mode="recording" />
				</div>
			</section>
			<section aria-labelledby="playground-heading" className="ltp-playground">
				<div className="ltp-section-heading">
					<h2 id="playground-heading">Make it your own</h2>
					<span>02 — State playground</span>
				</div>
				<div className="ltp-workbench">
					<div className={`ltp-canvas ltp-canvas-${surface}`}>
						<div className="ltp-canvas-top">
							<span>LIVE PREVIEW</span>
							<div role="group" aria-label="Preview background">
								{["light", "dark", "warm"].map((value) => (
									<button
										type="button"
										key={value}
										aria-pressed={surface === value}
										onClick={() => setSurface(value)}
									>
										{value}
									</button>
								))}
							</div>
						</div>
						<div
							className={`ltp-live-toolbar ${windowState === "expanded" ? "ltp-expanded" : ""}`}
						>
							{windowState === "closed" || windowState === "minimized" ? (
								<button
									type="button"
									className="ltp-restore"
									onClick={() => setWindowState("open")}
								>
									Toolbar {windowState} · Restore preview
								</button>
							) : (
								<LaunchToolbar
									state={state}
									onChange={setState}
									onPickerRequest={(target) =>
										setPlaygroundAction(`${target} on-screen picker requested`)
									}
									onTargetChoice={(_, label) =>
										setPlaygroundAction(`${label} selected`)
									}
									onAction={(action) => {
										if (action === "settings") setSettingsOpen(!settingsOpen);
										else
											setWindowState(
												action === "expand"
													? windowState === "expanded"
														? "open"
														: "expanded"
													: action === "close"
														? "closed"
														: "minimized",
											);
									}}
								/>
							)}
						</div>
						<p className="ltp-canvas-caption">
							{state.mode === "screenshot" ? "Screenshot" : "Recording"} /{" "}
							{state.target} /{" "}
							{state.delay ? `${state.delay}s delay` : "No delay"}
						</p>
					</div>
					<aside className="ltp-controls">
						<div className="ltp-controls-heading">
							<h3>{settingsOpen ? "Preview settings" : "Toolbar state"}</h3>
							<button type="button" onClick={reset}>
								Reset
							</button>
						</div>
						<label>
							Capture mode
							<select
								value={state.mode}
								onChange={(event) =>
									setState({
										...state,
										mode:
											event.target.value === "recording"
												? "recording"
												: "screenshot",
									})
								}
							>
								<option value="screenshot">Screenshot</option>
								<option value="recording">Recording</option>
							</select>
						</label>
						<label>
							Capture target
							<select
								value={state.target}
								onChange={(event) =>
									setState({
										...state,
										target:
											event.target.value === "window"
												? "window"
												: event.target.value === "area"
													? "area"
													: "display",
									})
								}
							>
								<option value="display">Display</option>
								<option value="window">Window</option>
								<option value="area">Area</option>
							</select>
						</label>
						<label>
							Capture delay
							<select
								value={state.delay}
								onChange={(event) => {
									const delay = Number(event.target.value);
									setState({
										...state,
										delay:
											delay === 3 || delay === 5 || delay === 10 ? delay : 0,
									});
								}}
							>
								<option value="0">Off</option>
								<option value="3">3 seconds</option>
								<option value="5">5 seconds</option>
								<option value="10">10 seconds</option>
							</select>
						</label>
						<label className="ltp-toggle">
							Microphone
							<input
								type="checkbox"
								disabled={state.mode === "screenshot"}
								checked={state.microphone}
								onChange={(event) =>
									setState({ ...state, microphone: event.target.checked })
								}
							/>
						</label>
						<label className="ltp-toggle">
							System audio
							<input
								type="checkbox"
								disabled={state.mode === "screenshot"}
								checked={state.systemAudio}
								onChange={(event) =>
									setState({ ...state, systemAudio: event.target.checked })
								}
							/>
						</label>
						<p role="status">
							{windowState === "open"
								? playgroundAction
								: `Window preview: ${windowState}`}
							. All controls affect this preview only.
						</p>
					</aside>
				</div>
			</section>
			<section aria-labelledby="components-heading">
				<div className="ltp-section-heading">
					<h2 id="components-heading">Small parts, one language</h2>
					<span>03 — Components</span>
				</div>
				<div className="ltp-components">
					<article>
						<div>
							<CaptureModeSwitch
								mode={state.mode}
								onChange={(mode) => setState({ ...state, mode })}
							/>
						</div>
						<h3>Capture mode</h3>
						<p>A quiet switch with a warm accent.</p>
					</article>
					<article>
						<div>
							<CaptureTargetSelector
								target={state.target}
								onChange={(target) => setState({ ...state, target })}
							/>
						</div>
						<h3>Capture target</h3>
						<p>Display, window, or just a little area.</p>
					</article>
					<article>
						<div className="ltp-swatches">
							<span />
							<span />
							<span />
							<span />
						</div>
						<h3>Material & color</h3>
						<p>Porcelain, soft borders, and capture orange.</p>
					</article>
				</div>
			</section>
			<section
				aria-labelledby="target-variants-heading"
				className="ltp-target-variants-section"
			>
				<div className="ltp-section-heading">
					<h2 id="target-variants-heading">Thirteen smaller target systems</h2>
					<span>04 — Icon studies</span>
				</div>
				<p className="ltp-target-variants-intro">
					Icon tiles is the selected direction. Each study keeps Display,
					Window, and Area separate, with the icon as the primary cue.
				</p>
				<CaptureTargetVariants />
			</section>
			<footer className="ltp-footer">
				<span>QUIRO / LAUNCH TOOLBAR STUDY</span>
				<span>Design preview · No recording or app actions</span>
			</footer>
		</main>
	);
}
