import { Dithering } from "@paper-design/shaders-react";
import {
	Button,
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
	cn,
	Switch,
} from "@quiro/ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type as osType } from "@tauri-apps/plugin-os";
import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import MacOsTitlebarControls from "@/components/titlebar/macos-titlebar-control";
import WindowsTitlebarControls from "@/components/titlebar/windows11-titlebar-control";
import { QuiroModeControl } from "@/routes/launch/quiro-mode";
import { generalSettingsStore } from "@/store";
import {
	isPermissionGranted,
	requestAndVerifyPermission,
} from "@/utils/os-permissions";
import {
	commands,
	type OSPermission,
	type OSPermissionsCheck,
	type RecordingMode,
} from "@/utils/tauri";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideArrowRight from "~icons/lucide/arrow-right";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideMonitor from "~icons/lucide/monitor";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucidePanelRight from "~icons/lucide/panel-right";
import IconLucideSettings from "~icons/lucide/settings";
import IconLucideShield from "~icons/lucide/shield";
import IconLucideUpload from "~icons/lucide/upload";
import IconFilmSlate from "~icons/ph/film-slate";
import IconScreenshot from "~icons/ph/image-fill";
import IconQuiroLogo from "~icons/quiro/logo";

type ModeId = "screenshot" | "record" | "export";
type Mode = {
	id: ModeId;
	title: string;
	tagline: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
	features: string[];
};
type PermissionItem = {
	key: OSPermission;
	name: string;
	description: string;
	optional?: boolean;
};

const modes: Mode[] = [
	{
		id: "screenshot",
		title: "Screenshot",
		tagline: "Capture a moment",
		description:
			"Capture a display, window, or custom area and move directly into a focused workspace for annotation and presentation.",
		icon: IconScreenshot,
		features: [
			"Display, window, and area capture",
			"High-resolution local images",
			"Fast annotation workflow",
			"Consistent framing and export",
		],
	},
	{
		id: "record",
		title: "Record",
		tagline: "Capture in full quality",
		description:
			"Capture your screen, camera, microphone, and system audio in a local recording that is ready for the editor.",
		icon: IconFilmSlate,
		features: [
			"Full-quality local recording",
			"Screen, camera, and audio",
			"Window, display, or area capture",
			"Reliable local project files",
		],
	},
	{
		id: "export",
		title: "Export",
		tagline: "Finish with confidence",
		description:
			"Choose the format, resolution, frame rate, and destination for a clean final video that is ready to publish.",
		icon: IconLucideUpload,
		features: [
			"Resolution and FPS controls",
			"Reusable export presets",
			"Quality and compression options",
			"Clear export progress",
		],
	},
];

const setupPermissions: PermissionItem[] = [
	{
		key: "screenRecording",
		name: "Screen Recording",
		description: "Allows Quiro to capture windows and displays.",
	},
	{
		key: "accessibility",
		name: "Accessibility",
		description: "Captures pointer activity for automatic zoom segments.",
	},
	{
		key: "microphone",
		name: "Microphone",
		description: "Records your voice alongside the screen.",
		optional: true,
	},
	{
		key: "camera",
		name: "Camera",
		description: "Adds a camera bubble to your recordings.",
		optional: true,
	},
];

function useEntrance(active: boolean, delay = 80) {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!active) {
			setVisible(false);
			return;
		}
		const timeout = window.setTimeout(() => setVisible(true), delay);
		return () => window.clearTimeout(timeout);
	}, [active, delay]);
	return visible;
}

function useReducedMotion() {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	return reduced;
}

function OnboardingShader() {
	const reduceMotion = useReducedMotion();

	return (
		<div
			className="pointer-events-none absolute inset-0 overflow-hidden"
			aria-hidden="true"
		>
			<Dithering
				width="100%"
				height="100%"
				colorBack="#fff8f2"
				colorFront="#f3801f"
				shape="warp"
				type="4x4"
				size={2}
				speed={reduceMotion ? 0 : 0.12}
				scale={0.72}
				rotation={8}
				offsetX={0.18}
				offsetY={-0.08}
				fit="cover"
				minPixelRatio={1}
				maxPixelCount={600_000}
				className="h-full w-full opacity-[0.16]"
			/>
		</div>
	);
}

