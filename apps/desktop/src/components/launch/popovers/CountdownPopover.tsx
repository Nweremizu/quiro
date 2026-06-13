import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { Timer01Icon } from "@/components/icons";

const POPOVER_ID = "countdown";
const COUNTDOWN_OPTIONS = [0, 3, 5, 10];

export function CountdownPopover({
  trigger,
  countdownDelay,
  onSelectDelay,
}: {
  trigger: ReactElement;
  countdownDelay: number;
  onSelectDelay: (delay: number) => void;
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
        requestOpen(POPOVER_ID);
      }}
      trigger={trigger}
      align="center"
    >
      <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
        {t("recording.countdownDelay")}
      </div>
      {COUNTDOWN_OPTIONS.map((delay) => (
        <DropdownItem
          key={delay}
          icon={<Timer01Icon size={16} />}
          selected={countdownDelay === delay}
          onClick={() => {
            onSelectDelay(delay);
            requestClose(POPOVER_ID);
          }}
        >
          {delay === 0 ? t("recording.noDelay") : `${delay}s`}
        </DropdownItem>
      ))}
    </HudPopover>
  );
}
