import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import type { CSSProperties, ReactNode } from "react";

interface TrackProps extends RowDefinition {
  children: ReactNode;
  hint?: string;
  isEmpty?: boolean;
  trackStyle?: CSSProperties;
}

export default function Track({
  id,
  children,
  hint,
  isEmpty,
  trackStyle,
}: TrackProps) {
  const {
    setNodeRef,
    rowWrapperStyle,
    rowStyle,
    rowSidebarStyle,
  } = useRow({
    id,
  });

  return (
    <div
      className="group/track flex-1 overflow-hidden bg-transparent"
      style={{
        ...rowWrapperStyle,
        marginBottom: 0,
        minHeight: 52,
        ...trackStyle,
      }}
    >
      <div style={rowSidebarStyle} />
      <div
        ref={setNodeRef}
        className="relative flex-1 overflow-hidden"
        style={{
          ...rowStyle,
          minHeight: 52,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        {isEmpty && hint ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center select-none">
            <span className="rounded-full border border-foreground/[0.05] bg-foreground/[0.02] px-2 py-0.5 text-[9px] font-medium tracking-[0.04em] text-foreground/30 uppercase">
              {hint}
            </span>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
