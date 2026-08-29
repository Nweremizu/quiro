import type { ReactNode } from "react";
import { cn } from "../utils/helpers";

export interface LogoSpinnerProps {
  className?: string;
  children?: ReactNode;
}

// ponytail: Cap's version is a hardcoded SVG of Cap's own logo mark (fixed
// blue rings, "Cap" branding). No Quiro logo asset exists yet, and
// fabricating one isn't this component's job — this is a reusable spinning-
// ring shell instead; drop your actual mark in as children once it exists.
export function LogoSpinner({ className, children }: LogoSpinnerProps) {
  return (
    <div className={cn("relative flex size-10 items-center justify-center", className)}>
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent-100 border-t-accent-300" />
      {children}
    </div>
  );
}
