import type { ReactNode } from "react";
import { InformationCircleIcon } from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  children?: ReactNode;
  label?: string;
  className?: string;
  contentClassName?: string;
}

export function InfoTooltip({
  children,
  label = "More information",
  className,
  contentClassName,
}: InfoTooltipProps) {
  if (!children) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          className,
        )}
      >
        <InformationCircleIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent
        align="start"
        side="top"
        sideOffset={7}
        className={cn(
          "max-w-56 rounded-lg px-2.5 py-2 text-[11px] leading-4",
          contentClassName,
        )}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
