import { cn } from "@quiro/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ComponentProps, useEffect, useState } from "react";

type TrafficLightType = "close" | "minimize" | "zoom";

const TRAFFIC_LIGHT_COLORS: Record<
  TrafficLightType,
  { bg: string; iconColor: string }
> = {
  close: { bg: "#FF5F57", iconColor: "rgba(0, 0, 0, 0.5)" },
  minimize: { bg: "#FEBC2E", iconColor: "rgba(0, 0, 0, 0.5)" },
  zoom: { bg: "#28C840", iconColor: "rgba(0, 0, 0, 0.5)" },
};

const TRAFFIC_LIGHT_LABELS: Record<TrafficLightType, string> = {
  close: "Close window",
  minimize: "Minimize window",
  zoom: "Expand or collapse window",
};

const TRAFFIC_LIGHT_PATHS: Record<TrafficLightType, string> = {
  close:
    "M1.182 1.182a.625.625 0 0 1 .884 0L4 3.116l1.934-1.934a.625.625 0 1 1 .884.884L4.884 4l1.934 1.934a.625.625 0 1 1-.884.884L4 4.884 2.066 6.818a.625.625 0 1 1-.884-.884L3.116 4 1.182 2.066a.625.625 0 0 1 0-.884Z",
  minimize: "M1 4a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5A.5.5 0 0 1 1 4Z",
  zoom: "M.75.75H6.5L.75 6.5V.75ZM7.25 7.25H1.5l5.75-5.75v5.75Z",
};

interface CaptionControlsMacOSProps extends Omit<
  ComponentProps<"div">,
  "className"
> {
  className?: string;
  showMinimize?: boolean;
  showZoom?: boolean;
  onZoom?: () => void;
}

export default function MACOSTitlebarControls({
  className,
  showMinimize = true,
  showZoom = true,
  onZoom,
  ...props
}: CaptionControlsMacOSProps) {
  const currentWindow = getCurrentWindow();
  const [focused, setFocused] = useState(true);
  const [hovered, setHovered] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <We only want to run this effect once on mount, and the currentWindow reference is stable.>
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    currentWindow
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(
        "flex flex-row items-center gap-2.5 h-full cursor-default select-none",
        className,
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      <TrafficLightButton
        type="close"
        focused={focused}
        hovered={hovered}
        onClick={() => currentWindow.close()}
      />
      {showMinimize && (
        <TrafficLightButton
          type="minimize"
          focused={focused}
          hovered={hovered}
          onClick={() => currentWindow.minimize()}
        />
      )}
      {showZoom && (
        <TrafficLightButton
          type="zoom"
          focused={focused}
          hovered={hovered}
          onClick={() =>
            onZoom ? onZoom() : void currentWindow.toggleMaximize()
          }
        />
      )}
    </div>
  );
}

interface TrafficLightButtonProps {
  type: TrafficLightType;
  focused: boolean;
  hovered: boolean;
  onClick: () => void;
}

function TrafficLightButton({
  type,
  focused,
  hovered,
  onClick,
}: TrafficLightButtonProps) {
  const color = TRAFFIC_LIGHT_COLORS[type];

  return (
    <button
      type="button"
      aria-label={TRAFFIC_LIGHT_LABELS[type]}
      className="size-3.5 rounded-full flex items-center justify-center transition-colors duration-100 hover:brightness-95 active:brightness-90"
      style={{ backgroundColor: focused ? color.bg : "#DCDCDC" }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {hovered && focused && (
        <TrafficLightIcon type={type} color={color.iconColor} />
      )}
    </button>
  );
}

interface TrafficLightIconProps {
  type: TrafficLightType;
  color: string;
}

function TrafficLightIcon({ type, color }: TrafficLightIconProps) {
  const size = type === "zoom" ? "8" : "10";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={TRAFFIC_LIGHT_PATHS[type]} fill={color} />
    </svg>
  );
}
