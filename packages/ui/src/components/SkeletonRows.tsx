import { Skeleton } from "./Skeleton";

export interface SkeletonRowsProps {
	count?: number;
}

// ponytail: Cap's version is a full recordings-grid skeleton (thumbnail +
// title + view/comment/reaction counts) — tightly coupled to a screen Quiro
// doesn't have yet. Generic row shimmer instead; reshape it (or use
// SkeletonPage's `children` escape hatch) once a specific list screen exists.
export function SkeletonRows({ count = 6 }: SkeletonRowsProps) {
	return (
		<div className="flex flex-col gap-3">
			{Array.from({ length: count }, (_, index) => (
				<div
					key={index}
					className="flex items-center gap-3 rounded-lg border border-gray-3 p-3"
				>
					<Skeleton className="size-9 shrink-0 rounded-full" />
					<div className="flex flex-1 flex-col gap-1.5">
						<Skeleton className="h-3.5 w-1/3" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				</div>
			))}
		</div>
	);
}
