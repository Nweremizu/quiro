import { queryOptions, useMutation } from "@tanstack/react-query";
import {
  commands,
  DeviceOrModelID,
  RecordingMode,
  RecordingTargetMode,
  ScreenCaptureTarget,
  type RecordingMetaWithMetadata,
  type ScreenshotMetaWithMetadata,
} from "./tauri";

// Hand-written, not generated — mirrors the pattern in devices.tsx. Trimmed
// to the commands this backend actually has: no thumbnails needed for
// recordings/screenshots (no reliable preview image path in this project
// structure), no cloud/upload fields.

export type RecordingWithPath = RecordingMetaWithMetadata & { path: string };
export type ScreenshotWithPath = ScreenshotMetaWithMetadata & { path: string };

import { useCallback, useEffect, useState } from "react";
import { recordingSettingsStore } from "@/store";
import { useRecordingOptions } from "@/routes/launch/options-context";
import { getCurrentWindow } from "@tauri-apps/api/window";

type CameraCaptureTarget = ScreenCaptureTarget | { variant: "cameraOnly" };
type ExtendedRecordingTargetMode = RecordingTargetMode | "camera" | null;
type RecordingTargetModeSource = "main" | "editor" | "editorRecording" | null;

export type TargetModeDismissal =
  "recordingStudio" | "screenshot" | "superseded" | "cancelled";

