import {
  ViewIcon,
  ViewOffIcon,
  Video01Icon as VideoReplayIcon,
  VideoOffIcon as VideoReplaySlashIcon,
} from "@/components/icons/generated";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import {
  WEBCAM_PREVIEW_SHAPES,
  WEBCAM_SHAPE_CLASSES,
  type WebcamPreviewShape,
} from "@/components/launch/webcam-shape";
import type { ReactElement } from "react";

const POPOVER_ID = "webcam";

export function WebcamPopover({
  trigger,
  disabled,
  webcamEnabled,
  onDisableWebcam,
  canToggleFloatingPreview,
  showFloatingWebcamPreview,
  onToggleFloatingPreview,
  showWebcamControls,
  setWebcamPreviewNode,
  webcamPreviewShape,
  rectangleAspectRatio,
  onWebcamPreviewShapeChange,
  videoDevices,
  webcamDeviceId,
  selectedVideoDeviceId,
  onSelectVideoDevice,
}: {
  trigger: ReactElement;
  disabled?: boolean;
  webcamEnabled: boolean;
  onDisableWebcam: () => void;
  canToggleFloatingPreview: boolean;
  showFloatingWebcamPreview: boolean;
  onToggleFloatingPreview: () => void;
  showWebcamControls: boolean;
  setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
  webcamPreviewShape: WebcamPreviewShape;
  rectangleAspectRatio: number;
  onWebcamPreviewShapeChange: (shape: WebcamPreviewShape) => void;
  videoDevices: DeviceOption[];
  webcamDeviceId?: string;
  selectedVideoDeviceId?: string;
  onSelectVideoDevice: (deviceId: string) => void;
}) {
  const t = useScopedT("launch");
  const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
  const open = isOpen(POPOVER_ID);

  return (
    <HudPopover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose(POPOVER_ID);
          return;
        }
        if (disabled) {
          return;
        }
        requestOpen(POPOVER_ID);
      }}
      trigger={trigger}
      align="center"
    >
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("recording.webcam")}
      </div>
      {webcamEnabled && (
        <>
          <DropdownItem
            icon={<VideoReplaySlashIcon size={16} />}
            onClick={() => {
              onDisableWebcam();
              requestClose(POPOVER_ID);
            }}
          >
            {t("recording.turnOffWebcam")}
          </DropdownItem>
          {canToggleFloatingPreview ? (
            <DropdownItem
              icon={
                showFloatingWebcamPreview ? (
                  <ViewOffIcon size={16} />
                ) : (
                  <ViewIcon size={16} />
                )
              }
              selected={showFloatingWebcamPreview}
              onClick={onToggleFloatingPreview}
            >
              {showFloatingWebcamPreview
                ? t("recording.hideFloatingWebcamPreview")
                : t("recording.showFloatingWebcamPreview")}
            </DropdownItem>
          ) : null}
        </>
      )}
      {!webcamEnabled && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t("recording.selectWebcamToEnable")}
        </div>
      )}
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("recording.webcamShape", "Webcam shape")}
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-2">
        {WEBCAM_PREVIEW_SHAPES.map((shape) => {
          const isSelected = webcamPreviewShape === shape.value;
          return (
            <button
              key={shape.value}
              type="button"
              onClick={() => onWebcamPreviewShapeChange(shape.value)}
              className={
                "flex items-center gap-2 rounded-lg border px-2 py-2 text-xs transition-colors " +
                (isSelected
                  ? "border-foreground/20 bg-accent/70 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground")
              }
              aria-pressed={isSelected}
            >
              <span
                className={
                  "block h-4 w-4 border border-border/60 bg-muted/40 " +
                  (shape.value === "rectangle"
                    ? "rounded-md"
                    : shape.value === "circle"
                      ? "rounded-full"
                      : shape.value === "square"
                        ? "rounded-none"
                        : "rounded-[6px]")
                }
                style={
                  shape.value === "rectangle"
                    ? { width: "18px", height: "12px" }
                    : undefined
                }
              />
              <span className="truncate">{shape.label}</span>
            </button>
          );
        })}
      </div>
      {showWebcamControls && (
        <div className="flex justify-center px-3 py-2">
          <div
            className={
              "overflow-hidden bg-muted/40 ring-1 ring-border " +
              WEBCAM_SHAPE_CLASSES[webcamPreviewShape].preview
            }
            style={
              webcamPreviewShape === "rectangle"
                ? { aspectRatio: rectangleAspectRatio }
                : undefined
            }
          >
            <video
              ref={setWebcamPreviewNode}
              className="h-full w-full object-cover rounded-[inherit]"
              muted
              playsInline
              style={{ transform: "scaleX(-1)" }}
            />
          </div>
        </div>
      )}
      {videoDevices.map((device) => (
        <DropdownItem
          key={device.deviceId}
          icon={
            webcamEnabled &&
            (webcamDeviceId === device.deviceId ||
              selectedVideoDeviceId === device.deviceId) ? (
              <VideoReplayIcon size={16} />
            ) : (
              <VideoReplaySlashIcon size={16} />
            )
          }
          selected={
            webcamEnabled &&
            (webcamDeviceId === device.deviceId ||
              selectedVideoDeviceId === device.deviceId)
          }
          onClick={() => onSelectVideoDevice(device.deviceId)}
        >
          {device.label}
        </DropdownItem>
      ))}
      {videoDevices.length === 0 && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {t("recording.noWebcamsFound")}
        </div>
      )}
    </HudPopover>
  );
}
