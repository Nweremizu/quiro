import { cn, toast } from "@quiro/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type as osType } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useState } from "react";
import { commands, type Hotkey, type HotkeyAction } from "@/utils/tauri";
import IconLucideX from "~icons/lucide/x";
import { Section, SectionCard, SettingsPageContent } from "./Setting";

// The bindable actions, in the order they're most likely to be wanted. `other`
// exists in the Rust enum as a serde catch-all for forward compatibility and is
// deliberately not listed — it isn't an action a user can pick.
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
			description: "One key for both — pressing it again resumes.",
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

/** `Code` values are DOM-ish ("KeyA", "Digit1", "ArrowUp") — strip the prefixes
 *  that only exist to disambiguate, and leave the rest (F5, Space, Tab) alone. */
function formatCode(code: string) {
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
	if (code.startsWith("Arrow")) return code.slice(5);
	return code;
}

function formatHotkey(hotkey: Hotkey) {
	const parts: string[] = [];
	if (hotkey.ctrl) parts.push(IS_MAC ? "⌃" : "Ctrl");
	if (hotkey.alt) parts.push(IS_MAC ? "⌥" : "Alt");
	if (hotkey.shift) parts.push(IS_MAC ? "⇧" : "Shift");
	if (hotkey.meta) parts.push(IS_MAC ? "⌘" : "Win");
	parts.push(formatCode(hotkey.code));
	return parts.join(IS_MAC ? "" : " + ");
}

export default function ShortcutsSettings() {
	const queryClient = useQueryClient();
	const [capturing, setCapturing] = useState<HotkeyAction | null>(null);

	const query = useQuery({
		queryKey: ["hotkeys"],
		queryFn: async () => {
			const result = await commands.getHotkeys();
			if (result.status === "error") throw new Error(result.error);
			return result.data;
		},
	});

	// specta turns the Rust `HashMap<HotkeyAction, Hotkey>` into a *required*
	// mapped type, but the map only ever holds the actions actually bound — so
	// the generated type overstates what's there. Narrowing to Partial here
	// keeps the lookups below honest rather than trusting a type that lies.
	const hotkeys = (query.data?.hotkeys ?? {}) as Partial<
		Record<HotkeyAction, Hotkey>
	>;

	const apply = useCallback(
		async (action: HotkeyAction, hotkey: Hotkey | null) => {
			const result = await commands.setHotkey(action, hotkey);
			if (result.status === "error") {
				// Rust rejects a bare Escape and anything the OS already owns —
				// both are worth surfacing verbatim, they explain themselves.
				toast.error(result.error);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: ["hotkeys"] });
		},
		[queryClient],
	);

	useEffect(() => {
		if (!capturing) return;

		const onKeyDown = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// Escape cancels capture rather than binding — it's reserved anyway,
			// and "press Escape to back out" is what everyone expects here.
			if (e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				setCapturing(null);
				return;
			}

			// Ignore a modifier pressed on its own; wait for the real key.
			if (
				[
					"ControlLeft",
					"ControlRight",
					"ShiftLeft",
					"ShiftRight",
					"AltLeft",
					"AltRight",
					"MetaLeft",
					"MetaRight",
				].includes(e.code)
			) {
				return;
			}

			const action = capturing;
			setCapturing(null);
			void apply(action, {
				code: e.code,
				meta: e.metaKey,
				ctrl: e.ctrlKey,
				alt: e.altKey,
				shift: e.shiftKey,
			});
		};

		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [capturing, apply]);

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<SettingsPageContent>
				<Section
					title="Shortcuts"
					description="System-wide keys that work while another app has focus — which is the point, since recording something means Quiro isn't the window you're looking at."
				>
					<SectionCard className="divide-y divide-gray-3">
						{ACTIONS.map(({ action, label, description }) => {
							const hotkey = hotkeys[action];
							const isCapturing = capturing === action;

							return (
								<div
									key={action}
									className="flex items-center justify-between gap-4 px-4 py-3"
								>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<p className="text-[13px] text-gray-12">{label}</p>
										{description && (
											<p className="text-xs leading-snug text-gray-10">
												{description}
											</p>
										)}
									</div>

									<div className="flex shrink-0 items-center gap-1.5">
										<button
											type="button"
											onClick={() => setCapturing(isCapturing ? null : action)}
											className={cn(
												"min-w-28 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring",
												isCapturing
													? "border-accent-border-selected bg-accent-surface text-accent-text"
													: hotkey
														? "border-gray-5 bg-gray-3 text-gray-12 hover:bg-gray-4"
														: "border-gray-5 bg-gray-2 text-gray-10 hover:bg-gray-3",
											)}
										>
											{isCapturing
												? "Press keys…"
												: hotkey
													? formatHotkey(hotkey)
													: "Not set"}
										</button>

										<button
											type="button"
											aria-label={`Clear shortcut for ${label}`}
											disabled={!hotkey}
											onClick={() => void apply(action, null)}
											className="flex size-6 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12 disabled:pointer-events-none disabled:opacity-30"
										>
											<IconLucideX className="size-3.5" />
										</button>
									</div>
								</div>
							);
						})}
					</SectionCard>
				</Section>

				<Section title="Notes">
					<SectionCard padded>
						<ul className="space-y-2 text-xs leading-relaxed text-gray-11">
							<li>
								Escape on its own stays reserved for closing the capture
								overlay, so it can't be bound. Escape with a modifier is fine.
							</li>
							<li>
								A shortcut another app already owns can't be taken — Quiro will
								tell you rather than silently doing nothing.
							</li>
							{capturing && (
								<li className="text-accent-text">
									Press Escape to cancel without changing the binding.
								</li>
							)}
						</ul>
					</SectionCard>
				</Section>
			</SettingsPageContent>
		</div>
	);
}
