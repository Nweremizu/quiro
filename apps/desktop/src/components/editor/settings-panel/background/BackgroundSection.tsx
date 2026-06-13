import React, { useRef, useState, useEffect } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Scrubber from "@/components/ui/scrubber";
import { Cancel01Icon, Upload01Icon as Upload } from "@/components/icons";
import { cn } from "@/lib/utils";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { useScopedT, useI18n } from "../../../../contexts/I18nContext";
import { GRADIENTS, type BackgroundTab } from "../constants";
import { getBackgroundTabForWallpaper, isHexWallpaper } from "../background";
import { WallpaperVideoPreview } from "../WallpaperVideoPreview";
import { SectionHeader } from "../shared/SectionHeader";

const colorPalette = [
  "#FF0000",
  "#FFD700",
  "#00FF00",
  "#FFFFFF",
  "#ffecd4",
  "#FF6B00",
  "#9B59B6",
  "#E91E63",
  "#d4651a",
  "#FF5722",
  "#8BC34A",
  "#FFC107",
  "#f08030",
  "#000000",
  "#7e786e",
  "#795548",
];

export interface BackgroundSectionProps {
  selected: string;
  onWallpaperChange: (url: string) => void;
  backgroundBlur: number;
  initialBackgroundBlur: number;
  onBackgroundBlurChange?: (v: number) => void;
  customImages: string[];
  setCustomImages: React.Dispatch<React.SetStateAction<string[]>>;
  imageWallpaperTiles: Array<{
    key: string;
    label: string;
    value: string;
    previewUrl: string;
  }>;
  videoWallpaperTiles: Array<{
    key: string;
    label: string;
    value: string;
    previewUrl: string;
  }>;
}

