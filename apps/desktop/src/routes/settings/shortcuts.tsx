import "./shortcuts.css";
import { cn, toast } from "@quiro/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type as osType } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type Hotkey, type HotkeyAction } from "@/utils/tauri";
import IconLucideX from "~icons/lucide/x";
import IconCheck from "~icons/ph/check-circle-fill";
import IconWarning from "~icons/ph/warning-circle-fill";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

const ACTIONS: { action: HotkeyAction; label: string; description?: string }[] =
	[
		{
			action: "startStudioRecording",
			label: "Start studio recording",
			description: "Uses whichever target is currently selected.",
		},
		{ action: "stopRecording", label: "Stop recording" },
		{
			action: "togglePauseRecording",
			label: "Pause / resume recording",
			description: "Press the same shortcut again to resume.",
		},
		{ action: "restartRecording", label: "Restart recording" },
		{ action: "cycleRecordingMode", label: "Cycle recording mode" },
		{ action: "openRecordingPicker", label: "Open recording picker" },
		{ action: "openRecordingPickerDisplay", label: "Record display" },
		{ action: "openRecordingPickerWindow", label: "Record window" },
		{ action: "openRecordingPickerArea", label: "Record area" },
		{ action: "screenshotDisplay", label: "Screenshot current display" },
		{ action: "screenshotWindow", label: "Screenshot window under cursor" },
		{ action: "screenshotArea", label: "Screenshot area picker" },
	];

const IS_MAC = osType() === "macos";
const MODIFIER_CODES = new Set([
	"ControlLeft",
	"ControlRight",
	"ShiftLeft",
	"ShiftRight",
	"AltLeft",
	"AltRight",
	"MetaLeft",
	"MetaRight",
]);
type Feedback = {
	keys: string[];
	status: "listening" | "checking" | "success" | "error";
	message?: string;
};

function formatCode(code: string) {
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
	if (code.startsWith("Arrow")) return code.slice(5);
	return code;
}

function hotkeyKeys(hotkey: Hotkey) {
	const keys: string[] = [];
	if (hotkey.ctrl) keys.push(IS_MAC ? "⌃" : "Ctrl");
	if (hotkey.alt) keys.push(IS_MAC ? "⌥" : "Alt");
	if (hotkey.shift) keys.push(IS_MAC ? "⇧" : "Shift");
	if (hotkey.meta) keys.push(IS_MAC ? "⌘" : "Win");
	if (hotkey.code) keys.push(formatCode(hotkey.code));
	return keys;
}

function modifierKeys(event: KeyboardEvent) {
	const keys: string[] = [];
	if (event.ctrlKey || event.code.startsWith("Control"))
		keys.push(IS_MAC ? "⌃" : "Ctrl");
	if (event.altKey || event.code.startsWith("Alt"))
		keys.push(IS_MAC ? "⌥" : "Alt");
	if (event.shiftKey || event.code.startsWith("Shift"))
		keys.push(IS_MAC ? "⇧" : "Shift");
	if (event.metaKey || event.code.startsWith("Meta"))
		keys.push(IS_MAC ? "⌘" : "Win");
	return keys;
}

function sameHotkey(left: Hotkey, right: Hotkey) {
	return (
		left.code === right.code &&
		left.ctrl === right.ctrl &&
		left.alt === right.alt &&
		left.shift === right.shift &&
		left.meta === right.meta
	);
}

function Keycaps({ keys }: { keys: string[] }) {
	return (
		<span className="shortcut-keycaps">
			{keys.map((key, index) => (
				<span className="shortcut-key-group" key={key}>
					{index > 0 && <span className="shortcut-plus">+</span>}
					<kbd>{key}</kbd>
				</span>
			))}
		</span>
	);
}

function ShortcutFeedback({
	feedback,
	above,
}: {
	feedback: Feedback;
	above: boolean;
}) {
	const empty = feedback.keys.length === 0;
	const title =
		feedback.status === "success"
			? "Shortcut saved"
			: feedback.status === "error"
				? "Try another shortcut"
				: feedback.status === "checking"
					? "Checking shortcut"
					: "Type your shortcut";
	return (
		<div
			className={cn(
				"shortcut-feedback",
				above && "shortcut-feedback-above",
				`shortcut-feedback-${feedback.status}`,
			)}
			role="status"
			aria-live="polite"
		>
			<div className="shortcut-feedback-glow" />
			<div className="shortcut-feedback-copy">
				<span className="shortcut-feedback-kicker">{title}</span>
				<span>
					{feedback.message ??
						(empty
							? "Modifiers appear here as you press them"
							: "Keep typing your combination")}
				</span>
			</div>
			<div className="shortcut-feedback-keys">
				{empty ? (
					<span className="shortcut-waiting">
						<i />
						<i />
						<i />
					</span>
				) : (
					<Keycaps keys={feedback.keys} />
				)}
			</div>
			{feedback.status === "success" && (
				<IconCheck className="shortcut-feedback-icon" />
			)}
			{feedback.status === "error" && (
				<IconWarning className="shortcut-feedback-icon" />
			)}
		</div>
	);
}

