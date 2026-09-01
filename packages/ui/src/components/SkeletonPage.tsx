import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

export interface SkeletonPageProps {
	children?: ReactNode;
}

// Generic page-loading placeholder: a title, a couple of text lines, and a
// content block. Pass children to render a fully custom skeleton shape
// instead (e.g. multiple Skeleton pieces laid out to match a specific page).
export function SkeletonPage({ children }: SkeletonPageProps) {
	if (children) return <div>{children}</div>;

	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-8 w-64" />
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
			</div>
			<Skeleton className="h-32 w-full" />
		</div>
	);
}
