import {
  MicOff01Icon as MicrophoneSlash01Icon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from "@/components/icons/generated";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import type { ReactElement } from "react";

const POPOVER_ID = "mic";

export function MicPopover({
  trigger,
  disabled,
  systemAudioEnabled,
  onToggleSystemAudio,
  microphoneEnabled,
  onDisableMicrophone,
  devices,
  microphoneDeviceId,
  selectedDeviceId,
  onSelectDevice,
}: {
  trigger: ReactElement;
  disabled?: boolean;
  systemAudioEnabled: boolean;
  onToggleSystemAudio: () => void;
  microphoneEnabled: boolean;
  onDisableMicrophone: () => void;
  devices: DeviceOption[];
  microphoneDeviceId?: string;
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
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
      align="start"
    >
      <div
        className={
          "text-[10px] font-semibold text-foreground uppercase p-1 pt-2.5"
        }
      >
        {t("recording.microphone")}
      </div>
      <DropdownItem
        icon={
          systemAudioEnabled ? (
            <VolumeHighIcon size={16} />
          ) : (
            <VolumeMute02Icon size={16} />
          )
        }
        selected={systemAudioEnabled}
        onClick={onToggleSystemAudio}
      >
        {systemAudioEnabled
          ? t("recording.disableSystemAudio")
          : t("recording.enableSystemAudio")}
      </DropdownItem>
      {microphoneEnabled && (
        <DropdownItem
          icon={<MicrophoneSlash01Icon size={16} />}
          onClick={() => {
            onDisableMicrophone();
            requestClose(POPOVER_ID);
          }}
        >
          {t("recording.turnOffMicrophone")}
        </DropdownItem>
      )}
      {!microphoneEnabled && (
        <div className="px-3 py-2 text-xs text-foreground font-medium">
          {t("recording.selectMicToEnable")}
        </div>
      )}
      {devices.map((device) => (
        <MicDeviceRow
          key={device.deviceId}
          device={device}
          selected={
            microphoneEnabled &&
            (microphoneDeviceId === device.deviceId ||
              selectedDeviceId === device.deviceId)
          }
          onSelect={() => onSelectDevice(device.deviceId)}
        />
      ))}
      {devices.length === 0 && (
        <div className="py-4 text-center text-xs text-white/70">
          {t("recording.noMicrophonesFound")}
        </div>
      )}
    </HudPopover>
  );
}