export default function ShortcutsSettings() {
	const queryClient = useQueryClient();
	const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
	const [feedback, setFeedback] = useState<Feedback>({
		keys: [],
		status: "listening",
	});
	const query = useQuery({
		queryKey: ["hotkeys"],
		queryFn: async () => {
			const result = await commands.getHotkeys();
			if (result.status === "error") throw new Error(result.error);
			return result.data;
		},
	});
	const hotkeys = (query.data?.hotkeys ?? {}) as Partial<
		Record<HotkeyAction, Hotkey>
	>;
	const hotkeysRef = useRef(hotkeys);
	hotkeysRef.current = hotkeys;
	const labels = useMemo(
		() =>
			Object.fromEntries(
				ACTIONS.map(({ action, label }) => [action, label]),
			) as Partial<Record<HotkeyAction, string>>,
		[],
	);
	const apply = useCallback(
		async (action: HotkeyAction, hotkey: Hotkey | null) => {
			const result = await commands.setHotkey(action, hotkey);
			if (result.status === "error") return result.error;
			await queryClient.invalidateQueries({ queryKey: ["hotkeys"] });
			return null;
		},
		[queryClient],
	);
	const beginCapture = (action: HotkeyAction) => {
		if (capturing === action) {
			setCapturing(null);
			return;
		}
		setFeedback({ keys: [], status: "listening" });
		setCapturing(action);
	};

	useEffect(() => {
		if (!capturing) return;
		let timer: number | undefined;
		let checking = false;
		const fail = (keys: string[], message: string) => {
			setFeedback({ keys, status: "error", message });
			timer = window.setTimeout(
				() => setFeedback({ keys: [], status: "listening" }),
				1200,
			);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (checking || event.repeat) return;
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
			}
			if (
				event.code === "Escape" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey
			) {
				fail(["Esc"], "Escape is reserved for closing capture overlays");
				return;
			}
			if (MODIFIER_CODES.has(event.code)) {
				setFeedback({ keys: modifierKeys(event), status: "listening" });
				return;
			}
			const candidate: Hotkey = {
				code: event.code,
				meta: event.metaKey,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				shift: event.shiftKey,
			};
			const keys = hotkeyKeys(candidate);
			const current = hotkeysRef.current[capturing];
			if (current && sameHotkey(current, candidate)) {
				setFeedback({
					keys,
					status: "success",
					message: "This shortcut is already assigned here",
				});
				checking = true;
				timer = window.setTimeout(() => setCapturing(null), 850);
				return;
			}
			const conflict = Object.entries(hotkeysRef.current).find(
				([action, hotkey]) =>
					action !== capturing && hotkey && sameHotkey(hotkey, candidate),
			);
			if (conflict) {
				fail(
					keys,
					`Already used by ${labels[conflict[0] as HotkeyAction] ?? "another Quiro action"}`,
				);
				return;
			}
			setFeedback({
				keys,
				status: "checking",
				message: "Checking system-wide availability",
			});
			checking = true;
			void apply(capturing, candidate).then((error) => {
				if (error) {
					checking = false;
					fail(keys, error);
					return;
				}
				setFeedback({
					keys,
					status: "success",
					message: "Ready to use anywhere",
				});
				timer = window.setTimeout(() => setCapturing(null), 850);
			});
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", onKeyDown, { capture: true });
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [apply, capturing, labels]);

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<SettingsPageContent>
				<Section
					title="Shortcuts"
					description="Build system-wide shortcuts and see each key land as you type."
				>
					<SectionCard className="shortcut-list divide-y divide-gray-3">
						{ACTIONS.map(({ action, label, description }, index) => {
							const hotkey = hotkeys[action];
							const active = capturing === action;
							return (
								<div
									key={action}
									className={cn(
										"shortcut-row",
										active && "shortcut-row-active",
									)}
								>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<p className="text-[13px] text-gray-12">{label}</p>
										{description && (
											<p className="text-xs leading-snug text-gray-10">
												{description}
											</p>
										)}
									</div>
									<div className="shortcut-control">
										<button
											type="button"
											onClick={() => beginCapture(action)}
											aria-expanded={active}
											className={cn(
												"shortcut-trigger",
												active && "shortcut-trigger-active",
											)}
										>
											{hotkey ? (
												<Keycaps keys={hotkeyKeys(hotkey)} />
											) : (
												<span>{active ? "Listening…" : "Set shortcut"}</span>
											)}
										</button>
										<button
											type="button"
											aria-label={`Clear shortcut for ${label}`}
											disabled={!hotkey}
											onClick={() =>
												void apply(action, null).then(
													(error) => error && toast.error(error),
												)
											}
											className="shortcut-clear"
										>
											<IconLucideX />
										</button>
										{active && (
											<ShortcutFeedback
												feedback={feedback}
												above={index >= 8}
											/>
										)}
									</div>
								</div>
							);
						})}
					</SectionCard>
				</Section>
				<Section title="How it works">
					<SectionCard padded>
						<p className="text-xs leading-relaxed text-gray-11">
							Select a shortcut and type. Quiro checks conflicts with your other
							actions and the operating system before saving it.
						</p>
					</SectionCard>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
