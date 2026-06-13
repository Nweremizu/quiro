import Scrubber from "@/components/ui/scrubber";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Padding } from "@/types/editor";
import { DEFAULT_PADDING } from "@/types/editor";

interface AvailableFrame {
  id: string;
  label: string;
  thumbnailPath: string;
}

interface FrameSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  resetFrameSection: () => void;
  shadowIntensity: number;
  initialShadowDefault: number;
  onShadowChange?: (v: number) => void;
  borderRadius: number;
  initialBorderRadiusDefault: number;
  onBorderRadiusChange?: (v: number) => void;
  padding: Padding;
  togglePaddingLink: () => void;
  handlePaddingSideChange: (side: keyof Padding, v: number) => void;
  removeBackgroundEnabled: boolean;
  handleRemoveBackgroundToggle: (v: boolean) => void;
  availableFrames: AvailableFrame[];
  frame: string | null;
  onFrameChange?: (id: string | null) => void;
  showDevMotionControls: boolean;
}

export function FrameSection({
  tSettings,
  t,
  resetFrameSection,
  shadowIntensity,
  initialShadowDefault,
  onShadowChange,
  borderRadius,
  initialBorderRadiusDefault,
  onBorderRadiusChange,
  padding,
  togglePaddingLink,
  handlePaddingSideChange,
  removeBackgroundEnabled,
  handleRemoveBackgroundToggle,
  availableFrames,
  frame,
  onFrameChange,
}: FrameSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tSettings("sections.frame", "Frame")}
        </div>
        <button
          type="button"
          onClick={resetFrameSection}
          className="text-[10px] text-primary transition-opacity hover:opacity-80"
        >
          {t("common.actions.reset", "Reset")}
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Scrubber
          label={tSettings("effects.shadow")}
          value={shadowIntensity}
          defaultValue={initialShadowDefault}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(v) => onShadowChange?.(v)}
          valueFormatter={(v) => `${Math.round(v * 100)}%`}
        />
        <Scrubber
          label={tSettings("effects.radius", "Radius")}
          value={borderRadius}
          defaultValue={initialBorderRadiusDefault}
          min={0}
          max={200}
          step={0.5}
          onValueChange={(v) => onBorderRadiusChange?.(v)}
          decimals={1}
          suffix="px"
        />
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">
              {tSettings("effects.padding")}
            </div>
            <button
              type="button"
              onClick={togglePaddingLink}
              aria-pressed={padding.linked === false}
              className="text-[10px] text-primary transition-opacity hover:opacity-80"
              title={
                padding.linked === false
                  ? tSettings(
                      "effects.paddingAdvancedHide",
                      "Hide advanced padding controls",
                    )
                  : tSettings(
                      "effects.paddingAdvancedShow",
                      "Show advanced padding controls",
                    )
              }
            >
              {tSettings("effects.paddingAdvanced", "Advanced")}
            </button>
          </div>

          {padding.linked !== false ? (
            <Scrubber
              label=""
              value={padding.top}
              defaultValue={DEFAULT_PADDING.top}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => handlePaddingSideChange("top", v)}
              decimals={0}
              suffix="%"
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Scrubber
                label={tSettings("effects.paddingTop", "Top")}
                value={padding.top}
                defaultValue={DEFAULT_PADDING.top}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => handlePaddingSideChange("top", v)}
                decimals={0}
              suffix="%"
              />
              <Scrubber
                label={tSettings("effects.paddingBottom", "Bottom")}
                value={padding.bottom}
                defaultValue={DEFAULT_PADDING.bottom}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => handlePaddingSideChange("bottom", v)}
                decimals={0}
              suffix="%"
              />
              <Scrubber
                label={tSettings("effects.paddingLeft", "Left")}
                value={padding.left}
                defaultValue={DEFAULT_PADDING.left}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => handlePaddingSideChange("left", v)}
                decimals={0}
              suffix="%"
              />
              <Scrubber
                label={tSettings("effects.paddingRight", "Right")}
                value={padding.right}
                defaultValue={DEFAULT_PADDING.right}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => handlePaddingSideChange("right", v)}
                decimals={0}
              suffix="%"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {tSettings("effects.removeBackground")}
          </span>
          <Switch
            checked={removeBackgroundEnabled}
            onCheckedChange={handleRemoveBackgroundToggle}
            className="data-[state=checked]:bg-primary scale-75"
          />
        </div>

        {availableFrames.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Frame</span>
              {frame && (
                <button
                  type="button"
                  onClick={() => onFrameChange?.(null)}
                  className="text-[9px] text-primary hover:opacity-80"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {availableFrames.map((f) => {
                const isSelected = frame === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onFrameChange?.(isSelected ? null : f.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all text-center",
                      isSelected
                        ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                        : "border-foreground/6 bg-white/2 hover:bg-foreground/[0.05]",
                    )}
                  >
                    <div className="w-full aspect-video rounded bg-foreground/10 overflow-hidden flex items-center justify-center">
                      <img
                        src={f.thumbnailPath}
                        alt={f.label}
                        className="w-full h-full object-contain"
                        draggable={false}
                      />
                    </div>
                    <span className="text-[8px] text-muted-foreground truncate w-full leading-tight">
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default FrameSection;