export default function Onboarding() {
	const isMacOs = osType() === "macos";
	const minimumStep = isMacOs ? 0 : 1;
	const [step, setStep] = useState(minimumStep);
	const [showStartupOverlay, setShowStartupOverlay] = useState(true);
	const [isExiting, setIsExiting] = useState(false);
	const [permissions, setPermissions] = useState<OSPermissionsCheck | null>(
		null,
	);
	const [busyPermission, setBusyPermission] = useState<OSPermission | null>(
		null,
	);
	const [finishing, setFinishing] = useState(false);
	const settings = generalSettingsStore.useQuery();

	useEffect(() => {
		document.documentElement.setAttribute("data-transparent-window", "true");
		return () =>
			document.documentElement.removeAttribute("data-transparent-window");
	}, []);

	const corePermissionsGranted = useMemo(
		() =>
			permissions !== null &&
			isPermissionGranted(permissions.screenRecording) &&
			isPermissionGranted(permissions.accessibility),
		[permissions],
	);
	const permissionsOnly =
		isMacOs &&
		settings.data?.hasCompletedOnboarding === true &&
		!corePermissionsGranted;
	const totalSteps = permissionsOnly ? 1 : 8;

	const refreshPermissions = useCallback(async () => {
		setPermissions(await commands.doPermissionsCheck(false));
	}, []);

	useEffect(() => {
		void refreshPermissions();
	}, [refreshPermissions]);

	useEffect(() => {
		if (settings.data?.hasCompletedStartup) setShowStartupOverlay(false);
	}, [settings.data?.hasCompletedStartup]);

	const handleStartupDone = useCallback(async () => {
		setIsExiting(true);
		await generalSettingsStore.set({ hasCompletedStartup: true });
		window.setTimeout(() => {
			setShowStartupOverlay(false);
			setIsExiting(false);
		}, 600);
	}, []);

	const finish = useCallback(async () => {
		setFinishing(true);
		try {
			await generalSettingsStore.set({
				hasCompletedOnboarding: true,
				hasCompletedStartup: true,
			});
			await settings.refetch();
			await invoke("show_window", {
				window: { Main: { init_target_mode: null } },
			});
			await getCurrentWindow().close();
		} finally {
			setFinishing(false);
		}
	}, [settings]);

	const goToStep = useCallback(
		(target: number) => {
			if (target >= minimumStep && target < totalSteps) setStep(target);
		},
		[minimumStep, totalSteps],
	);
	const nextDisabled = isMacOs && step === 0 && !corePermissionsGranted;
	const handleNext = useCallback(() => {
		if (permissionsOnly || step === totalSteps - 1) {
			void finish();
			return;
		}
		goToStep(step + 1);
	}, [finish, goToStep, permissionsOnly, step, totalSteps]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (showStartupOverlay) {
				if (event.code === "Space" && !isExiting) {
					event.preventDefault();
					void handleStartupDone();
				}
				return;
			}
			if (event.key === "ArrowRight" && !nextDisabled) {
				event.preventDefault();
				handleNext();
			} else if (event.key === "ArrowLeft" && step > minimumStep) {
				event.preventDefault();
				goToStep(step - 1);
			} else if (event.key === "Enter" && !nextDisabled) {
				event.preventDefault();
				handleNext();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		goToStep,
		handleNext,
		handleStartupDone,
		isExiting,
		minimumStep,
		nextDisabled,
		showStartupOverlay,
		step,
	]);

	const requestPermission = async (permission: OSPermission) => {
		if (!permissions || busyPermission) return;
		setBusyPermission(permission);
		try {
			const result = await requestAndVerifyPermission(
				commands,
				permission,
				permissions[permission],
			);
			setPermissions(result.check);
		} finally {
			setBusyPermission(null);
		}
	};
	const pageOffset = permissionsOnly ? 0 : minimumStep;

	return (
		<main className="onboarding-shell relative flex h-screen flex-col overflow-hidden rounded-[16px] bg-gray-1 text-gray-12">
			<OnboardingShader />
			<header
				className={cn(
					"relative z-40 flex h-9 shrink-0 items-center",
					isMacOs ? "flex-row-reverse" : "flex-row",
				)}
				data-tauri-drag-region
			>
				<div
					className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5"
					data-tauri-drag-region
				>
					<div className="grid size-6 place-items-center rounded-lg bg-accent-solid text-gray-1 dark:text-gray-12 shadow-xs">
						<IconQuiroLogo className="size-3.5" />
					</div>
					<span className="text-xs font-semibold tracking-tight">Quiro</span>
				</div>
				{isMacOs ? (
					<MacOsTitlebarControls
						className="mr-auto ml-3"
						showMinimize={false}
						showZoom={false}
					/>
				) : (
					<WindowsTitlebarControls className="ml-auto" maximizable={false} />
				)}
			</header>
			<div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="relative min-h-0 flex-1">
					{isMacOs ? (
						<StepPanel active={step === 0} index={0} currentStep={step}>
							<PermissionsStep
								active={step === 0 && !showStartupOverlay}
								permissions={permissions}
								busyPermission={busyPermission}
								onGrant={requestPermission}
							/>
						</StepPanel>
					) : null}
					{!permissionsOnly ? (
						<>
							<StepPanel active={step === 1} index={1} currentStep={step}>
								<ModesOverviewStep active={step === 1} />
							</StepPanel>
							{modes.map((mode, index) => (
								<StepPanel
									key={mode.id}
									active={step === index + 2}
									index={index + 2}
									currentStep={step}
								>
									<ModeDetailStep mode={mode} active={step === index + 2} />
								</StepPanel>
							))}
							<StepPanel active={step === 5} index={5} currentStep={step}>
								<WorkflowStep active={step === 5} />
							</StepPanel>
							<StepPanel active={step === 6} index={6} currentStep={step}>
								<ShortcutsStep active={step === 6} />
							</StepPanel>
							<StepPanel active={step === 7} index={7} currentStep={step}>
								<FaqStep active={step === 7} />
							</StepPanel>
						</>
					) : null}
				</div>
				{!showStartupOverlay || isExiting ? (
					<StepNavigation
						current={step - pageOffset}
						total={totalSteps - pageOffset}
						showBack={step > minimumStep}
						showSkip={corePermissionsGranted && !permissionsOnly}
						disabled={nextDisabled || finishing}
						nextLabel={
							permissionsOnly
								? "Continue to Quiro"
								: step === totalSteps - 1
									? "Start Using Quiro"
									: "Continue"
						}
						onBack={() => goToStep(step - 1)}
						onNext={handleNext}
						onSkip={() => void finish()}
					/>
				) : null}
			</div>
			{showStartupOverlay ? (
				<StartupOverlay exiting={isExiting} onStart={handleStartupDone} />
			) : null}
		</main>
	);
}

