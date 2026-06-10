/* eslint-disable react-refresh/only-export-components */
import Block from "@uiw/react-color-block";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Scrubber from "@/components/ui/scrubber";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import { cn } from "@/lib/utils";
import { useScopedT } from "../../contexts/I18nContext";
import { AddCustomFontDialog } from "./AddCustomFontDialog";
import { getArrowComponent } from "./ArrowSvgs";
import { SectionLabel } from "./settings-panel/SectionLabel";
import { InfoTooltip } from "./settings-panel/shared";
import type {
  AnnotationRegion,
  AnnotationAnimationSettings,
  AnnotationType,
  ArrowDirection,
  FigureData,
} from "@/types/editor";
import {
  DEFAULT_ANNOTATION_ANIMATION,
  DEFAULT_FIGURE_DATA,
} from "@/types/editor";
import { getAnnotationAnimationDurationMs } from "./utils/annotation-keyframes";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Image,
  Italic,
  SquareDashed,
  Trash2,
  Type,
  Underline,
} from "@hugeicons/core-free-icons";
import { ArrowDown01Icon, Upload01Icon } from "@/components/icons";

interface AnnotationSettingsPanelProps {
  annotation: AnnotationRegion;
  onContentChange: (content: string) => void;
  onTypeChange: (type: AnnotationType) => void;
  onStyleChange: (style: Partial<AnnotationRegion["style"]>) => void;
  onFigureDataChange?: (figureData: FigureData) => void;
  onBlurIntensityChange?: (intensity: number) => void;
  onBlurColorChange?: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  onScaleChange?: (scale: number) => void;
  onAnimationChange?: (animation: AnnotationAnimationSettings) => void;
  onAddKeyframe?: () => void;
  onDeleteKeyframe?: (keyframeId: string) => void;
  onDelete: () => void;
}

export const FONT_FAMILY_VALUES = [
  {
    value: "system-ui, -apple-system, sans-serif",
    labelKey: "fontStyles.classic",
  },
  { value: "Georgia, serif", labelKey: "fontStyles.editor" },
  { value: "Impact, Arial Black, sans-serif", labelKey: "fontStyles.strong" },
  { value: "Courier New, monospace", labelKey: "fontStyles.typewriter" },
  { value: "Brush Script MT, cursive", labelKey: "fontStyles.deco" },
  { value: "Arial, sans-serif", labelKey: "fontStyles.simple" },
  { value: "Verdana, sans-serif", labelKey: "fontStyles.modern" },
  { value: "Trebuchet MS, sans-serif", labelKey: "fontStyles.clean" },
];

export const FONT_SIZES = [
  12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128,
];

const COLOR_PALETTE = [
  "#f08030",
  "#ff922a",
  "#d4651a",
  "#b04c12",
  "#fff7ee",
  "#ffecd4",
  "#ffffff",
  "#fafaf8",
  "#a9a49a",
  "#5c5650",
  "#1a1714",
  "#000000",
  "#dc2626",
  "#16a34a",
  "#eab308",
  "#9333ea",
];

const ANIMATION_PRESETS: Array<{
  value: AnnotationAnimationSettings["presetId"];
  label: string;
  description: string;
}> = [
  {
    value: "none",
    label: "None",
    description: "No automatic entrance or exit.",
  },
  {
    value: "fade",
    label: "Fade",
    description: "Soft opacity in and out.",
  },
  {
    value: "rise",
    label: "Rise",
    description: "Lift into place with a short fade.",
  },
  {
    value: "pop",
    label: "Pop",
    description: "Scale in with spring tuning.",
  },
  {
    value: "slide-left",
    label: "Slide",
    description: "Enter from the left and leave cleanly.",
  },
  {
    value: "spotlight",
    label: "Spotlight",
    description: "Subtle emphasis scale and fade.",
  },
];

function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex items-center gap-1.5">
        <SectionLabel>{title}</SectionLabel>
        <InfoTooltip>{description}</InfoTooltip>
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  children,
  description,
}: {
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium leading-4 text-foreground">
      <span>{children}</span>
      <InfoTooltip>{description}</InfoTooltip>
    </div>
  );
}

