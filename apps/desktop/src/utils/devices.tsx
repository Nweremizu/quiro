import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	type CameraFormatInfo,
	type CameraInfo,
	commands,
	events,
	type OSPermissionsCheck,
} from "./tauri";

export type DevicesSnapshot = {
	cameras: CameraInfo[];
	microphones: string[];
	permissions: OSPermissionsCheck;
};

export type CameraWithDetails = CameraInfo & {
	bestFormat?: { width: number; height: number; frameRate: number };
	formats?: CameraFormatInfo[];
};

export type MicrophoneFormatInfo = {
	sampleRate: number;
	channels: number;
};

export type MicrophoneWithDetails = {
	name: string;
	sampleRate?: number;
	channels?: number;
	formats?: MicrophoneFormatInfo[];
};

export const devicesSnapshot = queryOptions({
	queryKey: ["devicesSnapshot"] as const,
	queryFn: () => commands.getDevicesSnapshot(),
	staleTime: 3_000,
	refetchInterval: 5_000,
});

// Named with a `use` prefix (unlike the Solid original's `createDevicesQuery`)
// because it calls hooks internally — React's rules-of-hooks (enforced by
// the eslint-plugin-react-hooks lint rule, and by React itself in some
// setups) only recognizes a function as hook-eligible if its name starts
// with `use`; anything else calling useQuery/useEffect/etc. is flagged as
// "this hook is being called from a function that is not a hook or component".
export function useDevicesQuery(enabled = true) {
	const queryClient = useQueryClient();
	const query = useQuery({
		...devicesSnapshot,
		enabled,
		refetchInterval: enabled ? devicesSnapshot.refetchInterval : false,
	});

	// The Solid version's `createEffect` here has no signals read
	// *synchronously* in its body — `enabled()` is only read inside the
	// `.listen` callback, which runs later and isn't tracked — so it
	// really only subscribes once, on initial mount, and relies on
	// `enabled()` being a live signal read whenever the listener actually
	// fires. A ref reproduces that "always current" read in React, where a
	// plain closure captured in a mount-once effect would otherwise freeze
	// at its first-render value.
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;

		events.devicesUpdated
			.listen((event) => {
				if (!enabledRef.current) return;
				// The event payload *is* a full devices snapshot (see the poll
				// loop in lib.rs), so write it straight into the cache. Calling
				// refetch() here instead would throw this data away and run
				// another full OS device enumeration for the same result.
				queryClient.setQueryData(devicesSnapshot.queryKey, event.payload);
			})
			.then((fn) => {
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
	}, [queryClient]);

	return query;
}

// On-demand, not part of useStableDevicesQuery's eager list load: a camera's
// formats require a real device probe (see get_camera_formats in devices.rs),
// which on Windows re-enumerates every camera via DirectShow/Media
// Foundation — genuinely slow, more so with virtual camera drivers
// installed. Fetching this for every camera the moment the list loads used
// to stall the whole UI on first open. Query-keyed on deviceId so React
// Query caches per camera and switching back to an already-expanded one is
// free.
// Devices report one format per *pixel format* (a webcam typically advertises
// the same 1920×1080 30fps mode as MJPG, YUY2 and NV12; mics repeat sample
// rates per sample format). Quiro only ever exposes resolution/frame-rate —
// and sample-rate/channels — so those collapse into rows that are visually
// identical and pick the same setting. Deduping here rather than at each
// dropdown keeps the two panels (and anything added later) consistent, and
// stops the duplicate React keys the raw lists would otherwise produce.
// Rounding the frame rate matches how it's displayed, so 29.97 and 30.0 don't
// both render as "30fps".
function dedupeBy<T>(items: T[], identity: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = identity(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function useCameraFormats(deviceId: string | null) {
	return useQuery({
		queryKey: ["cameraFormats", deviceId] as const,
		queryFn: async () => {
			const result = await commands.getCameraFormats(deviceId as string);
			if (!result) return result;
			return {
				...result,
				formats: dedupeBy(
					result.formats,
					(f) => `${f.width}x${f.height}@${Math.round(f.frameRate)}`,
				),
			};
		},
		enabled: deviceId !== null,
		staleTime: 60_000,
	});
}

export function useMicrophoneFormats(name: string | null) {
	return useQuery({
		queryKey: ["microphoneFormats", name] as const,
		queryFn: async () => {
			const result = await commands.getMicrophoneInfo(name as string);
			if (!result) return result;
			return {
				...result,
				formats: dedupeBy(
					result.formats,
					(f) => `${f.sampleRate}x${f.channels}`,
				),
			};
		},
		enabled: name !== null,
		staleTime: 60_000,
	});
}

function cameraListChanged(
	oldList: CameraWithDetails[],
	newList: CameraInfo[],
): boolean {
	if (oldList.length !== newList.length) return true;
	const oldIds = new Set(oldList.map((c) => c.device_id));
	return newList.some((c) => !oldIds.has(c.device_id));
}

function micListChanged(
	oldList: MicrophoneWithDetails[],
	newList: string[],
): boolean {
	if (oldList.length !== newList.length) return true;
	const oldNames = new Set(oldList.map((m) => m.name));
	return newList.some((name) => !oldNames.has(name));
}

export function useStableDevicesQuery(enabled = true) {
	const query = useDevicesQuery(enabled);

	const [cameras, setCameras] = useState<CameraWithDetails[]>([]);
	const [microphones, setMicrophones] = useState<MicrophoneWithDetails[]>([]);

	// Mirrors of `cameras`/`microphones` read synchronously inside the
	// effects below instead of the state values themselves — this is the
	// React equivalent of the Solid version's `untrack(() => cameras)`:
	// it lets the effect compare against the current list without taking
	// a reactive dependency on it (which would either force `cameras`
	// into the deps array — retriggering the effect on every update it
	// itself makes — or silently read a stale closure value otherwise).
	const camerasRef = useRef<CameraWithDetails[]>([]);
	const microphonesRef = useRef<MicrophoneWithDetails[]>([]);

	// Only the id/name list — per-device formats are fetched on demand via
	// useCameraFormats/useMicrophoneFormats above, not prefetched here.
	useEffect(() => {
		const rawCameras = query.data?.cameras ?? [];
		if (cameraListChanged(camerasRef.current, rawCameras)) {
			camerasRef.current = rawCameras;
			setCameras(rawCameras);
		}
	}, [query.data]);

	useEffect(() => {
		const rawMics = query.data?.microphones ?? [];
		if (micListChanged(microphonesRef.current, rawMics)) {
			const newMics: MicrophoneWithDetails[] = rawMics.map((name) => ({
				name,
			}));
			microphonesRef.current = newMics;
			setMicrophones(newMics);
		}
	}, [query.data]);

	return {
		cameras,
		microphones,
		permissions: query.data?.permissions,
		isPending: query.isPending,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
	};
}
