import Scrubber from "@/components/ui/scrubber";

interface CropSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  isCropped: boolean;
  resetCropSection: () => void;
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
  setCropInset: (side: "top" | "bottom" | "left" | "right", v: number) => void;
}

export function CropSection({
  tSettings,
  t,
  isCropped,
  resetCropSection,
  cropTop,
  cropBottom,
  cropLeft,
  cropRight,
  setCropInset,
}: CropSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tSettings("sections.crop", "Crop")}
        </div>
        {isCropped ? (
          <button
            type="button"
            onClick={resetCropSection}
            className="text-[10px] text-primary transition-opacity hover:opacity-80"
          >
            {t("common.actions.reset", "Reset")}
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Scrubber
          label={tSettings("crop.top", "Top")}
          value={cropTop}
          defaultValue={0}
          min={0}
          max={50}
          step={1}
          onValueChange={(v) => setCropInset("top", v)}
          decimals={0}
          suffix="%"
        />
        <Scrubber
          label={tSettings("crop.bottom", "Bottom")}
          value={cropBottom}
          defaultValue={0}
          min={0}
          max={50}
          step={1}
          onValueChange={(v) => setCropInset("bottom", v)}
          decimals={0}
          suffix="%"
        />
        <Scrubber
          label={tSettings("crop.left", "Left")}
          value={cropLeft}
          defaultValue={0}
          min={0}
          max={50}
          step={1}
          onValueChange={(v) => setCropInset("left", v)}
          decimals={0}
          suffix="%"
        />
        <Scrubber
          label={tSettings("crop.right", "Right")}
          value={cropRight}
          defaultValue={0}
          min={0}
          max={50}
          step={1}
          onValueChange={(v) => setCropInset("right", v)}
          decimals={0}
          suffix="%"
        />
      </div>
    </section>
  );
}

export default CropSection;