function IconButton({
  isActive,
  label,
  children,
  onClick,
}: {
  isActive: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      aria-label={label}
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-foreground/4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        isActive &&
          "bg-primary text-primary-foreground hover:text-primary-foreground",
      )}
    >
      {children}
    </motion.button>
  );
}

function ColorPreview({
  color,
  transparent = false,
}: {
  color: string;
  transparent?: boolean;
}) {
  return (
    <span className="relative size-4 overflow-hidden rounded-full ring-1 ring-border/80">
      {transparent ? (
        <span className="absolute inset-0 checkerboard-bg opacity-60" />
      ) : null}
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
    </span>
  );
}

function ColorPicker({
  label,
  color,
  displayValue,
  clearLabel = "Clear",
  onChange,
  onClear,
}: {
  label: string;
  color: string;
  displayValue?: string;
  clearLabel?: string;
  onChange: (color: string) => void;
  onClear?: () => void;
}) {
  const isTransparent = color === "transparent";

  return (
    <Popover>
      <PopoverTrigger className="flex h-8 w-full items-center gap-2 rounded-md bg-foreground/4 px-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35">
        <ColorPreview
          color={isTransparent ? "transparent" : color}
          transparent={isTransparent}
        />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {displayValue ?? color}
        </span>
        <ArrowDown01Icon className="size-3 text-muted-foreground/70" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-65 gap-2 rounded-xl bg-popover p-3 shadow-xl ring-1 ring-border/70"
      >
        <div className="text-[11px] font-medium text-foreground">{label}</div>
        <Block
          color={isTransparent ? "#f08030" : color}
          colors={COLOR_PALETTE}
          onChange={(nextColor) => onChange(nextColor.hex)}
          style={{ borderRadius: "8px" }}
        />
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full rounded-md text-xs text-muted-foreground hover:bg-foreground/4"
            onClick={onClear}
          >
            {clearLabel}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function BlurColorButton({
  label,
  color,
  selected,
  onClick,
  children,
}: {
  label: string;
  color?: string;
  selected: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative size-8 overflow-hidden rounded-full ring-1 ring-border/70 transition-all",
        "hover:ring-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        selected && "ring-2 ring-primary",
      )}
      style={{ backgroundColor: color }}
      title={label}
    >
      {children}
    </motion.button>
  );
}

