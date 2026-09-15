"use client";

import { cn } from "cn";
import type { ReactNode } from "react";

export default function NavbarFrame({
	children,
	scrolled,
}: {
	children: ReactNode;
	scrolled: boolean;
}) {
	return (
		<header className="pointer-events-none fixed inset-x-0 top-0 z-50">
			<div
				className={cn(
					"pointer-events-auto relative mx-auto mt-3 w-[calc(100%-32px)] rounded-[18px] border border-gray-5 bg-gray-2/95 backdrop-blur-xl transition-[max-width] duration-300 motion-reduce:transition-none",
					scrolled ? "max-w-140" : "max-w-200",
				)}
			>
				{children}
			</div>
		</header>
	);
}
