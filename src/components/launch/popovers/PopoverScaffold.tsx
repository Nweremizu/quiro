import {
  Mic01Icon as Microphone01Icon,
  MicOff01Icon as MicrophoneSlash01Icon,
} from "@/components/icons/generated";
import type { ReactElement, ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import styles from "../LaunchWindow.module.css";
import type { DeviceOption } from "./launchPopoverTypes";
import { useHudInteraction } from "@/contexts/launch/HudInteractionContext";
import { cn } from "@/lib/utils";

export function DropdownItem({
  onClick,
  selected,
  icon,
  children,
  trailing,
}: {
  onClick: () => void;
  selected?: boolean;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-2xl px-2 py-2.5 text-left text-foreground",
        "cursor-pointer transition-colors duration-150 ease-out hover:bg-accent/60",
        selected ? "bg-accent/70" : "",
      )}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
      {trailing}
    </button>
  );
}

export function MicDeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: DeviceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { level } = useAudioLevelMeter({
    enabled: true,
    deviceId: device.deviceId,
  });

  return (
    <button
      type="button"
      className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
      onClick={onSelect}
    >
      <span className="shrink-0">
        {selected ? (
          <Microphone01Icon size={16} />
        ) : (
          <MicrophoneSlash01Icon size={16} />
        )}
      </span>
      <span className="flex-1 truncate">{device.label}</span>
      <AudioLevelMeter level={level} className="w-16 shrink-0" />
    </button>
  );
}

export function HudPopover({
  open,
  onOpenChange,
  trigger,
  children,
  align = "center",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const { onMouseEnter } = useHudInteraction();
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn(
          "source-selector-scroll w-75 max-h-100 overflow-y-auto rounded-2xl border border-border",
          "bg-popover p-2 text-popover-foreground shadow-2xl",
          "backdrop-blur-md backdrop-saturate-150",
          "mt-auto mb-2 pointer-events-auto",
          styles.electronNoDrag,
        )}
        side="top"
        align={align}
        sideOffset={8}
        // usePortal={false}
        onMouseEnter={onMouseEnter}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