export function BackgroundSection({
  selected,
  onWallpaperChange,
  backgroundBlur,
  initialBackgroundBlur,
  onBackgroundBlurChange,
  customImages,
  setCustomImages,
  imageWallpaperTiles,
  videoWallpaperTiles,
}: BackgroundSectionProps) {
  const { t } = useI18n();
  const tSettings = useScopedT("settings");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);

  const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
    getBackgroundTabForWallpaper(selected),
  );
  const [selectedColor, setSelectedColor] = useState(
    isHexWallpaper(selected) ? selected : "#ADADAD",
  );
  const [gradient, setGradient] = useState<string>(
    GRADIENTS.includes(selected) ? selected : GRADIENTS[0],
  );

  useEffect(() => {
    setBackgroundTab(getBackgroundTabForWallpaper(selected));
    if (isHexWallpaper(selected)) setSelectedColor(selected);
    if (GRADIENTS.includes(selected)) setGradient(selected);
  }, [selected]);

  const visibleColorPalette = colorPalette.slice(0, 15);

  const resetBackgroundSection = () => {
    onBackgroundBlurChange?.(initialBackgroundBlur);
  };

  const getWallpaperTileState = (
    candidateValue: string,
    previewPath?: string,
  ) => {
    if (!selected) return false;
    if (
      selected === candidateValue ||
      (previewPath && selected === previewPath)
    )
      return true;
    try {
      const clean = (s: string) =>
        s.replace(/^file:\/\//, "").replace(/^\//, "");
      if (clean(selected).endsWith(clean(candidateValue))) return true;
      if (clean(candidateValue).endsWith(clean(selected))) return true;
      if (previewPath && clean(selected).endsWith(clean(previewPath)))
        return true;
      if (previewPath && clean(previewPath).endsWith(clean(selected)))
        return true;
    } catch {
      return false;
    }
    return false;
  };

  const wallpaperTileClass = (isSelected: boolean) =>
    cn(
      "group relative aspect-square w-full overflow-hidden rounded-[10px] border bg-editor-bg transition-colors duration-150",
      isSelected
        ? "border-primary bg-foreground/[0.08]"
        : "border-foreground/10 bg-foreground/[0.045] hover:border-foreground/20 hover:bg-foreground/[0.07]",
    );

  const renderWallpaperImageTile = (
    wallpaperUrl: string,
    isSelected: boolean,
    props?: {
      key?: string;
      ariaLabel?: string;
      title?: string;
      onClick?: () => void;
      children?: React.ReactNode;
    },
  ) => (
    <div
      key={props?.key}
      className={wallpaperTileClass(isSelected)}
      aria-label={props?.ariaLabel}
      title={props?.title}
      onClick={props?.onClick}
      role="button"
    >
      <div className="absolute inset-px overflow-hidden rounded-[8px] bg-editor-dialog">
        {isVideoWallpaperSource(wallpaperUrl) ? (
          <WallpaperVideoPreview src={wallpaperUrl} />
        ) : (
          <img
            src={wallpaperUrl}
            alt={
              props?.title ??
              props?.ariaLabel ??
              tSettings("background.wallpaperPreview", "Wallpaper preview")
            }
            className="h-full w-full select-none object-cover transform-[translateZ(0)]"
            draggable={false}
          />
        )}
      </div>
      {props?.children}
    </div>
  );

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file type - only allow JPG/JPEG
    const validTypes = ["image/jpeg", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      toast.error(tSettings("background.uploadError"), {
        description: tSettings("background.uploadErrorDescription"),
      });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomImages((prev) => [...prev, dataUrl]);
        onWallpaperChange(dataUrl);
        toast.success(tSettings("background.uploadSuccess"));
      }
    };
    reader.onerror = () => {
      toast.error(t("common.errors.failedToUploadImage"), {
        description: t("common.errors.fileReadError"),
      });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleVideoUpload = async () => {
    try {
      const result = await window.electronAPI.openVideoFilePicker();
      if (!result?.success || !result.path) return;
      const filePath = result.path;
      if (!isVideoWallpaperSource(filePath)) {
        toast.error("Unsupported format", {
          description: "Please select a video file (mp4, webm, mov, etc.)",
        });
        return;
      }
      setCustomImages((prev) => [filePath, ...prev]);
      onWallpaperChange(filePath);
      toast.success("Video background added");
    } catch {
      toast.error("Failed to import video background");
    }
  };

  const handleRemoveCustomImage = (
    imageUrl: string,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
    if (selected === imageUrl) {
      onWallpaperChange(GRADIENTS[0]);
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-2">
        <SectionHeader
          title={tSettings("background.title")}
          onReset={resetBackgroundSection}
          resetLabel={t("common.actions.reset", "Reset")}
        />
        <Scrubber
          label={tSettings("effects.backgroundBlur")}
          size="sm"
          value={backgroundBlur}
          defaultValue={initialBackgroundBlur}
          min={0}
          max={8}
          step={0.25}
          onValueChange={(v) => onBackgroundBlurChange?.(v)}
          decimals={1}
          suffix="px"
        />
      </section>

      <div className="w-full">
        <LayoutGroup id="background-picker-switcher">
          <div className="grid h-8 w-full grid-cols-4 rounded-xl border border-foreground/10 bg-foreground/4 p-1">
            {(
              [
                { value: "image", label: tSettings("background.image") },
                {
                  value: "video",
                  label: tSettings("background.video", "Video"),
                },
                { value: "color", label: tSettings("background.color") },
                { value: "gradient", label: tSettings("background.gradient") },
              ] as const
            ).map((option) => {
              const isActive = backgroundTab === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBackgroundTab(option.value)}
                  className="relative rounded-lg text-[10px] font-semibold tracking-wide transition-colors"
                >
                  {isActive ? (
                    <motion.span
                      layoutId="background-picker-pill"
                      className="absolute inset-0 rounded-lg bg-primary"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 34,
                      }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10",
                      isActive
                        ? "text-white"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        <div className="pt-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={backgroundTab}
              initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {backgroundTab === "image" ? (
                <div className="mt-0 space-y-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    accept=".jpg,.jpeg,image/jpeg"
                    className="hidden"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-primary hover:text-white hover:border-primary transition-all h-7 text-[10px]"
                  >
                    <Upload className="h-3 w-3" />
                    {tSettings("background.uploadCustom")}
                  </Button>

                  <div className="grid grid-cols-8 gap-1.5">
                    {customImages.map((imageUrl, idx) => {
                      const isSelected = getWallpaperTileState(imageUrl);
                      return renderWallpaperImageTile(imageUrl, isSelected, {
                        key: `custom-${idx}`,
                        ariaLabel: isVideoWallpaperSource(imageUrl)
                          ? (imageUrl.split(/[\\/]/).pop() ??
                            tSettings("background.video", "Video background"))
                          : undefined,
                        title: isVideoWallpaperSource(imageUrl)
                          ? imageUrl.split(/[\\/]/).pop()
                          : undefined,
                        onClick: () => onWallpaperChange(imageUrl),
                        children: (
                          <button
                            onClick={(e) =>
                              handleRemoveCustomImage(imageUrl, e)
                            }
                            className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          >
                            <Cancel01Icon className="w-2 h-2 text-white" />
                          </button>
                        ),
                      });
                    })}

                    {imageWallpaperTiles.map((tile) => {
                      const isSelected = getWallpaperTileState(
                        tile.value,
                        tile.previewUrl,
                      );
                      return renderWallpaperImageTile(
                        tile.previewUrl,
                        isSelected,
                        {
                          key: tile.key,
                          ariaLabel: tile.label,
                          title: tile.label,
                          onClick: () => onWallpaperChange(tile.value),
                        },
                      );
                    })}
                  </div>
                </div>
              ) : backgroundTab === "video" ? (
                <div className="mt-0 space-y-2">
                  <Button
                    onClick={handleVideoUpload}
                    variant="outline"
                    className="w-full gap-2 bg-foreground/5 text-foreground border-foreground/10 hover:bg-primary hover:text-white hover:border-primary transition-all h-7 text-[10px]"
                  >
                    <Upload className="h-3 w-3" />
                    {tSettings("background.uploadCustomVideo", "Upload Video")}
                  </Button>

                  <div className="grid grid-cols-8 gap-1.5">
                    {customImages
                      .filter(isVideoWallpaperSource)
                      .map((videoUrl, idx) => {
                        const isSelected = getWallpaperTileState(videoUrl);
                        return renderWallpaperImageTile(videoUrl, isSelected, {
                          key: `custom-video-${idx}`,
                          ariaLabel:
                            videoUrl.split(/[\\/]/).pop() ?? "Video background",
                          title: videoUrl.split(/[\\/]/).pop(),
                          onClick: () => onWallpaperChange(videoUrl),
                          children: (
                            <button
                              onClick={(e) =>
                                handleRemoveCustomImage(videoUrl, e)
                              }
                              className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                            >
                              <Cancel01Icon className="w-2 h-2 text-white" />
                            </button>
                          ),
                        });
                      })}

                    {videoWallpaperTiles.map((wallpaper) => {
                      const isSelected = getWallpaperTileState(
                        wallpaper.value,
                        wallpaper.previewUrl,
                      );
                      return renderWallpaperImageTile(
                        wallpaper.previewUrl,
                        isSelected,
                        {
                          key: wallpaper.key,
                          ariaLabel: wallpaper.label,
                          title: wallpaper.label,
                          onClick: () => onWallpaperChange(wallpaper.value),
                        },
                      );
                    })}
                  </div>
                </div>
              ) : backgroundTab === "color" ? (
                <div className="mt-0 space-y-2">
                  <input
                    ref={customColorInputRef}
                    type="color"
                    value={selectedColor}
                    onChange={(event) => {
                      setSelectedColor(event.target.value);
                      onWallpaperChange(event.target.value);
                    }}
                    className="sr-only"
                  />
                  <div className="grid grid-cols-8 gap-1.5">
                    {visibleColorPalette.map((color) => {
                      const isSelected =
                        selected.toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setSelectedColor(color);
                            onWallpaperChange(color);
                          }}
                          className={wallpaperTileClass(isSelected)}
                          style={{ background: color }}
                          aria-label={`Color ${color}`}
                        />
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => customColorInputRef.current?.click()}
                      className={wallpaperTileClass(
                        isHexWallpaper(selected) &&
                          !visibleColorPalette.some(
                            (color) =>
                              color.toLowerCase() === selected.toLowerCase(),
                          ),
                      )}
                      style={{
                        background: `linear-gradient(135deg, ${selectedColor} 0%, ${selectedColor} 58%, rgba(255,255,255,0.92) 58%, rgba(255,255,255,0.92) 100%)`,
                      }}
                      aria-label="Custom color picker"
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
                        Pick
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-0 grid grid-cols-8 gap-1.5">
                  {GRADIENTS.map((g: string, idx: number) => (
                    <div
                      key={g}
                      className={wallpaperTileClass(gradient === g)}
                      aria-label={`Gradient ${idx + 1}`}
                      onClick={() => {
                        setGradient(g);
                        onWallpaperChange(g);
                      }}
                      role="button"
                    >
                      <div
                        className="absolute inset-px overflow-hidden rounded-[8px]"
                        style={{ background: g }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
