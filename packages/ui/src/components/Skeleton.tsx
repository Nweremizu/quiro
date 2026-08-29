import type { HTMLAttributes } from "react";
import { cn } from "../utils/helpers";

// ponytail: Cap depends on `react-loading-skeleton` for this. Tailwind's
// built-in animate-pulse covers the same "shimmering placeholder" job with
// zero extra dependency — swap to a shimmer-gradient library only if
// animate-pulse's flat pulse ever looks visibly worse in practice.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-gray-4", className)} {...props} />;
}