export function createOptionsQuery() {
  const PERSIST_KEY = "recording-options-query-2";

  type OptionsState = {
    captureTarget: CameraCaptureTarget;
    micName: string | null;
    mode: RecordingMode;
    captureSystemAudio?: boolean;
    targetMode?: ExtendedRecordingTargetMode;
    targetModeSource?: RecordingTargetModeSource;
    targetModeDismissal?: TargetModeDismissal | null;
    cameraID?: DeviceOrModelID | null;
    organizationId?: string | null;
    /** @deprecated */
    cameraLabel: string | null;
  };

  const [state, setState] = useState<OptionsState>(() => {
    try {
      const persisted = localStorage.getItem(PERSIST_KEY);

      if (persisted) {
        return {
          captureTarget: { variant: "display", id: "0" },
          micName: null,
          cameraLabel: null,
          mode: "studio",
          organizationId: null,
          ...JSON.parse(persisted),
        };
      }
    } catch {
      // Ignore invalid persisted state
    }

    return {
      captureTarget: { variant: "display", id: "0" },
      micName: null,
      cameraLabel: null,
      mode: "studio",
      organizationId: null,
    };
  });

  const [initialized, setInitialized] = useState(false);

  // Load persisted settings from the recording settings store.
  useEffect(() => {
    let cancelled = false;

    recordingSettingsStore.get().then((data) => {
      if (cancelled || !data) {
        if (!cancelled) {
          setInitialized(true);
        }
        return;
      }

      // @ts-ignore
      setState((current) => ({
        ...current,
        ...(data.target !== undefined && {
          captureTarget: data.target,
        }),
        ...(data.micName !== undefined && {
          micName: data.micName,
        }),
        ...(data.cameraId !== undefined && {
          cameraID: data.cameraId,
        }),
        ...(data.mode !== undefined && {
          mode: data.mode,
        }),
        ...(data.systemAudio !== undefined && {
          captureSystemAudio: data.systemAudio,
        }),
      }));

      setInitialized(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage.
  useEffect(() => {
    if (!initialized) return;

    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
    } catch {
      // Ignore localStorage errors
    }
  }, [state, initialized]);

  // Persist recording settings.
  useEffect(() => {
    if (!initialized) return;

    const settings = {
      target: state.captureTarget,
      micName: state.micName,
      cameraId: state.cameraID,
      mode: state.mode,
      systemAudio: state.captureSystemAudio,
      organizationId: state.organizationId,
    };

    recordingSettingsStore.set(settings);
  }, [
    state.captureTarget,
    state.micName,
    state.cameraID,
    state.mode,
    state.captureSystemAudio,
    state.organizationId,
    initialized,
  ]);

  // Listen for localStorage changes from other windows/tabs.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PERSIST_KEY || !event.newValue) return;

      try {
        const nextState = JSON.parse(event.newValue);

        setState((current) => ({
          ...current,
          ...nextState,
        }));
      } catch {
        // Ignore invalid persisted state
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Listen for changes from the recording settings store.
  useEffect(() => {
    let cancelled = false;

    const cleanupPromise = recordingSettingsStore.listen((data) => {
      if (cancelled || !data) return;

      setState((current) => {
        const next = { ...current };

        if (data.mode && data.mode !== current.mode) {
          next.mode = data.mode;
        }

        return next;
      });
    });

    return () => {
      cancelled = true;

      cleanupPromise.then((cleanup) => {
        cleanup();
      });
    };
  }, []);

  const setOptions = useCallback(
    (
      update:
        | Partial<OptionsState>
        | ((previous: OptionsState) => Partial<OptionsState>),
    ) => {
      setState((current) => {
        const changes = typeof update === "function" ? update(current) : update;

        return {
          ...current,
          ...changes,
        };
      });
    },
    [],
  );

  return {
    rawOptions: state,
    setOptions,
  };
}

export const listCaptureDisplaysQuery = queryOptions({
  queryKey: ["captureDisplays"] as const,
  queryFn: () => commands.listCaptureDisplays(),
  staleTime: 5_000,
});

export const listCaptureWindowsQuery = queryOptions({
  queryKey: ["captureWindows"] as const,
  queryFn: () => commands.listCaptureWindows(),
  staleTime: 5_000,
});

export const listRecordingsQuery = queryOptions({
  queryKey: ["recordings"] as const,
  queryFn: async (): Promise<RecordingWithPath[]> => {
    const rows = await commands.listRecordings();
    return rows
      .map(([path, meta]) => ({ ...meta, path }))
      .sort((a, b) => b.sortTimeMillis - a.sortTimeMillis);
  },
  staleTime: 5_000,
});

export const listScreenshotsQuery = queryOptions({
  queryKey: ["screenshots"] as const,
  queryFn: async (): Promise<ScreenshotWithPath[]> => {
    const rows = await commands.listScreenshots();
    return rows
      .map(([path, meta]) => ({ ...meta, path }))
      .sort((a, b) => b.sortTimeMillis - a.sortTimeMillis);
  },
  staleTime: 5_000,
});

export const permissionsQuery = queryOptions({
  queryKey: ["permissions"] as const,
  queryFn: () => commands.doPermissionsCheck(false),
  staleTime: 10_000,
});

export const listScreens = queryOptions({
  queryKey: ["capture", "displays"] as const,
  queryFn: () => commands.listCaptureDisplays(),
  refetchInterval: 10_000,
  staleTime: 5_000,
});

export const listWindows = queryOptions({
  queryKey: ["capture", "windows"] as const,
  queryFn: async () => {
    const w = await commands.listCaptureWindows();

    w.sort(
      (a, b) =>
        a.owner_name.localeCompare(b.owner_name) ||
        a.name.localeCompare(b.name),
    );

    return w;
  },
  refetchInterval: false,
});

export const listWindowsWithThumbnails = queryOptions({
  queryKey: ["capture", "windows-thumbnails"] as const,
  queryFn: async () => {
    const w = await commands.listWindowsWithThumbnails();

    w.sort(
      (a, b) =>
        a.owner_name.localeCompare(b.owner_name) ||
        a.name.localeCompare(b.name),
    );

    return w;
  },
  refetchInterval: false,
});

export const listDisplaysWithThumbnails = queryOptions({
  queryKey: ["capture", "displays-thumbnails"] as const,
  queryFn: () => commands.listDisplaysWithThumbnails(),
  refetchInterval: 10_000,
  staleTime: 5_000,
});

export const isSystemAudioSupported = queryOptions({
  queryKey: ["systemAudioSupported"] as const,
  queryFn: () => commands.isSystemAudioCaptureSupported(),
  staleTime: Number.POSITIVE_INFINITY, // This won't change during runtime
});

export function createCameraMutation() {
  const { setOptions, rawOptions } = useRecordingOptions();

  const rawMutate = async (
    model: DeviceOrModelID | null,
    skipCameraWindow?: boolean,
  ) => {
    const before = rawOptions.cameraID ? { ...rawOptions.cameraID } : null;
    setOptions({ cameraID: model });
    await commands
      .setCameraInput(model, skipCameraWindow ?? null)
      .catch(async (e) => {
        const message =
          typeof e === "string"
            ? e
            : e instanceof Error
              ? e.message
              : String(e);

        if (
          message.includes("DeviceNotFound") ||
          message.includes("CameraTimeout") ||
          message.includes("Failed to initialize camera")
        ) {
          setOptions({ cameraID: null });
          console.warn("Selected camera is unavailable.");
          return;
        }

        if (JSON.stringify(before) === JSON.stringify(model) || !before) {
          setOptions({ cameraID: null });
        } else setOptions({ cameraID: before });

        throw e;
      });

    if (model && !skipCameraWindow) {
      getCurrentWindow().setFocus();
    }
  };

  const setCameraInput = useMutation({
    mutationFn: (args: {
      model: DeviceOrModelID | null;
      skipCameraWindow?: boolean;
    }) => rawMutate(args.model, args.skipCameraWindow),
  });

  return new Proxy(
    setCameraInput as typeof setCameraInput & { rawMutate: typeof rawMutate },
    {
      get(target, key) {
        if (key === "rawMutate") return rawMutate;
        return Reflect.get(target, key);
      },
    },
  );
}
