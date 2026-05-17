import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";

interface NativeCaptureUnavailableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NativeCaptureUnavailableDialog({
  open,
  onOpenChange,
}: NativeCaptureUnavailableDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card shadow-lg border-(--border-default) text-foreground">
        <DialogHeader>
          <DialogTitle
            className={"text-[15px] font-semibold tracking-[-0.02em]"}
          >
            Nothing’s broken
          </DialogTitle>
          <DialogDescription className="text-muted-foreground leading-relaxed text-[13px]">
            {t(
              "editor.nativeCaptureUnavailable.description",
              "Your device does not support native capture. Recording still works normally, but advanced cursor smoothing and animated cursor overlays will be unavailable.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant={"outline"} onClick={() => onOpenChange(false)}>
            {t("editor.nativeCaptureUnavailable.confirm", "Okay")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