function StepPanel({
	active,
	index,
	currentStep,
	children,
}: {
	active: boolean;
	index: number;
	currentStep: number;
	children: ReactNode;
}) {
	return (
		<div
			className="absolute inset-0 overflow-y-auto"
			style={{
				transform: active
					? "translateX(0)"
					: index < currentStep
						? "translateX(-40px)"
						: "translateX(40px)",
				opacity: active ? 1 : 0,
				visibility: active ? "visible" : "hidden",
				pointerEvents: active ? "auto" : "none",
				zIndex: active ? 1 : 0,
				transition:
					"transform 400ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms ease",
			}}
		>
			{children}
		</div>
	);
}

function StepNavigation({
	current,
	total,
	showBack,
	showSkip,
	disabled,
	nextLabel,
	onBack,
	onNext,
	onSkip,
}: {
	current: number;
	total: number;
	showBack: boolean;
	showSkip: boolean;
	disabled: boolean;
	nextLabel: string;
	onBack: () => void;
	onNext: () => void;
	onSkip: () => void;
}) {
	return (
		<div className="relative z-40 flex shrink-0 flex-col items-center gap-2 px-8 pb-5 pt-2">
			<div className="flex w-full items-center justify-between">
				<div className="flex-1">
					{showBack ? (
						<button
							type="button"
							onClick={onBack}
							className="flex items-center gap-1.5 text-[13px] text-gray-10 transition-colors hover:text-gray-12"
						>
							<IconLucideArrowLeft className="size-3.5" /> Back
						</button>
					) : null}
				</div>
				<div className="flex items-center gap-1">
					{Array.from({ length: total }, (_, index) => `step-${index + 1}`).map(
						(indicator, index) => (
							<div
								key={indicator}
								className={cn(
									"h-1.5 rounded-full transition-[width,background-color] duration-300",
									current === index
										? "w-5 bg-gray-12"
										: current > index
											? "w-1.5 bg-gray-8"
											: "w-1.5 bg-gray-5",
								)}
							/>
						),
					)}
				</div>
				<div className="flex flex-1 justify-end">
					<div className="flex flex-col items-center gap-1.5">
						<Button
							onClick={onNext}
							variant="primary"
							size="md"
							className="min-h-12 min-w-38 gap-2 px-10 py-3 text-[15px] font-medium"
							disabled={disabled}
						>
							{nextLabel}
							{current < total - 1 ? (
								<IconLucideArrowRight className="size-4" />
							) : (
								<IconLucideCheck className="size-4" />
							)}
						</Button>
						{showSkip ? (
							<button
								type="button"
								onClick={onSkip}
								className="py-0.5 text-[11px] text-gray-9 transition-colors hover:text-gray-11"
							>
								Skip onboarding
							</button>
						) : null}
					</div>
				</div>
			</div>
			<span className="text-[10px] tabular-nums text-gray-8">
				Press Enter ↵ or use ← → arrow keys
			</span>
		</div>
	);
}

