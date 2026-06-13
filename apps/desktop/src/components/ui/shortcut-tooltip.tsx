import { Fragment } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useShortcuts } from "@/contexts/shortcut-context";
import {
  formatBindingParts,
  type ShortcutAction,
  type ShortcutBinding,
} from "@/lib/shortcuts";

interface ShortcutTooltipProps {
  /** The human-readable label shown in the tooltip */
  label: string;
  /** Configurable action — reads the live binding from shortcut context */
  action?: ShortcutAction;
  /** Override with a static binding (e.g. for fixed shortcuts not in the config) */
  binding?: ShortcutBinding;
  side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
  /** Must be a single React element — passed to TooltipTrigger via render prop */
  children: React.ReactElement;
}

/**
 * Wraps any button/trigger with a tooltip that shows its label and keyboard
 * shortcut (rendered as individual Kbd chips). Shortcut adapts automatically
 * when the user remaps configurable actions.
 *
 * Usage:
 *   <ShortcutTooltip label="Add Zoom" action="addZoom">
 *     <Button ...>...</Button>
 *   </ShortcutTooltip>
 *
 *   <ShortcutTooltip label="Suggest Zooms">   // no shortcut — label only
 *     <Button ...>...</Button>
 *   </ShortcutTooltip>
 */
export function ShortcutTooltip({
  label,
  action,
  binding: bindingOverride,
  side = "top",
  children,
}: ShortcutTooltipProps) {
  const { shortcuts, isMac } = useShortcuts();

  const binding = bindingOverride ?? (action ? shortcuts[action] : undefined);
  const parts = binding ? formatBindingParts(binding, isMac) : [];

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        <span>{label}</span>
        {parts.length > 0 && (
          <KbdGroup>
            {parts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span className="select-none text-[9px] text-background/40">
                    +
                  </span>
                )}
                <Kbd>{part}</Kbd>
              </Fragment>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
