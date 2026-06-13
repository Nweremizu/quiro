import { ArrowDown01Icon, PlusSignIcon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/contexts/I18nContext";

interface AddLayerDropdownProps {
  onAddAnnotation: () => void;
  onAddAudio: () => void;
}

export function AddLayerDropdown({
  onAddAnnotation,
  onAddAudio,
}: AddLayerDropdownProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <PlusSignIcon className="w-3.5 h-3.5" />
        <span className="font-medium">{t("editor.toolbar.addLayer")}</span>
        <ArrowDown01Icon className="w-3 h-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="bg-background border-border shadow-soft-md"
      >
        <DropdownMenuItem
          onClick={onAddAnnotation}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
        >
          {t("timeline.annotation.label")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onAddAudio}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
        >
          {t("timeline.audio.label")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