function StartupOverlay({
	exiting,
	onStart,
}: {
	exiting: boolean;
	onStart: () => void;
}) {
	return (
		<div
			className={cn(
				"onboarding-startup absolute inset-0 z-50 flex min-h-full flex-col overflow-hidden bg-gray-1 transition-[transform,opacity] duration-600",
				exiting && "pointer-events-none scale-105 opacity-0",
			)}
		>
			<OnboardingShader />
			<div className="startup-grain" aria-hidden="true" />
			<div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 text-center">
				<div className="grid size-20 place-items-center rounded-[26px] bg-gray-12 text-gray-1 shadow-xl">
					<IconQuiroLogo className="size-11" />
				</div>
				<h1 className="mb-4 mt-8 text-5xl font-bold tracking-tight">
					Welcome to Quiro
				</h1>
				<p className="whitespace-nowrap text-2xl text-gray-10">
					Beautiful screen recordings, owned by you.
				</p>
				<Button
					className="mt-14 min-h-15 min-w-60 flex-col gap-0.5 px-16 py-4 text-xl font-medium shadow-xl"
					variant="primary"
					size="lg"
					onClick={onStart}
				>
					<span>Get Started</span>
					<span className="inline-flex items-center gap-1 text-[11px] font-normal opacity-60">
						Click here, or press
						<kbd className="rounded border border-current/20 px-1 py-px text-[10px] gray-button-shadow">
							Space
						</kbd>
					</span>
				</Button>
			</div>
		</div>
	);
}

function PermissionsStep({
	active,
	permissions,
	busyPermission,
	onGrant,
}: {
	active: boolean;
	permissions: OSPermissionsCheck | null;
	busyPermission: OSPermission | null;
	onGrant: (permission: OSPermission) => Promise<void>;
}) {
	const visible = useEntrance(active, 100);
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-6 px-12">
			<StepHeading
				visible={visible}
				icon={<IconLucideShield className="size-5" />}
				title="Permissions Required"
				description="Quiro needs a few permissions to record your screen and capture audio."
			/>
			<div className="flex w-full max-w-[440px] flex-col gap-2">
				{setupPermissions.map((permission, index) => {
					const status = permissions?.[permission.key];
					if (status === "notNeeded") return null;
					const granted = status ? isPermissionGranted(status) : false;
					return (
						<Card
							key={permission.key}
							className="flex items-center gap-4 rounded-xl bg-white px-4 py-3 shadow-xs transition-[transform,opacity] duration-500 dark:bg-gray-2"
							style={{
								transitionDelay: `${150 + index * 80}ms`,
								opacity: visible ? 1 : 0,
								transform: visible ? "translateY(0)" : "translateY(8px)",
							}}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="text-[13px] font-medium">
										{permission.name}
									</span>
									{permission.optional ? (
										<span className="rounded-full bg-gray-2 px-1.5 py-0.5 text-[10px] text-gray-9 dark:bg-gray-4">
											Optional
										</span>
									) : null}
								</div>
								<p className="mt-0.5 text-[11px] text-gray-10">
									{permission.description}
								</p>
							</div>
							{granted ? (
								<div className="flex items-center gap-1.5 rounded-lg border border-green-5 bg-green-3 px-3 py-1.5 text-xs font-medium text-green-11">
									<IconLucideCheck className="size-3" /> Granted
								</div>
							) : (
								<Button
									size="sm"
									variant="gray"
									disabled={busyPermission !== null}
									onClick={() => void onGrant(permission.key)}
								>
									{status === "denied" ? "Open Settings" : "Grant"}
								</Button>
							)}
						</Card>
					);
				})}
			</div>
		</div>
	);
}

