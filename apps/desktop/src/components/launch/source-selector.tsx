import * as React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useScopedT } from "@/contexts/I18nContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  mapRawSource,
  isScreenSource,
  isWindowSource,
  type DesktopSource,
} from "./popovers/launchPopoverTypes";

import { useHudInteraction } from "@/contexts/launch/HudInteractionContext";
import {
  ArrowUp01Icon,
  MonitorDotIcon,
  WindowsOldIcon,
} from "@/components/icons/generated";
import { Spinner } from "@/components/ui/spinner";

interface SourceSelectorProps {
  /** List of available screen sources */
  screenSources?: DesktopSource[];
  /** List of available window sources */
  windowSources?: DesktopSource[];
  /** Currently selected source name */
  selectedSource?: string;
  /** Loading state */
  loading?: boolean;
  /** Callback when a source is selected */
  onSourceSelect?: (source: DesktopSource) => void;
  /** Callback to fetch sources */
  onFetchSources?: () => Promise<void>;
  /** Whether the popover is open */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Optional custom trigger element */
  children?: React.ReactNode;
}

export function MarqueeText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [canHover, setCanHover] = useState(true);
  const prefersReducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textNode = textRef.current;
    if (!container || !textNode) return;

    const checkOverflow = () => {
      const containerWidth = container.clientWidth;
      const textWidth = textNode.scrollWidth;
      const distance = Math.max(0, textWidth - containerWidth + 20);
      setOverflowing(textWidth > containerWidth + 1);
      setScrollDistance(distance);
    };

    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(container);
    observer.observe(textNode);
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mediaQuery.matches);
    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  const duration = Math.max(6, scrollDistance / 35);

  const shouldAnimate =
    !prefersReducedMotion &&
    canHover &&
    overflowing &&
    hovered &&
    scrollDistance > 0;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden whitespace-nowrap w-full font-sans!"
      data-overflowing={overflowing ? "true" : "false"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.span
        ref={textRef}
        className="inline-flex max-w-none whitespace-nowrap will-change-transform"
        animate={shouldAnimate ? { x: [0, -scrollDistance, 0] } : { x: 0 }}
        transition={
          shouldAnimate
            ? {
                duration,
                ease: "linear",
                repeat: Infinity,
              }
            : { duration: 0.15, ease: "easeOut" }
        }
      >
        <span className="inline-block font-sans!">{text}</span>
        {shouldAnimate ? (
          <span className="inline-block pl-5">{text}</span>
        ) : null}
      </motion.span>
    </div>
  );
}

/**
 * SourceSelectorContent - The actual list of sources
 */
