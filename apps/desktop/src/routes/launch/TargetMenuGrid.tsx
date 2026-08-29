import { cn } from "@quiro/ui";
import { motion } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RecordingWithPath, ScreenshotWithPath } from "@/utils/queries";
import type {
  CaptureDisplayWithThumbnail,
  CaptureWindowWithThumbnail,
} from "@/utils/tauri";
import IconLucideExternalLink from "~icons/lucide/external-link";
import IconLucideImage from "~icons/lucide/image";
import IconLucideSquarePlay from "~icons/lucide/square-play";
import TargetCard, { TargetCardSkeleton } from "./TargetCard";

const DEFAULT_SKELETON_COUNT = 6;

type BaseProps<T> = {
  targets?: T[];
  onSelect?: (target: T) => void;
  isLoading?: boolean;
  errorMessage?: string;
  emptyMessage?: string;
  disabled?: boolean;
  skeletonCount?: number;
  className?: string;
  highlightQuery?: string;
};

type DisplayGridProps = BaseProps<CaptureDisplayWithThumbnail> & {
  variant: "display";
};

type WindowGridProps = BaseProps<CaptureWindowWithThumbnail> & {
  variant: "window";
};

type RecordingGridProps = BaseProps<RecordingWithPath> & {
  variant: "recording";
  onRefetch?: () => void;
  onViewAll?: () => void;
};

type ScreenshotGridProps = BaseProps<ScreenshotWithPath> & {
  variant: "screenshot";
  onViewAll?: () => void;
};

type TargetMenuGridProps =
  DisplayGridProps | WindowGridProps | RecordingGridProps | ScreenshotGridProps;

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="flex items-center justify-center size-12 rounded-full bg-gray-3 mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-12 mb-1">{title}</p>
      <p className="text-xs text-gray-10 mb-3 max-w-50">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-12 bg-gray-3 rounded-lg hover:bg-gray-4 transition-colors"
        >
          <IconLucideExternalLink className="size-3" />
          {action.label}
        </button>
      )}
    </div>
  );
}

function ViewAllButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-2 flex items-center justify-center gap-2 py-2.5 mt-1 mb-3 text-xs font-medium text-gray-11 bg-gray-3 rounded-lg hover:bg-gray-4 hover:text-gray-12 transition-colors"
    >
      <IconLucideExternalLink className="size-3" />
      {label}
    </button>
  );
}

// Cards fade/scale in with a per-index stagger on first render. Recording and
// screenshot lists refetch periodically (see queries.ts), so re-triggering
// the stagger on every refetch would be distracting — `hasAppeared` freezes
// it off after the first 600ms, matching Cap's `hasInitiallyRendered`.
function GridCard({
  index,
  animate,
  children,
}: {
  index: number;
  animate: boolean;
  children: ReactNode;
}) {
  if (!animate) return children;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay: Math.min(index, 10) * 0.05 }}
    >
      {children}
    </motion.div>
  );
}