function StepHeading({
	visible,
	icon,
	title,
	description,
}: {
	visible: boolean;
	icon?: ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div
			className={cn(
				"flex max-w-[480px] flex-col items-center gap-3 text-center transition-[transform,opacity] duration-500",
				visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
			)}
		>
			{icon ? (
				<div className="flex size-12 items-center justify-center rounded-2xl border border-gray-4 bg-white dark:bg-gray-3">
					{icon}
				</div>
			) : null}
			<h2 className="text-2xl font-bold tracking-tight">{title}</h2>
			<p className="text-[14px] leading-relaxed text-gray-10">{description}</p>
		</div>
	);
}

function ModesOverviewStep({ active }: { active: boolean }) {
	const visible = useEntrance(active, 100);
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-8 px-10">
			<StepHeading
				visible={visible}
				title="One app, every workflow"
				description="Capture a screenshot, record your screen, and create a polished export from one focused workspace."
			/>
			<div className="flex w-full max-w-[540px] gap-4">
				{modes.map((mode, index) => (
					<Card
						key={mode.id}
						className="flex flex-1 flex-col items-center gap-3 bg-white shadow-xs transition-[transform,opacity] duration-500 dark:bg-gray-2"
						style={{
							transitionDelay: `${200 + index * 100}ms`,
							opacity: visible ? 1 : 0,
							transform: visible
								? "translateY(0) scale(1)"
								: "translateY(16px) scale(.95)",
						}}
					>
						<div className="flex size-12 items-center justify-center rounded-2xl border border-gray-5 bg-white dark:bg-gray-3">
							<mode.icon className="size-5" />
						</div>
						<div className="text-center">
							<p className="text-sm font-semibold">{mode.title}</p>
							<p className="mt-1 text-[11px] text-gray-9">{mode.tagline}</p>
						</div>
					</Card>
				))}
			</div>
		</div>
	);
}

