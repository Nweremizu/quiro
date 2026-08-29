import type { ReactNode } from "react";

interface ShowProps {
  when: string | boolean | null;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Show({ when, children, fallback = null }: ShowProps) {
  return when ? children : fallback;
}