export default function TargetMenuGrid(props: TargetMenuGridProps) {
  const items = props.targets ?? [];
  const skeletonItems = Array.from({
    length: props.skeletonCount ?? DEFAULT_SKELETON_COUNT,
  });
  const isEmpty = !props.isLoading && items.length === 0 && !props.errorMessage;

  const hasPeriodicRefresh =
    props.variant === "recording" || props.variant === "screenshot";
  const [hasInitiallyRendered, setHasInitiallyRendered] = useState(false);
  useEffect(() => {
    if (!hasPeriodicRefresh) return;
    const timeoutId = setTimeout(() => setHasInitiallyRendered(true), 600);
    return () => clearTimeout(timeoutId);
  }, [hasPeriodicRefresh]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        "button[data-target-menu-card]:not(:disabled)",
      ),
    );
    if (!buttons.length) return;

    const currentTarget = event.currentTarget;
    const currentIndex = buttons.indexOf(currentTarget);
    if (currentIndex === -1) return;

    const totalItems = buttons.length;
    const columns = 2;
    let nextIndex = currentIndex;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % totalItems;
        event.preventDefault();
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + totalItems) % totalItems;
        event.preventDefault();
        break;
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + columns, totalItems - 1);
        event.preventDefault();
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - columns, 0);
        event.preventDefault();
        break;
      case "Home":
        nextIndex = 0;
        event.preventDefault();
        break;
      case "End":
        nextIndex = totalItems - 1;
        event.preventDefault();
        break;
      default:
        return;
    }

    buttons[nextIndex]?.focus();
  };

  const onViewAll =
    props.variant === "recording" || props.variant === "screenshot"
      ? props.onViewAll
      : undefined;

  const renderEmptyState = () => {
    if (props.variant === "recording") {
      return (
        <EmptyState
          icon={<IconLucideSquarePlay className="size-5 text-gray-10" />}
          title="No recordings yet"
          description="Your screen recordings will appear here. Start recording to get started!"
          action={
            onViewAll
              ? { label: "View All Recordings", onClick: onViewAll }
              : undefined
          }
        />
      );
    }

    if (props.variant === "screenshot") {
      return (
        <EmptyState
          icon={<IconLucideImage className="size-5 text-gray-10" />}
          title="No screenshots yet"
          description="Your screenshots will appear here. Take a screenshot to get started!"
          action={
            onViewAll
              ? { label: "View All Screenshots", onClick: onViewAll }
              : undefined
          }
        />
      );
    }

    return (
      <div className="col-span-2 py-6 text-sm text-center text-gray-11">
        {props.emptyMessage ??
          (props.variant === "display"
            ? "No displays found"
            : "No windows found")}
      </div>
    );
  };

  const renderItems = () => {
    const showAppearAnimation = !hasPeriodicRefresh || !hasInitiallyRendered;

    if (props.variant === "display") {
      const { onSelect, disabled, highlightQuery } = props;
      return (items as CaptureDisplayWithThumbnail[]).map((item, index) => (
        <GridCard key={item.id} index={index} animate={showAppearAnimation}>
          <TargetCard
            variant="display"
            target={item}
            onClick={() => onSelect?.(item)}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            className="w-full"
            data-target-menu-card="true"
            highlightQuery={highlightQuery}
          />
        </GridCard>
      ));
    }

    if (props.variant === "window") {
      const { onSelect, disabled, highlightQuery } = props;
      return (items as CaptureWindowWithThumbnail[]).map((item, index) => (
        <GridCard key={item.id} index={index} animate={showAppearAnimation}>
          <TargetCard
            variant="window"
            target={item}
            onClick={() => onSelect?.(item)}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            className="w-full"
            data-target-menu-card="true"
            highlightQuery={highlightQuery}
          />
        </GridCard>
      ));
    }

    if (props.variant === "recording") {
      const { onSelect, disabled, highlightQuery, onRefetch } = props;
      return (
        <>
          {(items as RecordingWithPath[]).map((item, index) => (
            <GridCard
              key={item.path}
              index={index}
              animate={showAppearAnimation}
            >
              <TargetCard
                variant="recording"
                target={item}
                onClick={() => onSelect?.(item)}
                disabled={disabled}
                onKeyDown={handleKeyDown}
                className="w-full"
                data-target-menu-card="true"
                highlightQuery={highlightQuery}
                onRefetch={onRefetch}
              />
            </GridCard>
          ))}
          {onViewAll && (
            <ViewAllButton onClick={onViewAll} label="View All Recordings" />
          )}
        </>
      );
    }

    const { onSelect, disabled, highlightQuery } = props as ScreenshotGridProps;
    return (
      <>
        {(items as ScreenshotWithPath[]).map((item, index) => (
          <GridCard key={item.path} index={index} animate={showAppearAnimation}>
            <TargetCard
              variant="screenshot"
              target={item}
              onClick={() => onSelect?.(item)}
              disabled={disabled}
              onKeyDown={handleKeyDown}
              className="w-full"
              data-target-menu-card="true"
              highlightQuery={highlightQuery}
            />
          </GridCard>
        ))}
        {onViewAll && (
          <ViewAllButton onClick={onViewAll} label="View All Screenshots" />
        )}
      </>
    );
  };

  return (
    <div
      data-variant={props.variant}
      ref={containerRef}
      className={cn(
        "grid w-full grid-cols-2 content-start items-start justify-items-stretch gap-2",
        props.className,
      )}
    >
      {props.errorMessage ? (
        <div className="flex flex-col col-span-2 gap-2 justify-center items-center py-6 text-sm text-center text-gray-11">
          <p>{props.errorMessage}</p>
        </div>
      ) : props.isLoading ? (
        skeletonItems.map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
          <TargetCardSkeleton key={index} className="w-full" />
        ))
      ) : isEmpty ? (
        renderEmptyState()
      ) : (
        renderItems()
      )}
    </div>
  );
}
