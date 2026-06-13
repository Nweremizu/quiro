import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import glassStyles from "./ItemGlass.module.css";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Film,
  MessageSquare,
  MouseLeftClick01Icon,
  Music,
  Scissors,
  ZoomIn,
} from "@hugeicons/core-free-icons";
import { IconGauge } from "@tabler/icons-react";
import AudioWaveform from "./AudioWaveform";
import type { AudioPeaksData } from "./useAudioPeaks";
import {
  DEFAULT_TIMELINE_DENSITY_MODE,
  getTimelineDensityConfig,
  type TimelineDensityMode,
} from "./timelineLayout";

interface ItemProps {
  id: string;
  span: Span;
  rowId: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  zoomDepth?: number;
  zoomMode?: "auto" | "manual";
  speedValue?: number;
  variant?: "zoom" | "trim" | "clip" | "annotation" | "speed" | "audio";
  waveformPeaks?: AudioPeaksData | null;
  densityMode?: TimelineDensityMode;
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
  1: "1.25×",
  2: "1.5×",
  3: "1.8×",
  4: "2.2×",
  5: "3.5×",
  6: "5×",
};

function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return `${seconds.toFixed(1)}s`;
}

export default function Item({
  id,
  span,
  rowId,
  isSelected = false,
  onSelect,
  zoomDepth = 1,
  zoomMode = "auto",
  speedValue,
  variant = "zoom",
  waveformPeaks,
  densityMode = DEFAULT_TIMELINE_DENSITY_MODE,
  children,
}: ItemProps) {
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const density = getTimelineDensityConfig(densityMode);

  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } =
    useItem({
      id,
      span,
      data: { rowId },
    });

  const isZoom = variant === "zoom";
  const isTrim = variant === "trim";
  const isClip = variant === "clip";
  const isSpeed = variant === "speed";
  const isAudio = variant === "audio";

  const glassClass = isZoom
    ? glassStyles.glassPurple
    : isTrim
      ? glassStyles.glassRed
      : isClip
        ? glassStyles.glassBrand
        : isSpeed
          ? glassStyles.glassAmber
          : isAudio
            ? glassStyles.glassDarkGreen
            : glassStyles.glassYellow;

  const timeLabel = useMemo(
    () => `${formatMs(span.start)} – ${formatMs(span.end)}`,
    [span.start, span.end],
  );

  const MIN_ITEM_PX = 6;
  const safeItemStyle = {
    ...itemStyle,
    minWidth: MIN_ITEM_PX,
    height: "100%",
    overflow: "hidden",
  };

  const initialState = shouldReduceMotion
    ? { opacity: 1, y: 0 }
    : { opacity: 0, y: 4 };

  return (
    <motion.div
      ref={setNodeRef}
      style={safeItemStyle}
      {...listeners}
      {...attributes}
      initial={initialState}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 220, damping: 24, delay: 0.02 }
      }
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        setIsHovered(false);
        setIsDragging(false);
      }}
      onPointerDownCapture={() => {
        setIsDragging(true);
        onSelect?.();
      }}
      onPointerUp={() => setIsDragging(false)}
      className="group h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
    >
      <div
        className="h-full"
        style={{
          ...itemContentStyle,
          minWidth: MIN_ITEM_PX,
          height: "100%",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          borderRadius: densityMode === "compact" ? "8px" : "10px",
        }}
      >
        <motion.div
          className={cn(
            glassClass,
            "w-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
            isSelected && glassStyles.selected,
          )}
          style={{
            height: `${density.itemHeightPercent}%`,
            minHeight: density.itemMinHeightPx,
            minWidth: MIN_ITEM_PX,
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.();
          }}
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          onPointerDownCapture={(_e) => {
            setIsDragging(true);
            onSelect?.();
          }}
        >
          {isClip && waveformPeaks ? (
            <div className={glassStyles.waveformLayer}>
              <AudioWaveform
                peaks={waveformPeaks}
                span={span}
                className={glassStyles.waveformCanvas}
              />
            </div>
          ) : null}
          <motion.div
            className={cn(glassStyles.zoomEndCap, glassStyles.left)}
            style={{ cursor: "col-resize", pointerEvents: "auto" }}
            title="Resize left"
            animate={{
              opacity: isHovered || isSelected ? 0.8 : 0.5,
            }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }
            }
          />
          <motion.div
            className={cn(glassStyles.zoomEndCap, glassStyles.right)}
            style={{ cursor: "col-resize", pointerEvents: "auto" }}
            title="Resize right"
            animate={{
              opacity: isHovered || isSelected ? 0.8 : 0.5,
            }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }
            }
          />
          <motion.div
            ref={contentRef}
            className={cn(
              glassStyles.itemContent,
              "relative z-10 flex flex-col items-center justify-center opacity-80 group-hover:opacity-100 select-none overflow-hidden",
            )}
            animate={{
              opacity: isDragging ? 0.6 : isHovered || isSelected ? 1 : 0.8,
            }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.18 }
            }
          >
            <motion.div
              className="flex items-center gap-1.5"
              initial={shouldReduceMotion ? false : { opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { delay: 0.05, type: "spring", stiffness: 250, damping: 20 }
              }
            >
              {isZoom ? (
                <>
                  <HugeiconsIcon
                    icon={ZoomIn}
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight whitespace-nowrap",
                    )}
                  >
                    {ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
                  </span>
                </>
              ) : isTrim ? (
                <>
                  <HugeiconsIcon
                    icon={Scissors}
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight whitespace-nowrap",
                    )}
                  >
                    Trim
                  </span>
                </>
              ) : isClip ? (
                <>
                  <HugeiconsIcon
                    icon={Film}
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight whitespace-nowrap",
                    )}
                  >
                    Clip
                  </span>
                </>
              ) : isSpeed ? (
                <>
                  <IconGauge
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight whitespace-nowrap",
                    )}
                  >
                    {speedValue !== undefined ? `${speedValue}×` : "Speed"}
                  </span>
                </>
              ) : isAudio ? (
                <>
                  <HugeiconsIcon
                    icon={Music}
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight truncate max-w-full",
                    )}
                  >
                    {children}
                  </span>
                </>
              ) : (
                <>
                  <HugeiconsIcon
                    icon={MessageSquare}
                    className={cn(density.iconClassName, "shrink-0")}
                  />
                  <span
                    className={cn(
                      density.primaryLabelClassName,
                      "font-semibold tracking-tight whitespace-nowrap",
                    )}
                  >
                    {children}
                  </span>
                </>
              )}
            </motion.div>
            {density.showSecondaryItemLabel && isZoom ? (
              <motion.div
                className="flex items-center gap-0.5"
                animate={{
                  opacity: isSelected ? 0.7 : isHovered ? 0.6 : 0,
                }}
                transition={
                  shouldReduceMotion ? { duration: 0 } : { duration: 0.18 }
                }
              >
                <HugeiconsIcon
                  icon={MouseLeftClick01Icon}
                  className="w-2.5 h-2.5 shrink-0"
                />
                <span className="text-[9px] font-medium tracking-tight whitespace-nowrap">
                  {zoomMode === "manual" ? "Manual" : "Auto"}
                </span>
              </motion.div>
            ) : density.showSecondaryItemLabel ? (
              <motion.span
                className={cn(
                  density.secondaryLabelClassName,
                  "tabular-nums tracking-tight whitespace-nowrap",
                )}
                animate={{
                  opacity: isSelected ? 0.6 : isHovered ? 0.5 : 0,
                }}
                transition={
                  shouldReduceMotion ? { duration: 0 } : { duration: 0.18 }
                }
              >
                {timeLabel}
              </motion.span>
            ) : null}
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
