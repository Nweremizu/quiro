import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
