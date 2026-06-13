import { Cancel01Icon } from "@/components/icons";
import { CropControl } from "@/components/editor/CropControl";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import type { CropRegion } from "@/types/editor";
import type { AspectRatio } from "@electron/utils/aspectRatioUtils";

interface CropEditorDialogProps {
  open: boolean;
  videoElement: HTMLVideoElement | null;
  cropRegion: CropRegion;
  aspectRatio: AspectRatio;
  onCropChange: (cropRegion: CropRegion) => void;
  onCancel: () => void;
  onDone: () => void;
}

export function CropEditorDialog({
  open,
  videoElement,
  cropRegion,
  aspectRatio,
  onCropChange,
  onCancel,
  onDone,
}: CropEditorDialogProps) {
  const { t } = useI18n();

  if (!open) {
    return null;
  }

  return (
    <>
      {/* Backdrop — no blur, clean black */}
      <div
        className="fixed inset-0 z-50 bg-black/55 animate-in fade-in duration-150"
        onClick={onCancel}
      />

      {/* Dialog — 3-zone layout: header / content / footer */}
      <div className="fixed left-1/2 top-1/2 z-60 max-h-[90vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-foreground/8 bg-card shadow-xl animate-in zoom-in-95 fade-in duration-200 ease-out">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-foreground/6 px-7 py-5">
          <div className="space-y-1">
            <h2 className="text-[15px] font-medium tracking-tight text-foreground">
              {t("settings.crop.title")}
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground text-balance">
              {t("settings.crop.instruction")}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="ml-6 mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors duration-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <Cancel01Icon className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-7 py-6">
          <CropControl
            videoElement={videoElement}
            cropRegion={cropRegion}
            onCropChange={onCropChange}
            aspectRatio={aspectRatio}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-foreground/6 px-7 py-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={onDone} size="sm">
            {t("common.actions.done")}
          </Button>
        </div>
      </div>
    </>
  );
}
