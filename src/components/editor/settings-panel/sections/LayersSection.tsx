import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  AnnotationRegion,
  AutoCaptionSettings,
  WebcamOverlaySettings,
  ZoomRegion,
} from "@/types/editor";
import type { ProjectSnapshot } from "@/components/editor/utils/project-persistance";
import { SectionLabel } from "../SectionLabel";
import { InfoTooltip } from "../shared";

interface LayersSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  zoomRegions: ZoomRegion[];
  annotationRegions: AnnotationRegion[];
  autoCaptionSettings?: AutoCaptionSettings;
  showCursor: boolean;
  webcam?: WebcamOverlaySettings;
  projectSnapshots: ProjectSnapshot[];
  selectedZoomId?: string | null;
  selectedAnnotationId?: string | null;
  onZoomVisibilityChange?: (id: string, enabled: boolean) => void;
  onAnnotationVisibilityChange?: (id: string, visible: boolean) => void;
  onAnnotationReorder?: (id: string, direction: "up" | "down") => void;
  onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
  onShowCursorChange?: (enabled: boolean) => void;
  onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
  onCreateProjectSnapshot?: () => void;
  onRestoreProjectSnapshot?: (id: string) => void;
}

function LayerRow({
  title,
  meta,
  active,
  selected,
  checked,
  onCheckedChange,
  actions,
}: {
  title: string;
  meta?: string;
  active?: boolean;
  selected?: boolean;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1.5 py-2",
        selected && "bg-primary/[0.06]",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              active ? "bg-primary" : "bg-muted-foreground/35",
            )}
          />
          <span className="truncate text-[11px] font-medium leading-4 text-foreground">
            {title}
          </span>
        </div>
        {meta ? (
          <p className="ml-3.5 mt-0.5 truncate text-[10px] leading-3 text-muted-foreground/70">
            {meta}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="scale-75 data-[state=checked]:bg-primary"
        />
      </div>
    </div>
  );
}

export function LayersSection({
  tSettings,
  zoomRegions,
  annotationRegions,
  autoCaptionSettings,
  showCursor,
  webcam,
  projectSnapshots,
  selectedZoomId,
  selectedAnnotationId,
  onZoomVisibilityChange,
  onAnnotationVisibilityChange,
  onAnnotationReorder,
  onAutoCaptionSettingsChange,
  onShowCursorChange,
  onWebcamChange,
  onCreateProjectSnapshot,
  onRestoreProjectSnapshot,
}: LayersSectionProps) {
  const sortedAnnotations = [...annotationRegions].sort(
    (left, right) => right.zIndex - left.zIndex,
  );
  const sortedZooms = [...zoomRegions].sort(
    (left, right) => left.startMs - right.startMs,
  );

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>{tSettings("sections.layers", "Layers")}</SectionLabel>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground/70">
            {tSettings(
              "effects.layersHint",
              "Control visibility, annotation order, camera effects, and restore points.",
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCreateProjectSnapshot}
          className="h-7 px-2 text-[10px] text-primary"
        >
          {tSettings("effects.createSnapshot", "Snapshot")}
        </Button>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{tSettings("effects.overlayLayers", "Overlays")}</SectionLabel>
          <InfoTooltip>
            {tSettings(
              "effects.overlayLayersHint",
              "Singleton overlays are visible controls; annotation order is handled below.",
            )}
          </InfoTooltip>
        </div>
        <div className="space-y-1">
          <LayerRow
            title={tSettings("sections.captions", "Captions")}
            active={(autoCaptionSettings?.enabled ?? false) && true}
            checked={autoCaptionSettings?.enabled ?? false}
            onCheckedChange={(enabled) =>
              autoCaptionSettings &&
              onAutoCaptionSettingsChange?.({
                ...autoCaptionSettings,
                enabled,
              })
            }
          />
          <LayerRow
            title={tSettings("sections.cursor", "Cursor")}
            active={showCursor}
            checked={showCursor}
            onCheckedChange={onShowCursorChange}
          />
          <LayerRow
            title={tSettings("sections.webcam", "Webcam")}
            active={webcam?.enabled ?? false}
            checked={webcam?.enabled ?? false}
            onCheckedChange={(enabled) =>
              webcam && onWebcamChange?.({ ...webcam, enabled })
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{tSettings("effects.cameraEffects", "Camera Effects")}</SectionLabel>
          <InfoTooltip>
            {tSettings(
              "effects.cameraEffectsHint",
              "Zooms are camera effects, so they can be toggled but are not stacked above visual overlays.",
            )}
          </InfoTooltip>
        </div>
        <div className="space-y-1">
          {sortedZooms.length === 0 ? (
            <p className="px-1.5 text-[10px] text-muted-foreground/70">
              {tSettings("effects.noZoomLayers", "No zoom regions yet.")}
            </p>
          ) : (
            sortedZooms.map((region) => (
              <LayerRow
                key={region.id}
                title={region.presetId ?? tSettings("sections.zoom", "Zoom")}
                meta={`${Math.round(region.startMs / 1000)}s - ${Math.round(region.endMs / 1000)}s`}
                selected={region.id === selectedZoomId}
                active={region.enabled !== false}
                checked={region.enabled !== false}
                onCheckedChange={(enabled) =>
                  onZoomVisibilityChange?.(region.id, enabled)
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{tSettings("sections.annotations", "Annotations")}</SectionLabel>
          <InfoTooltip>
            {tSettings(
              "effects.annotationLayerHint",
              "Higher annotations render above lower annotations in preview and export.",
            )}
          </InfoTooltip>
        </div>
        <div className="space-y-1">
          {sortedAnnotations.length === 0 ? (
            <p className="px-1.5 text-[10px] text-muted-foreground/70">
              {tSettings("effects.noAnnotationLayers", "No annotations yet.")}
            </p>
          ) : (
            sortedAnnotations.map((annotation) => (
              <LayerRow
                key={annotation.id}
                title={
                  annotation.type === "text"
                    ? annotation.content || "Text"
                    : annotation.type
                }
                meta={`z ${annotation.zIndex}`}
                selected={annotation.id === selectedAnnotationId}
                active={annotation.visible !== false}
                checked={annotation.visible !== false}
                onCheckedChange={(visible) =>
                  onAnnotationVisibilityChange?.(annotation.id, visible)
                }
                actions={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onAnnotationReorder?.(annotation.id, "up")}
                      className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAnnotationReorder?.(annotation.id, "down")
                      }
                      className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Down
                    </button>
                  </div>
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <SectionLabel>{tSettings("effects.snapshots", "Snapshots")}</SectionLabel>
          <InfoTooltip>
            {tSettings(
              "effects.snapshotsHint",
              "Restore points are capped at the newest 20 project states.",
            )}
          </InfoTooltip>
        </div>
        <div className="space-y-1">
          {projectSnapshots.length === 0 ? (
            <p className="px-1.5 text-[10px] text-muted-foreground/70">
              {tSettings("effects.noSnapshots", "No snapshots saved yet.")}
            </p>
          ) : (
            projectSnapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-foreground">
                    {snapshot.name}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground/70">
                    {new Date(snapshot.createdAt).toLocaleString()} ·{" "}
                    {snapshot.reason}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRestoreProjectSnapshot?.(snapshot.id)}
                  className="h-7 px-2 text-[10px]"
                >
                  {tSettings("effects.restore", "Restore")}
                </Button>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

export default LayersSection;
