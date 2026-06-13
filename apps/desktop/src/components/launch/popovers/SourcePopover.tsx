import { useCallback, useMemo, type ReactNode, useState } from "react";
import { SourceSelector } from "../source-selector";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import {
  mapRawSource,
  isScreenSource,
  isWindowSource,
  type DesktopSource,
} from "./launchPopoverTypes";

const POPOVER_ID = "sources";

export function SourcePopover({
  trigger,
  selectedSource,
  onSourceSelect,
  onOpen,
}: {
  trigger: ReactNode;
  selectedSource: string;
  onSourceSelect: (source: DesktopSource) => Promise<void> | void;
  onOpen?: () => void;
}) {
  const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(false);
  const open = isOpen(POPOVER_ID);

  // Two-phase fetch: a thumbnail-less list renders the picker instantly, then
  // the full call streams in thumbnails/icons. See SourceSelector for details —
  // `desktopCapturer.getSources` otherwise blocks ~1s capturing thumbnails.
  const fetchSources = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      try {
        const fastSources = await window.electronAPI.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 1, height: 1 },
          fetchWindowIcons: false,
        });
        setSources(fastSources.map((s) => mapRawSource(s as DesktopSource)));
      } catch (fastError) {
        console.warn("Fast source prefetch failed:", fastError);
      } finally {
        setLoading(false);
      }

      const rawSources = await window.electronAPI.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 160, height: 100 },
        fetchWindowIcons: true,
      });
      setSources(rawSources.map((s) => mapRawSource(s as DesktopSource)));
    } catch (error) {
      console.error("Failed to fetch sources:", error);
      setLoading(false);
    }
  }, []);

  const screenSources = useMemo(
    () => sources.filter(isScreenSource),
    [sources],
  );
  const windowSources = useMemo(
    () => sources.filter(isWindowSource),
    [sources],
  );

  return (
    <SourceSelector
      screenSources={screenSources}
      windowSources={windowSources}
      selectedSource={selectedSource}
      loading={loading}
      onSourceSelect={async (source) => {
        try {
          await onSourceSelect(source);
          requestClose(POPOVER_ID);
        } catch (error) {
          console.error("Failed to select source:", error);
        }
      }}
      onFetchSources={fetchSources}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose(POPOVER_ID);
          return;
        }
        onOpen?.();
        requestOpen(POPOVER_ID);
      }}
    >
      {trigger}
    </SourceSelector>
  );
}
