"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "./popover";

interface ContentClampProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode;
	truncateLength?: number;
}

function ContentClamp({ children, className, truncateLength = 50, ...props }: ContentClampProps) {
	const text = typeof children === "string" ? children : String(children ?? "");
	const isTruncated = text.length > truncateLength;

	const [open, setOpen] = React.useState(false);
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearScheduledClose = () => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	};

	const openPopover = () => {
		clearScheduledClose();
		setOpen(true);
	};

	const scheduleClose = () => {
		clearScheduledClose();
		timeoutRef.current = setTimeout(() => {
			setOpen(false);
			timeoutRef.current = null;
		}, 100);
	};

	const togglePopover = () => {
		clearScheduledClose();
		setOpen((currentOpen) => !currentOpen);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		togglePopover();
	};

	React.useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
		};
	}, []);

	if (!isTruncated) {
		return (
			<div className={cn("inline", className)} {...props}>
				{children}
			</div>
		);
	}

	const truncatedText = text.slice(0, truncateLength) + "...";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<span
					className={cn("cursor-help", className)}
					onMouseEnter={openPopover}
					onMouseLeave={scheduleClose}
					onFocus={openPopover}
					onBlur={scheduleClose}
					onClick={(event) => {
						event.preventDefault();
						togglePopover();
					}}
					onKeyDown={handleKeyDown}
					role="button"
					tabIndex={0}
					aria-haspopup="dialog"
					aria-expanded={open}
					{...props}
				>
					{truncatedText}
				</span>
			</PopoverTrigger>
			<PopoverContent
				className="w-auto max-w-sm rounded-lg border border-white bg-popover p-3 text-sm text-popover-foreground"
				sideOffset={8}
				animated={false}
				onMouseEnter={openPopover}
				onMouseLeave={scheduleClose}
				onPointerDownOutside={(e) => e.preventDefault()}
				onClick={(e) => e.stopPropagation()}
			>
				<PopoverArrow className="fill-white" />
				{children}
			</PopoverContent>
		</Popover>
	);
}

export { ContentClamp };