export const SourceSelectorContent = ({
  screenSources = [],
  windowSources = [],
  selectedSource = "Screen",
  loading = false,
  onSourceSelect = () => {},
}: Pick<
  SourceSelectorProps,
  | "screenSources"
  | "windowSources"
  | "selectedSource"
  | "loading"
  | "onSourceSelect"
>) => {
  const t = useScopedT("launch");
  const prefersReducedMotion = useReducedMotion();
  const listVariants: Variants = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
      }
    : {
        initial: { opacity: 0 },
        animate: {
          opacity: 1,
          transition: {
            staggerChildren: 0.04,
            delayChildren: 0.02,
          },
        },
      };
  const itemVariants: Variants = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
      }
    : {
        initial: {
          opacity: 0,
          y: 6,
          scale: 0.985,
          filter: "blur(6px)",
        },
        animate: {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          transition: {
            scale: {
              type: "spring",
              stiffness: 360,
              damping: 28,
            },
            opacity: {
              type: "tween",
              duration: 0.18,
              ease: "easeOut",
            },
            filter: {
              type: "tween",
              duration: 0.28,
              ease: "easeOut",
            },
          },
        },
      };
  const hoverMotion = prefersReducedMotion
    ? {}
    : {
        whileHover: { y: -1 },
        whileTap: { scale: 0.985 },
      };
  const renderSourceItem = (source: DesktopSource, index: number) => {
    const isSelected = selectedSource === source.name;
    return (
      <motion.button
        key={`${source.id}-${index}`}
        type="button"
        className={cn(
          "group flex min-h-11.5 w-full font-sans! items-center justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-medium text-stone-100",
          "transition-[background-color,color] duration-150 hover:bg-white/10",
          isSelected && "bg-primary/20 text-primary",
        )}
        onClick={() => onSourceSelect(source)}
        variants={itemVariants}
        {...hoverMotion}
      >
        <div className="relative shrink-0">
          {source.thumbnail ? (
            <img
              src={source.thumbnail}
              alt=""
              className="h-8 w-12 rounded-lg bg-black/50 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-8 w-12 items-center justify-center rounded-lg bg-black/40 ring-1 ring-white/10">
              {source.sourceType === "window" ? (
                <WindowsOldIcon className="h-5 w-5 text-stone-500" />
              ) : (
                <MonitorDotIcon className="h-5 w-5 text-stone-500" />
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start text-left">
          <div className="w-full text-sm font-medium text-stone-100">
            <MarqueeText text={source.windowTitle || source.name} />
          </div>
          <div className="w-full truncate text-left text-xs text-stone-500">
            {source.sourceType === "screen"
              ? t("recording.screen")
              : t("recording.window")}
          </div>
        </div>
      </motion.button>
    );
  };

  const hasAnySources = screenSources.length > 0 || windowSources.length > 0;

  if (loading && !hasAnySources) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border border-white/10 border-b-primary" />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto pr-1 py-0.5">
      <div className="source-selector-scroll max-h-90 overflow-x-hidden overflow-y-auto p-2">
        {hasAnySources ? (
          <motion.div
            initial="initial"
            animate="animate"
            variants={listVariants}
          >
            {screenSources.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold tracking-[0.08em] text-stone-400 uppercase">
                  {t("recording.screens")}
                  <span
                    className={cn(
                      "text-stone-500 text-[10px] tracking-normal normal-case transition-opacity duration-150",
                      loading ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <Spinner className="size-3" />
                  </span>
                </div>
                <div className="space-y-0.5">
                  {screenSources.map((source, index) =>
                    renderSourceItem(source, index),
                  )}
                </div>
              </div>
            ) : null}
            {windowSources.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold tracking-[0.08em] text-stone-400 uppercase">
                  {t("recording.windows")}
                </div>
                <div className="space-y-0.5">
                  {windowSources.map((source, index) =>
                    renderSourceItem(source, index),
                  )}
                </div>
              </div>
            ) : null}
          </motion.div>
        ) : (
          <div className="py-8 text-center text-sm text-stone-400">
            {t("recording.noSourcesFound")}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * SourceSelector - A rich source selection component with thumbnails
 * Uses Radix UI Popover for positioning and accessibility
 */
export const SourceSelector = React.memo(function SourceSelector({
  screenSources: propsScreenSources,
  windowSources: propsWindowSources,
  selectedSource: propsSelectedSource,
  loading: propsLoading,
  onSourceSelect: propsOnSourceSelect,
  onFetchSources: propsOnFetchSources,
  open: propsOpen,
  onOpenChange: propsOnOpenChange,
  children,
}: SourceSelectorProps) {
  // Internal state for standalone/uncontrolled use
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalSources, setInternalSources] = useState<DesktopSource[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalSelectedSource, setInternalSelectedSource] =
    useState("Screen");

  // Determine if we should use internal or external state/logic
  const isAutonomous = propsOpen === undefined;
  const open = propsOpen ?? internalOpen;
  const onOpenChange = propsOnOpenChange ?? setInternalOpen;
  const loading = propsLoading ?? internalLoading;
  const selectedSource = propsSelectedSource ?? internalSelectedSource;

  // Default fetching logic
  const defaultFetchSources = useCallback(async () => {
    if (!window.electronAPI) return;
    setInternalLoading(true);
    try {
      const rawSources = await window.electronAPI.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 160, height: 90 },
        fetchWindowIcons: true,
      });
      setInternalSources(
        rawSources.map((s) => mapRawSource(s as DesktopSource)),
      );
    } catch (error) {
      console.error("Failed to fetch sources:", error);
    } finally {
      setInternalLoading(false);
    }
  }, []);

  const onFetchSources = propsOnFetchSources ?? defaultFetchSources;

  // Default selection logic
  const onSourceSelect = useCallback(
    async (source: DesktopSource) => {
      if (propsOnSourceSelect) {
        propsOnSourceSelect(source);
        return;
      }
      if (!window.electronAPI) return;
      try {
        const result = await window.electronAPI.selectSource(source);
        if (result) {
          setInternalSelectedSource(source.name);
        }
      } catch (error) {
        console.error("Failed to select source:", error);
      }
    },
    [propsOnSourceSelect],
  );

  // Split sources for internal use
  const internalScreenSources = useMemo(
    () => internalSources.filter(isScreenSource),
    [internalSources],
  );
  const internalWindowSources = useMemo(
    () => internalSources.filter(isWindowSource),
    [internalSources],
  );

  const screenSources = propsScreenSources ?? internalScreenSources;
  const windowSources = propsWindowSources ?? internalWindowSources;

  const hasPrefetchedRef = useRef(false);
  const fetchInFlightRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  const fetchSourcesOnce = useCallback(
    async (allowRecentSkip: boolean) => {
      if (fetchInFlightRef.current) {
        return;
      }
      if (allowRecentSkip && Date.now() - lastFetchedAtRef.current < 750) {
        return;
      }
      fetchInFlightRef.current = true;
      try {
        await onFetchSources();
        lastFetchedAtRef.current = Date.now();
      } finally {
        fetchInFlightRef.current = false;
      }
    },
    [onFetchSources],
  );

  const prefetchSources = React.useCallback(() => {
    if (hasPrefetchedRef.current) {
      return;
    }
    hasPrefetchedRef.current = true;
    void fetchSourcesOnce(false);
  }, [fetchSourcesOnce]);

  // Fetch sources when popover opens
  useEffect(() => {
    if (open) {
      void fetchSourcesOnce(true);
    }
  }, [open, fetchSourcesOnce]);

  // In autonomous mode, we might want to start open
  useEffect(() => {
    if (isAutonomous) {
      setInternalOpen(true);
    }
  }, [isAutonomous]);

  const trigger = children ? (
    React.isValidElement(children) ? (
      React.cloneElement(
        children as React.ReactElement<React.HTMLAttributes<HTMLElement>>,
        {
          onPointerEnter: prefetchSources,
          onFocusCapture: prefetchSources,
        },
      )
    ) : (
      children
    )
  ) : (
    <Button
      variant="outline"
      size="sm"
      onPointerEnter={prefetchSources}
      onFocusCapture={prefetchSources}
      className={cn(
        "group no-drag max-w-45 min-w-0 shrink-0 gap-2 rounded-[10px] px-3 text-[12px] font-medium",
        "border-white/10 bg-[#171411]/90 text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[background-color,border-color,color] hover:border-white/20 hover:bg-[#201c18]/95",
        "data-[state=open]:border-white/20 data-[state=open]:bg-[#201c18]/95",
      )}
      title={selectedSource}
    >
      <MonitorDotIcon size={16} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <MarqueeText text={selectedSource} />
      </div>
      <ArrowUp01Icon
        size={10}
        className={cn(
          "ml-0.5 shrink-0 text-stone-500 transition-transform duration-200",
          open ? "" : "rotate-180",
        )}
      />
    </Button>
  );

  const { onMouseEnter } = useHudInteraction();

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-80 rounded-xl border border-white/10 bg-[#171411]/95 p-0 text-stone-100 shadow-[0_24px_70px_rgba(13,12,10,0.42),0_8px_24px_rgba(13,12,10,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-125"
        align="start"
        sideOffset={8}
        side="top"
        alignOffset={-8}
        onMouseEnter={onMouseEnter}
      >
        <SourceSelectorContent
          screenSources={screenSources}
          windowSources={windowSources}
          selectedSource={selectedSource}
          loading={loading}
          onSourceSelect={onSourceSelect}
        />
      </PopoverContent>
    </Popover>
  );
});

SourceSelector.displayName = "SourceSelector";