function ModeDetailStep({ mode, active }: { mode: Mode; active: boolean }) {
	const visible = useEntrance(active);
	return (
		<div className="flex min-h-full items-center gap-8 px-10 py-6">
			<div className="flex w-[240px] shrink-0 flex-col gap-4">
				<div
					className={cn(
						"flex flex-col gap-4 transition-[transform,opacity] duration-500",
						visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
					)}
				>
					<div className="flex items-center gap-3">
						<div className="flex size-11 items-center justify-center rounded-xl border border-gray-5 bg-white dark:bg-gray-3">
							<mode.icon className="size-5" />
						</div>
						<div>
							<h3 className="text-lg font-bold">{mode.title}</h3>
							<p className="text-[11px] text-gray-9">{mode.tagline}</p>
						</div>
					</div>
					<p className="text-[13px] leading-relaxed text-gray-10">
						{mode.description}
					</p>
					<div className="flex flex-col gap-2.5">
						{mode.features.map((feature) => (
							<div key={feature} className="flex items-center gap-2.5">
								<div className="flex size-5 items-center justify-center rounded-full bg-accent-solid text-white">
									<IconLucideCheck className="size-2.5" />
								</div>
								<span className="text-xs text-gray-11">{feature}</span>
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="flex min-w-0 flex-1 items-center justify-center">
				<Card className="h-[350px] w-full overflow-hidden p-0 shadow-xs">
					<ModeMockup mode={mode.id} active={active} />
				</Card>
			</div>
		</div>
	);
}

function ModeMockup({ mode, active }: { mode: ModeId; active: boolean }) {
	if (mode === "export") return <ExportMockup />;
	if (mode === "screenshot") return <ScreenshotMockup active={active} />;
	return <RecordMockup active={active} />;
}

function ScreenshotMockup({ active }: { active: boolean }) {
	const [target, setTarget] = useState("Area");
	const targets = ["Display", "Window", "Area"];

	return (
		<div className="grid h-full grid-cols-[150px_1fr] gap-4 bg-gray-2 p-5 dark:bg-gray-3">
			<div className="flex flex-col gap-2">
				<p className="px-1 text-[11px] font-semibold text-gray-10">
					Capture source
				</p>
				{targets.map((item, index) => {
					const Icon =
						index === 0
							? IconLucideMonitor
							: index === 1
								? IconLucidePanelRight
								: IconLucideMousePointer2;
					const selected = target === item;
					return (
						<button
							type="button"
							key={item}
							onClick={() => setTarget(item)}
							className={cn(
								"flex min-h-10 items-center gap-2 rounded-xl px-3 text-left text-xs transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96]",
								selected
									? "bg-white text-gray-12 shadow-xs ring-1 ring-accent-border-selected dark:bg-gray-4"
									: "text-gray-9 hover:bg-gray-3 hover:text-gray-11 dark:hover:bg-gray-4",
							)}
						>
							<Icon className="size-3.5" />
							{item}
						</button>
					);
				})}
			</div>
			<Card className="flex min-w-0 flex-col overflow-hidden bg-white p-3 shadow-xs dark:bg-gray-2">
				<div className="flex items-center justify-between pb-3">
					<div>
						<p className="text-xs font-semibold">{target} capture</p>
						<p className="mt-0.5 text-[10px] text-gray-9">
							Choose exactly what you want to keep
						</p>
					</div>
					<div className="grid size-8 place-items-center rounded-lg bg-accent-surface text-accent-solid">
						<IconScreenshot className="size-4" />
					</div>
				</div>
				<div className="relative grid flex-1 place-items-center overflow-hidden rounded-xl bg-gray-3">
					<div className="absolute inset-x-7 inset-y-5 rounded-lg border border-dashed border-accent-border-selected bg-accent-surface/35" />
					<div className="relative grid size-14 place-items-center rounded-2xl bg-white text-accent-solid shadow-xs dark:bg-gray-4">
						<IconScreenshot className="size-6" />
					</div>
				</div>
				<Button variant="accent" className="mt-3 w-full" disabled={!active}>
					Capture {target.toLowerCase()}
				</Button>
			</Card>
		</div>
	);
}

function RecordMockup({ active }: { active: boolean }) {
	const [cameraEnabled, setCameraEnabled] = useState(true);
	const [microphoneEnabled, setMicrophoneEnabled] = useState(true);

	return (
		<div className="grid h-full place-items-center bg-gray-2 p-5 dark:bg-gray-3">
			<Card className="w-full max-w-[360px] bg-white p-4 shadow-xs dark:bg-gray-2">
				<div className="mb-4 flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<div className="grid size-9 place-items-center rounded-xl bg-accent-surface text-accent-solid">
							<IconFilmSlate className="size-4.5" />
						</div>
						<div>
							<p className="text-xs font-semibold">Ready to record</p>
							<p className="mt-0.5 text-[10px] text-gray-9">Entire display</p>
						</div>
					</div>
					<span className="rounded-full bg-green-3 px-2 py-1 text-[10px] font-medium text-green-11">
						Ready
					</span>
				</div>
				<div className="mb-3 grid grid-cols-3 gap-2">
					{["Display", "Window", "Area"].map((item, index) => (
						<div
							key={item}
							className={cn(
								"rounded-xl px-2 py-2.5 text-center text-[10px] font-medium",
								index === 0
									? "bg-accent-surface text-accent-text ring-1 ring-accent-border-selected"
									: "bg-gray-2 text-gray-9 dark:bg-gray-3",
							)}
						>
							{item}
						</div>
					))}
				</div>
				<div className="mb-4 space-y-2">
					<SourceToggle
						label="Camera"
						detail="Integrated camera"
						checked={cameraEnabled}
						onCheckedChange={setCameraEnabled}
					/>
					<SourceToggle
						label="Microphone"
						detail="Default microphone"
						checked={microphoneEnabled}
						onCheckedChange={setMicrophoneEnabled}
					/>
				</div>
				<Button variant="accent" className="w-full" disabled={!active}>
					Start recording
				</Button>
			</Card>
		</div>
	);
}

function SourceToggle({
	label,
	detail,
	checked,
	onCheckedChange,
}: {
	label: string;
	detail: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between rounded-xl bg-gray-2 px-3 py-2.5 dark:bg-gray-3">
			<div>
				<p className="text-xs font-medium">{label}</p>
				<p className="mt-0.5 text-[10px] text-gray-9">{detail}</p>
			</div>
			<Switch
				checked={checked}
				onCheckedChange={onCheckedChange}
				aria-label={label}
			/>
		</div>
	);
}

function ExportMockup() {
	const [transparentBackground, setTransparentBackground] = useState(false);

	return (
		<div className="grid h-full place-items-center bg-gray-2 p-6 dark:bg-gray-3">
			<Card className="w-full max-w-[320px] p-0 shadow-[0_16px_40px_oklch(0_0_0/0.12)]">
				<CardHeader className="border-b border-gray-4 p-4">
					<CardTitle className="text-sm">Export video</CardTitle>
					<CardDescription className="text-xs">
						Choose how your finished recording is rendered.
					</CardDescription>
				</CardHeader>
				<div className="space-y-3 p-4">
					<div className="grid grid-cols-2 gap-2">
						<ExportValue label="Resolution" value="1080p" />
						<ExportValue label="Frame rate" value="60 FPS" />
					</div>
					<div className="flex items-center justify-between rounded-xl bg-gray-2 px-3 py-2.5 dark:bg-gray-3">
						<div>
							<p className="text-xs font-medium">Transparent background</p>
							<p className="mt-0.5 text-[10px] text-gray-9">
								Export with alpha
							</p>
						</div>
						<Switch
							checked={transparentBackground}
							onCheckedChange={setTransparentBackground}
							aria-label="Transparent background"
						/>
					</div>
					<Button
						className="w-full"
						variant="accent"
						icon={<IconLucideUpload className="size-4" />}
					>
						Export video
					</Button>
				</div>
			</Card>
		</div>
	);
}

function ExportValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl bg-gray-2 px-3 py-2.5 dark:bg-gray-3">
			<p className="text-[10px] text-gray-9">{label}</p>
			<p className="mt-0.5 text-xs font-medium">{value}</p>
		</div>
	);
}

function WorkflowStep({ active }: { active: boolean }) {
	const visible = useEntrance(active, 100);
	const [selectedMode, setSelectedMode] = useState<RecordingMode>("studio");
	const isRecording = selectedMode === "studio";

	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-8 px-12">
			<StepHeading
				visible={visible}
				title="Switch capture modes anytime"
				description="Use the same mode control from Quiro’s main window to move between recording and screenshots."
			/>
			<Card
				className="flex w-full max-w-[420px] flex-col items-center gap-6 bg-white px-8 py-7 shadow-xs transition-[transform,opacity] duration-500 dark:bg-gray-2"
				style={{
					opacity: visible ? 1 : 0,
					transform: visible ? "translateY(0)" : "translateY(10px)",
				}}
			>
				<QuiroModeControl mode={selectedMode} onModeChange={setSelectedMode} />
				<div className="flex items-center gap-3 text-center">
					<div className="grid size-10 place-items-center rounded-xl bg-accent-surface text-accent-solid">
						{isRecording ? (
							<IconFilmSlate className="size-4.5" />
						) : (
							<IconScreenshot className="size-4.5" />
						)}
					</div>
					<div className="text-left">
						<p className="text-sm font-semibold">
							{isRecording ? "Studio Mode" : "Screenshot Mode"}
						</p>
						<p className="mt-0.5 text-[11px] text-gray-9">
							{isRecording
								? "High-quality screen, camera, and audio recording."
								: "Fast, high-resolution display and area capture."}
						</p>
					</div>
				</div>
			</Card>
		</div>
	);
}

