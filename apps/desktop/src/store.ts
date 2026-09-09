import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { Store } from "@tauri-apps/plugin-store";
import { useEffect } from "react";
import type {
	GeneralSettingsStore,
	PresetsStore,
	RecordingSettingsStore,
} from "./utils/tauri";

// Ported from Cap's apps/desktop/src/store.ts. Cap's authStore and
// userProfileStore (cloud sign-in + account identity) are deliberately not
// here — Quiro has no cloud backend to authenticate against, so a "signed
// in user" has no meaning. automationsStore is also not here: AutomationRule.
// actions reference upload/share actions Quiro has no backend for.
// presetsStore is the editor's saved ProjectConfiguration presets, shared
// with the Rust side's presets.rs (same "store" file, same "presets" key).
//
// Every other store here is fully functional: generalSettingsStore and
// recordingSettingsStore read/write the exact same tauri-plugin-store file
// ("store", keyed by "general_settings"/"recording_settings") that the
// Rust side already owns (see src-tauri/src/general_settings.rs and
// recording_settings.rs) — a change from either side is visible to the
// other. mainWindowUIStore and teleprompterStore are pure frontend
// persistence with no Rust involvement (teleprompterStore has nowhere to
// be consumed yet — WindowId::Teleprompter exists in the Rust window
// system, but no teleprompter route/window is wired up in front of it).

export type TeleprompterStore = {
	script: string;
	fontSize: number;
	wordsPerMinute: number;
	lineHeight: number;
	showCueMarkers: boolean;
	mirror: boolean;
	windowOpacityPercent: number;
};

export const teleprompterDefaults: TeleprompterStore = {
	script: "",
	fontSize: 30,
	wordsPerMinute: 150,
	lineHeight: 1.5,
	showCueMarkers: true,
	mirror: false,
	windowOpacityPercent: 92,
};

export type MainWindowUIStore = {
	expanded: boolean;
};

// Hotkey registration (actually binding these to global shortcuts via
// tauri-plugin-global-shortcut) isn't built yet — this is storage only, so
// the shape is hand-defined here rather than generated from a Rust command,
// unlike GeneralSettingsStore/RecordingSettingsStore above. Once real
// registration exists it should move to a Rust HotkeysStore type + specta
// export, matching how the other two stores work.
export type Hotkey = {
	code: string;
	meta: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
};

export type HotkeyAction =
	| "startStudioRecording"
	| "stopRecording"
	| "restartRecording"
	| "togglePauseRecording"
	| "cycleRecordingMode"
	| "openRecordingPicker"
	| "openRecordingPickerDisplay"
	| "openRecordingPickerWindow"
	| "openRecordingPickerArea"
	| "screenshotDisplay"
	| "screenshotWindow"
	| "screenshotArea"
	| "other";

export type HotkeysStore = {
	hotkeys: Partial<Record<HotkeyAction, Hotkey>>;
};

let _store: Promise<Store> | undefined;
const store = () => {
	if (!_store) {
		_store = Store.load("store");
	}

	return _store;
};

function declareStore<T extends object>(name: string, defaults?: T) {
	const withDefaults = (value?: T): T | undefined =>
		defaults ? ({ ...defaults, ...(value ?? {}) } as T) : value;

	const get = async () => {
		const s = await store();
		return withDefaults(await s.get<T>(name));
	};

	const listen = (fn: (data?: T) => void) =>
		store().then((s) =>
			s.onKeyChange<T>(name, (data) => fn(withDefaults(data))),
		);

	const set = async (value?: Partial<T>) => {
		const s = await store();
		if (value === undefined) {
			await s.delete(name);
		} else {
			const current = (await s.get<T>(name)) ?? ({} as T);
			await s.set(name, { ...current, ...value });
		}
		await s.save();
	};

	// Named with a `use` prefix (unlike Cap's Solid `createQuery`) because it
	// calls hooks internally — see the identical note in utils/devices.tsx's
	// useDevicesQuery for why that's required under React's rules of hooks.
	function useQuery() {
		const query = useTanstackQuery({
			queryKey: ["store", name],
			queryFn: async () => (await get()) ?? null,
		});

		useEffect(() => {
			let cancelled = false;
			let unlisten: (() => void) | undefined;

			listen(() => query.refetch()).then((fn) => {
				if (cancelled) {
					fn();
				} else {
					unlisten = fn;
				}
			});

			return () => {
				cancelled = true;
				unlisten?.();
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		return query;
	}

	return { get, listen, set, useQuery };
}

export const mainWindowUIStore = declareStore<MainWindowUIStore>(
	"main_window_ui",
	{ expanded: false },
);
export const generalSettingsStore =
	declareStore<GeneralSettingsStore>("general_settings");
export const presetsStore = declareStore<PresetsStore>("presets", {
	presets: [],
	default: null,
});
export const recordingSettingsStore = declareStore<RecordingSettingsStore>(
	"recording_settings",
	{
		target: null,
		micName: null,
		cameraId: null,
		mode: null,
		systemAudio: false,
		cameraDeviceSettings: {},
		microphoneDeviceSettings: {},
	},
);
export const teleprompterStore = declareStore<TeleprompterStore>(
	"teleprompter",
	teleprompterDefaults,
);
export const hotkeysStore = declareStore<HotkeysStore>("hotkeys", {
	hotkeys: {},
});
