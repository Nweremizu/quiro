import { ArrowDown01Icon, Tick02Icon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ASPECT_RATIOS,
  type AspectRatio,
  getAspectRatioLabel,
} from "@electron/utils/aspectRatioUtils";

interface AspectRatioDropdownProps {
  aspectRatio: AspectRatio;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
}

export function AspectRatioDropdown({
  aspectRatio,
  onAspectRatioChange,
}: AspectRatioDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
        <ArrowDown01Icon className="w-3 h-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="bg-card border-subtle shadow-soft-md"
      >
        <DropdownMenuGroup>
          {ASPECT_RATIOS.map((ratio) => (
            <DropdownMenuItem
              key={ratio}
              onClick={() => onAspectRatioChange(ratio)}
              className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer flex items-center justify-between gap-3"
            >
              <span>{getAspectRatioLabel(ratio)}</span>
              {aspectRatio === ratio ? (
                <Tick02Icon className="w-3 h-3 text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