function ShortcutsStep({ active }: { active: boolean }) {
	const visible = useEntrance(active, 100);
	const areas = [
		{
			title: "Recording preferences",
			description: "Set countdown, cursor capture, and keyboard events first.",
			icon: IconFilmSlate,
			priority: "Start here",
			primary: true,
		},
		{
			title: "Quality and FPS",
			description: "Balance visual quality, performance, and file size.",
			icon: IconLucideGauge,
			priority: "Next",
			primary: false,
		},
		{
			title: "Keyboard shortcuts",
			description: "Customize global capture controls.",
			icon: IconLucideKeyboard,
			priority: "Optional",
			primary: false,
		},
		{
			title: "Storage and privacy",
			description: "Choose where captures live and which windows stay hidden.",
			icon: IconLucideFolderOpen,
			priority: "Optional",
			primary: false,
		},
	];
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-6 px-12">
			<StepHeading
				visible={visible}
				icon={<IconLucideSettings className="size-5" />}
				title="Make Quiro yours"
				description="Customize everything from keyboard shortcuts to recording defaults. Quiro adapts to your workflow."
			/>
			<div className="grid w-full max-w-[480px] grid-cols-2 gap-2.5">
				{areas.map((area, index) => (
					<Card
						key={area.title}
						className={cn(
							"rounded-xl bg-white px-4 py-3.5 shadow-xs transition-[transform,opacity] duration-500 dark:bg-gray-2",
							area.primary &&
							"col-span-2 border-accent-border-selected bg-accent-surface/45",
						)}
						style={{
							transitionDelay: `${150 + index * 80}ms`,
							opacity: visible ? 1 : 0,
							transform: visible ? "translateY(0)" : "translateY(8px)",
						}}
					>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<div className="grid size-7 place-items-center rounded-lg bg-gray-3 text-gray-10 dark:bg-gray-4">
									<area.icon className="size-3.5" />
								</div>
								<span className="text-[13px] font-medium">{area.title}</span>
							</div>
							<span className="rounded-full bg-gray-3 px-2 py-0.5 text-[9px] font-medium text-gray-9 dark:bg-gray-4">
								{area.priority}
							</span>
						</div>
						<p className="mt-2 text-[11px] leading-relaxed text-gray-10">
							{area.description}
						</p>
					</Card>
				))}
			</div>
			<p className="text-xs text-gray-9">
				Change any of these at any time in Settings
			</p>
		</div>
	);
}

