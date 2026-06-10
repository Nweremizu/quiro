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
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-stone-100",
        "cursor-pointer transition-[background-color,color] duration-150 ease-out hover:bg-white/10",
        selected ? "bg-primary/20 text-primary" : "",
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
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-stone-100",
        "cursor-pointer transition-[background-color,color] duration-150 ease-out hover:bg-white/10",
        selected ? "bg-primary/20 text-primary" : "",
      )}
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
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const { onMouseEnter } = useHudInteraction();
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn(
          "source-selector-scroll min-w-75! max-w-200! max-h-100 overflow-y-auto rounded-xl border border-white/10",
          "bg-[#171411]/95 p-2 text-stone-100 shadow-[0_24px_70px_rgba(13,12,10,0.42),0_8px_24px_rgba(13,12,10,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]",
          "backdrop-blur-xl backdrop-saturate-125",
          "mt-auto mb-2 pointer-events-auto",
          "no-drag",
          className,
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
