import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface AudioLevelMeterProps {
  level: number;
  className?: string;
}

const bars = [
  {
    threshold: 8,
    idleHeight: 18,
    activeHeight: 28,
    colorClassName: "bg-app-300",
    glow: "rgba(84, 149, 255, 0.24)",
  },
  {
    threshold: 16,
    idleHeight: 22,
    activeHeight: 38,
    colorClassName: "bg-app-300",
    glow: "rgba(84, 149, 255, 0.26)",
  },
  {
    threshold: 28,
    idleHeight: 28,
    activeHeight: 52,
    colorClassName: "bg-app-400",
    glow: "rgba(67, 123, 255, 0.28)",
  },
  {
    threshold: 42,
    idleHeight: 34,
    activeHeight: 68,
    colorClassName: "bg-app-500",
    glow: "rgba(51, 102, 255, 0.3)",
  },
  {
    threshold: 58,
    idleHeight: 40,
    activeHeight: 82,
    colorClassName: "bg-yellow-400",
    glow: "rgba(250, 204, 21, 0.34)",
  },
  {
    threshold: 76,
    idleHeight: 48,
    activeHeight: 94,
    colorClassName: "bg-yellow-500",
    glow: "rgba(234, 179, 8, 0.38)",
  },
  {
    threshold: 90,
    idleHeight: 56,
    activeHeight: 100,
    colorClassName: "bg-red-500",
    glow: "rgba(239, 68, 68, 0.42)",
  },
];

const ACTIVATION_WINDOW = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getBarFill(level: number, threshold: number) {
  return clamp(
    (level - threshold + ACTIVATION_WINDOW) / ACTIVATION_WINDOW,
    0,
    1,
  );
}

export function AudioLevelMeter({
  level,
  className = "",
}: AudioLevelMeterProps) {
  const prefersReducedMotion = useReducedMotion();
  const normalizedLevel = clamp(level, 0, 100);
  const isActive = normalizedLevel > 2;

  return (
    <motion.div
      aria-hidden="true"
      className={cn(
        "relative flex h-6 items-end justify-between gap-1.5",
        className,
      )}
      animate={
        prefersReducedMotion
          ? undefined
          : {
              opacity: isActive ? 1 : 0.82,
              scale: isActive ? 1 : 0.985,
            }
      }
      transition={{
        type: "spring",
        stiffness: 280,
        damping: 24,
        mass: 0.5,
      }}
    >
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px rounded-full bg-transparent"
        animate={{
          opacity: 0.18 + normalizedLevel / 180,
          scaleX: 0.92 + normalizedLevel / 1250,
        }}
        transition={{
          type: "spring",
          stiffness: 240,
          damping: 22,
        }}
      />

      {bars.map((bar, index) => {
        const fill = getBarFill(normalizedLevel, bar.threshold);
        const height = `${bar.idleHeight + (bar.activeHeight - bar.idleHeight) * fill}%`;
        const opacity = 0.18 + fill * 0.82;
        const scaleX = 0.86 + fill * 0.14;
        const glowOpacity = fill * 0.95;

        return (
          <div
            key={bar.threshold}
            className="relative flex h-full flex-1 items-end overflow-hidden rounded-full bg-transparent"
          >
            <motion.span
              className={cn(
                "absolute inset-x-0 bottom-0 rounded-full",
                bar.colorClassName,
              )}
              animate={{
                height,
                opacity,
                scaleX,
                filter: `saturate(${1 + fill * 0.45})`,
                boxShadow:
                  glowOpacity > 0.01
                    ? `0 0 ${6 + fill * 10}px ${bar.glow}`
                    : "0 0 0 rgba(0, 0, 0, 0)",
              }}
              transition={
                prefersReducedMotion
                  ? {
                      duration: 0.12,
                      ease: "easeOut",
                    }
                  : {
                      type: "spring",
                      stiffness: 320,
                      damping: 26,
                      mass: 0.45,
                      delay: index * 0.012,
                    }
              }
              style={{ transformOrigin: "bottom center" }}
            />
          </div>
        );
      })}
    </motion.div>
  );
}