function FaqStep({ active }: { active: boolean }) {
	const visible = useEntrance(active, 100);
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-6 px-12 py-6">
			<StepHeading
				visible={visible}
				title="Frequently Asked Questions"
				description="Everything you need to know to get started."
			/>
			<Card className="w-full max-w-[480px] overflow-hidden rounded-xl bg-white p-0 shadow-xs dark:bg-gray-2">
				<FaqItem question="Is Quiro free to use?">
					Quiro can be used locally for creating and exporting recordings.
					Account-connected features can be wired here later.
				</FaqItem>
				<FaqItem question="Can I refine captures before exporting?">
					Yes. Screenshots and recordings stay local and can be refined before
					you export the finished result.
				</FaqItem>
				<FaqItem question="Where are my recordings stored?">
					Recordings are kept locally on your computer. Storage and sharing
					integrations can connect here when finalized.
				</FaqItem>
				<FaqItem question="Can I change my shortcuts later?">
					Yes. Open Settings and choose Shortcuts whenever you want to customize
					the global controls.
				</FaqItem>
				<FaqItem question="How does sharing work?">
					The sharing actions are visual placeholders in this front-end port and
					can be wired to Quiro’s sharing service later.
				</FaqItem>
			</Card>
		</div>
	);
}

function FaqItem({
	question,
	children,
}: {
	question: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="border-b border-gray-4 last:border-b-0">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-2 dark:hover:bg-gray-3"
			>
				<span className="text-[13px] font-medium">{question}</span>
				<IconLucideChevronDown
					className={cn(
						"size-3.5 text-gray-9 transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>
			<div
				className="overflow-hidden transition-[height,opacity] duration-300"
				style={{ maxHeight: open ? 200 : 0, opacity: open ? 1 : 0 }}
			>
				<p className="px-4 pb-3 text-[13px] leading-relaxed text-gray-10">
					{children}
				</p>
			</div>
		</div>
	);
}