export function AnnotationSettingsPanel({
  annotation,
  onContentChange,
  onTypeChange,
  onStyleChange,
  onFigureDataChange,
  onBlurIntensityChange,
  onBlurColorChange,
  onOpacityChange,
  onScaleChange,
  onAnimationChange,
  onAddKeyframe,
  onDeleteKeyframe,
  onDelete,
}: AnnotationSettingsPanelProps) {
  const t = useScopedT("editor");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [customAnimationOpen, setCustomAnimationOpen] = useState(false);

  const figureData = annotation.figureData ?? DEFAULT_FIGURE_DATA;
  const animation = {
    ...DEFAULT_ANNOTATION_ANIMATION,
    ...(annotation.animation ?? {}),
  };
  const annotationDurationMs = Math.max(1, annotation.endMs - annotation.startMs);
  const effectiveAnimationDurationMs = getAnnotationAnimationDurationMs({
    startMs: annotation.startMs,
    endMs: annotation.endMs,
    animation,
  });
  const maxAnimationDurationMs = Math.min(1800, annotationDurationMs);
  const minAnimationDurationMs = Math.min(120, annotationDurationMs);

  const updateAnimation = (patch: Partial<AnnotationAnimationSettings>) => {
    onAnimationChange?.({
      ...animation,
      ...patch,
    });
  };

  const fontFamilies = useMemo(
    () =>
      FONT_FAMILY_VALUES.map((font) => ({
        value: font.value,
        label: t(font.labelKey),
      })),
    [t],
  );

  useEffect(() => {
    setCustomFonts(getCustomFonts());
  }, []);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const validTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (!validTypes.includes(file.type)) {
      toast.error(t("annotations.imageUploadError"), {
        description: t("annotations.imageUploadErrorDescription"),
      });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        onContentChange(dataUrl);
        toast.success(t("annotations.imageUploadSuccess"));
      }
    };

    reader.onerror = () => {
      toast.error(t("annotations.imageUploadFailed"), {
        description: t("annotations.imageUploadFailedDescription"),
      });
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const annotationTypes: Array<{
    value: AnnotationType;
    label: string;
    icon: ReactNode;
  }> = [
    {
      value: "text",
      label: t("annotations.text"),
      icon: <HugeiconsIcon icon={Type} className="size-4" />,
    },
    {
      value: "image",
      label: t("annotations.image"),
      icon: <HugeiconsIcon icon={Image} className="size-4" />,
    },
    {
      value: "figure",
      label: t("annotations.arrow"),
      icon: (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M4 12h16m0 0l-6-6m6 6l-6 6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      value: "blur",
      label: t("annotations.blur"),
      icon: <HugeiconsIcon icon={SquareDashed} className="size-4" />,
    },
  ];

  return (
    <div className="flex h-full min-w-0 max-w-100 flex-2 flex-col overflow-y-auto bg-transparent p-4 scroll">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel>{t("annotations.settings")}</SectionLabel>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground/70">
              {t(
                "annotations.settingsHint",
                "Choose the annotation type, then tune the visible treatment.",
              )}
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
            {t("annotations.active")}
          </span>
        </div>

        <Tabs
          value={annotation.type}
          onValueChange={(value) => onTypeChange(value as AnnotationType)}
          className="space-y-5"
        >
          <TabsList className="grid h-auto w-full grid-cols-4 rounded-lg bg-foreground/4 p-0.5">
            {annotationTypes.map((type) => (
              <TabsTrigger
                key={type.value}
                value={type.value}
                className="h-8 rounded-md px-1.5 text-[11px] data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm"
              >
                {type.icon}
                <span className="min-w-0 truncate">{type.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="text" className="mt-0 space-y-5">
            <SettingsGroup
              title={t("annotations.textContent")}
              description={t(
                "annotations.textContentHint",
                "This text is rendered directly on the video annotation layer.",
              )}
            >
              <textarea
                value={annotation.textContent ?? annotation.content}
                onChange={(event) => onContentChange(event.target.value)}
                placeholder={t("annotations.textPlaceholder")}
                rows={5}
                className="min-h-28 w-full resize-none rounded-lg bg-foreground/4 px-3 py-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:bg-foreground/6 focus:ring-2 focus:ring-primary/35"
              />
            </SettingsGroup>

            <SettingsGroup
              title={t("annotations.fontStyle")}
              description={t(
                "annotations.fontStyleHint",
                "Pick the typeface, size, weight, and alignment for text annotations.",
              )}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>{t("annotations.fontStyle")}</FieldLabel>
                  <Select
                    value={annotation.style.fontFamily}
                    onValueChange={(value) =>
                      value ? onStyleChange({ fontFamily: value }) : undefined
                    }
                  >
                    <SelectTrigger className="h-8 w-full rounded-md border-0 bg-foreground/4 text-xs text-foreground shadow-none hover:bg-foreground/[0.07]">
                      <SelectValue placeholder={t("annotations.selectStyle")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-75 border-border bg-popover text-popover-foreground shadow-lg">
                      {fontFamilies.map((font) => (
                        <SelectItem
                          key={font.value}
                          value={font.value}
                          style={{ fontFamily: font.value }}
                        >
                          {font.label}
                        </SelectItem>
                      ))}
                      {customFonts.length > 0 ? (
                        <>
                          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Custom fonts
                          </div>
                          {customFonts.map((font) => (
                            <SelectItem
                              key={font.id}
                              value={font.fontFamily}
                              style={{ fontFamily: font.fontFamily }}
                            >
                              {font.name}
                            </SelectItem>
                          ))}
                        </>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <FieldLabel>{t("annotations.size")}</FieldLabel>
                  <Select
                    value={annotation.style.fontSize.toString()}
                    onValueChange={(value) =>
                      value
                        ? onStyleChange({ fontSize: parseInt(value, 10) })
                        : undefined
                    }
                  >
                    <SelectTrigger className="h-8 w-full rounded-md border-0 bg-foreground/4 text-xs text-foreground shadow-none hover:bg-foreground/[0.07]">
                      <SelectValue placeholder={t("annotations.size")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-75 border-border bg-popover text-popover-foreground shadow-lg">
                      {FONT_SIZES.map((size) => (
                        <SelectItem key={size} value={size.toString()}>
                          {size}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="pt-1">
                <AddCustomFontDialog
                  onFontAdded={(font) => {
                    setCustomFonts(getCustomFonts());
                    onStyleChange({ fontFamily: font.fontFamily });
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1 rounded-lg bg-foreground/4 p-1">
                  <IconButton
                    label={t("annotations.toggleBold")}
                    isActive={annotation.style.fontWeight === "bold"}
                    onClick={() =>
                      onStyleChange({
                        fontWeight:
                          annotation.style.fontWeight === "bold"
                            ? "normal"
                            : "bold",
                      })
                    }
                  >
                    <HugeiconsIcon icon={Bold} className="size-4" />
                  </IconButton>
                  <IconButton
                    label={t("annotations.toggleItalic")}
                    isActive={annotation.style.fontStyle === "italic"}
                    onClick={() =>
                      onStyleChange({
                        fontStyle:
                          annotation.style.fontStyle === "italic"
                            ? "normal"
                            : "italic",
                      })
                    }
                  >
                    <HugeiconsIcon icon={Italic} className="size-4" />
                  </IconButton>
                  <IconButton
                    label={t("annotations.toggleUnderline")}
                    isActive={annotation.style.textDecoration === "underline"}
                    onClick={() =>
                      onStyleChange({
                        textDecoration:
                          annotation.style.textDecoration === "underline"
                            ? "none"
                            : "underline",
                      })
                    }
                  >
                    <HugeiconsIcon icon={Underline} className="size-4" />
                  </IconButton>
                </div>

                <div className="flex items-center gap-1 rounded-lg bg-foreground/4 p-1">
                  {(
                    [
                      ["left", AlignLeft, t("annotations.alignLeft")],
                      ["center", AlignCenter, t("annotations.alignCenter")],
                      ["right", AlignRight, t("annotations.alignRight")],
                    ] as const
                  ).map(([value, icon, label]) => (
                    <IconButton
                      key={value}
                      label={label}
                      isActive={annotation.style.textAlign === value}
                      onClick={() => onStyleChange({ textAlign: value })}
                    >
                      <HugeiconsIcon icon={icon} className="size-4" />
                    </IconButton>
                  ))}
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup
              title={t("annotations.textColor")}
              description={t(
                "annotations.colorHint",
                "Use brand colors for emphasis and neutral colors for quieter labels.",
              )}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>{t("annotations.textColor")}</FieldLabel>
                  <ColorPicker
                    label={t("annotations.textColor")}
                    color={annotation.style.color}
                    onChange={(color) => onStyleChange({ color })}
                  />
                </div>
                <div>
                  <FieldLabel>{t("annotations.background")}</FieldLabel>
                  <ColorPicker
                    label={t("annotations.background")}
                    color={annotation.style.backgroundColor}
                    clearLabel={t("annotations.clearBackground")}
                    displayValue={
                      annotation.style.backgroundColor === "transparent"
                        ? t("annotations.none")
                        : annotation.style.backgroundColor
                    }
                    onChange={(backgroundColor) =>
                      onStyleChange({ backgroundColor })
                    }
                    onClear={() =>
                      onStyleChange({ backgroundColor: "transparent" })
                    }
                  />
                </div>
              </div>
            </SettingsGroup>
          </TabsContent>

          <TabsContent value="image" className="mt-0 space-y-5">
            <SettingsGroup
              title={t("annotations.uploadImage")}
              description={t(
                "annotations.uploadImageHint",
                "Use PNG, JPG, GIF, or WebP overlays for logos, callouts, and visual marks.",
              )}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept=".jpg,.jpeg,.png,.gif,.webp,image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-20 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
              >
                <Upload01Icon className="size-5" />
                {t("annotations.uploadImage")}
              </button>

              {annotation.content?.startsWith("data:image") ? (
                <div className="overflow-hidden rounded-lg bg-foreground/4 p-1.5">
                  <img
                    src={annotation.content}
                    alt="Uploaded annotation"
                    className="max-h-52 w-full rounded-md object-contain"
                  />
                </div>
              ) : null}

              <p className="text-[10px] leading-4 text-muted-foreground/70">
                {t("annotations.supportedFormats")}
              </p>
            </SettingsGroup>
          </TabsContent>

          <TabsContent value="figure" className="mt-0 space-y-5">
            <SettingsGroup
              title={t("annotations.arrowDirection")}
              description={t(
                "annotations.arrowDirectionHint",
                "Set the arrow direction before adjusting thickness and color.",
              )}
            >
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    "up",
                    "down",
                    "left",
                    "right",
                    "up-right",
                    "up-left",
                    "down-right",
                    "down-left",
                  ] as ArrowDirection[]
                ).map((direction) => {
                  const ArrowComponent = getArrowComponent(direction);
                  const isSelected = figureData.arrowDirection === direction;

                  return (
                    <motion.button
                      key={direction}
                      type="button"
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() =>
                        onFigureDataChange?.({
                          ...figureData,
                          arrowDirection: direction,
                        })
                      }
                      aria-label={t(
                        "annotations.arrowDirectionOption",
                        "Arrow direction: {{direction}}",
                        { direction: direction.replace(/-/g, " ") },
                      )}
                      aria-pressed={isSelected}
                      className={cn(
                        "flex h-14 items-center justify-center rounded-lg bg-foreground/4 p-2 transition-colors",
                        "hover:bg-foreground/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                        isSelected && "bg-primary/12 ring-1 ring-primary/45",
                      )}
                    >
                      <ArrowComponent
                        color={isSelected ? "#f08030" : "#7e786e"}
                        strokeWidth={3}
                      />
                    </motion.button>
                  );
                })}
              </div>
            </SettingsGroup>

            <SettingsGroup
              title={t("annotations.strokeWidth", undefined, {
                width: figureData.strokeWidth,
              })}
              description={t(
                "annotations.strokeWidthHint",
                "Adjust arrow thickness without changing its overall size.",
              )}
            >
              <Scrubber
                size="sm"
                label={t("annotations.strokeWidth", undefined, {
                  width: figureData.strokeWidth,
                })}
                value={figureData.strokeWidth}
                defaultValue={DEFAULT_FIGURE_DATA.strokeWidth}
                min={1}
                max={6}
                step={1}
                onValueChange={(strokeWidth) =>
                  onFigureDataChange?.({ ...figureData, strokeWidth })
                }
                valueFormatter={(value) => `${Math.round(value)} px`}
              />
            </SettingsGroup>

            <SettingsGroup
              title={t("annotations.arrowColor")}
              description={t(
                "annotations.arrowColorHint",
                "Brand orange works best for arrows that should draw attention.",
              )}
            >
              <ColorPicker
                label={t("annotations.arrowColor")}
                color={figureData.color}
                onChange={(color) =>
                  onFigureDataChange?.({ ...figureData, color })
                }
              />
            </SettingsGroup>
          </TabsContent>

          <TabsContent value="blur" className="mt-0 space-y-5">
            <SettingsGroup
              title={t("annotations.blurStrength", undefined, {
                strength: annotation.blurIntensity ?? 20,
              })}
              description={t(
                "annotations.blurStrengthHint",
                "Higher values obscure more detail inside the selected region.",
              )}
            >
              <Scrubber
                size="sm"
                label={t("annotations.blurStrength", undefined, {
                  strength: annotation.blurIntensity ?? 20,
                })}
                value={annotation.blurIntensity ?? 20}
                defaultValue={20}
                min={1}
                max={100}
                step={1}
                onValueChange={(value) => onBlurIntensityChange?.(value)}
                valueFormatter={(value) => `${Math.round(value)}%`}
              />
            </SettingsGroup>

            <SettingsGroup
              title={t("annotations.solidColor", "Solid Color (Censorship)")}
              description={t(
                "annotations.solidColorHint",
                "Use a solid overlay when the content must be fully hidden instead of softened.",
              )}
            >
              <div className="flex flex-wrap gap-2">
                <BlurColorButton
                  label={t("annotations.none", "None")}
                  selected={
                    !annotation.blurColor ||
                    annotation.blurColor === "transparent"
                  }
                  onClick={() => onBlurColorChange?.("")}
                >
                  <span className="absolute inset-0 bg-foreground/4" />
                  <span className="absolute left-1/2 top-1/2 h-0.5 w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-destructive" />
                </BlurColorButton>
                <BlurColorButton
                  label="Black"
                  color="#000000"
                  selected={annotation.blurColor === "#000000"}
                  onClick={() => onBlurColorChange?.("#000000")}
                />
                <BlurColorButton
                  label="White"
                  color="#ffffff"
                  selected={annotation.blurColor === "#FFFFFF"}
                  onClick={() => onBlurColorChange?.("#FFFFFF")}
                />

                <Popover>
                  <PopoverTrigger
                    aria-label="Custom color"
                    className={cn(
                      "relative size-8 overflow-hidden rounded-full ring-1 ring-border/70 transition-all hover:ring-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                      annotation.blurColor &&
                        !["#000000", "#FFFFFF", "transparent", ""].includes(
                          annotation.blurColor,
                        ) &&
                        "ring-2 ring-primary",
                    )}
                    style={{
                      backgroundColor:
                        annotation.blurColor &&
                        !["#000000", "#FFFFFF", "transparent", ""].includes(
                          annotation.blurColor,
                        )
                          ? annotation.blurColor
                          : undefined,
                    }}
                  >
                    {!annotation.blurColor ||
                    ["#000000", "#FFFFFF", "transparent", ""].includes(
                      annotation.blurColor,
                    ) ? (
                      <span className="absolute inset-0 bg-linear-to-br from-brand-100 via-brand-400 to-brand-700" />
                    ) : null}
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-65 gap-2 rounded-xl bg-popover p-3 shadow-xl ring-1 ring-border/70"
                  >
                    <div className="text-[11px] font-medium text-foreground">
                      Custom color
                    </div>
                    <Block
                      color={annotation.blurColor || "#f08030"}
                      colors={COLOR_PALETTE}
                      onChange={(color) => onBlurColorChange?.(color.hex)}
                      style={{ borderRadius: "8px" }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </SettingsGroup>
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          <SettingsGroup
            title={t("annotations.animation", "Animation")}
            description={t(
              "annotations.animationHint",
              "Choose a preset for fast entrance and exit motion, or open custom controls for keyframes.",
            )}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1.5">
                {ANIMATION_PRESETS.map((preset) => {
                  const isActive = animation.presetId === preset.value;
                  return (
                    <motion.button
                      key={preset.value}
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      onClick={() => updateAnimation({ presetId: preset.value })}
                      className={cn(
                        "group relative min-h-15 rounded-lg px-2.5 py-2 text-left transition-colors",
                        "bg-foreground/4 hover:bg-foreground/7",
                        isActive && "bg-primary/12 text-foreground",
                      )}
                    >
                      <span className="block text-[11px] font-medium">
                        {preset.label}
                      </span>
                      <span className="mt-0.5 block text-[9px] leading-3 text-muted-foreground/75">
                        {preset.description}
                      </span>
                      {isActive ? (
                        <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
                      ) : null}
                    </motion.button>
                  );
                })}
              </div>

              {animation.presetId !== "none" ? (
                <Scrubber
                  size="sm"
                  label={t("annotations.animationDuration", "Duration")}
                  value={effectiveAnimationDurationMs}
                  defaultValue={DEFAULT_ANNOTATION_ANIMATION.durationMs}
                  min={minAnimationDurationMs}
                  max={Math.max(minAnimationDurationMs, maxAnimationDurationMs)}
                  step={20}
                  onValueChange={(durationMs) =>
                    updateAnimation({ durationMs: Math.round(durationMs) })
                  }
                  valueFormatter={(v) => `${Math.round(v)}ms`}
                />
              ) : null}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCustomAnimationOpen((open) => !open)}
                className="h-8 w-full justify-between rounded-md bg-foreground/4 px-2.5 text-xs hover:bg-foreground/7"
              >
                <span>
                  {customAnimationOpen
                    ? t("annotations.hideCustomAnimation", "Hide custom controls")
                    : t("annotations.showCustomAnimation", "Custom controls")}
                </span>
                <ArrowDown01Icon
                  className={cn(
                    "size-3 transition-transform",
                    customAnimationOpen && "rotate-180",
                  )}
                />
              </Button>

              {customAnimationOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="space-y-2.5"
                >
                  <Scrubber
                    size="sm"
                    label={t("annotations.opacity", "Opacity")}
                    value={annotation.opacity ?? 1}
                    defaultValue={1}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={onOpacityChange}
                    valueFormatter={(v) => `${Math.round(v * 100)}%`}
                  />
                  <Scrubber
                    size="sm"
                    label={t("annotations.scale", "Scale")}
                    value={annotation.scale ?? 1}
                    defaultValue={1}
                    min={0.1}
                    max={4}
                    step={0.05}
                    onValueChange={onScaleChange}
                    valueFormatter={(v) => `${v.toFixed(2)}×`}
                  />
                  <Scrubber
                    size="sm"
                    label={t("annotations.springStiffness", "Spring")}
                    value={animation.springStiffness}
                    defaultValue={DEFAULT_ANNOTATION_ANIMATION.springStiffness}
                    min={80}
                    max={700}
                    step={10}
                    onValueChange={(springStiffness) =>
                      updateAnimation({
                        springStiffness: Math.round(springStiffness),
                      })
                    }
                    valueFormatter={(v) => `${Math.round(v)}`}
                  />
                  <Scrubber
                    size="sm"
                    label={t("annotations.springDamping", "Damping")}
                    value={animation.springDamping}
                    defaultValue={DEFAULT_ANNOTATION_ANIMATION.springDamping}
                    min={8}
                    max={60}
                    step={1}
                    onValueChange={(springDamping) =>
                      updateAnimation({ springDamping: Math.round(springDamping) })
                    }
                    valueFormatter={(v) => `${Math.round(v)}`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={onAddKeyframe}
                      className="h-8 flex-1 rounded-md text-xs"
                    >
                      {t("annotations.addKeyframe", "Add keyframe")}
                    </Button>
                    <span className="text-[10px] text-muted-foreground/70">
                      {(annotation.keyframes ?? []).length}
                    </span>
                  </div>
                  {(annotation.keyframes ?? []).length > 0 ? (
                    <div className="space-y-1">
                      {(annotation.keyframes ?? []).map((keyframe) => (
                        <div
                          key={keyframe.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-foreground/4 px-2 py-1.5"
                        >
                          <span className="truncate text-[10px] text-muted-foreground">
                            {Math.round(keyframe.timeMs / 1000)}s ·{" "}
                            {keyframe.easing ?? "ease-in-out"}
                          </span>
                          <button
                            type="button"
                            onClick={() => onDeleteKeyframe?.(keyframe.id)}
                            className="text-[10px] text-destructive hover:opacity-80"
                          >
                            {t("annotations.deleteKeyframe", "Delete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
              <div className="text-[10px] leading-4 text-muted-foreground/70">
                {t(
                  "annotations.animationDurationHint",
                  "Duration is clamped to this annotation's visible time, so presets cannot overflow the layer.",
                )}
                </div>
            </div>
          </SettingsGroup>

          <Button
            type="button"
            onClick={onDelete}
            variant="destructive"
            size="sm"
            className="h-8 w-full rounded-md text-xs"
          >
            <HugeiconsIcon icon={Trash2} className="size-4" />
            {t("annotations.deleteAnnotation")}
          </Button>

          <SettingsGroup
            title={t("annotations.shortcutsAndTips")}
            description={t(
              "annotations.shortcutsAndTipsHint",
              "Tips for selecting and cycling annotation layers on the canvas.",
            )}
          >
            <ul className="space-y-1.5 text-[10px] leading-4 text-muted-foreground/75">
              <li>{t("annotations.tipSelectAnnotation")}</li>
              <li>{t("annotations.tipCycleForward")}</li>
              <li>{t("annotations.tipCycleBackward")}</li>
            </ul>
          </SettingsGroup>
        </div>
      </div>
    </div>
  );
}
