import { cn } from "@quiro/ui";
import { type as osType } from "@tauri-apps/plugin-os";
import type { ComponentProps } from "react";
import { useTitlebarState } from "@/utils/titlebar-state";
import CaptionControlsWindows11 from "./windows11-titlebar-control";

export default function Titlebar() {
	const titlebarState = useTitlebarState();
	const isLeft =
		titlebarState.order === "platform"
			? osType() === "macos"
			: titlebarState.order === "left";

	return (
		<header
			className={cn(
				"flex flex-row items-center select-none space-x-1 shrink-0 border-gray-1",
				titlebarState.backgroundColor
					? titlebarState.backgroundColor
					: titlebarState.transparent
						? "bg-transparent"
						: "bg-gray-2",
				titlebarState.border && "border-b border-b-black-transparent-5",
			)}
			style={{ height: titlebarState.height }}
			data-tauri-drag-region
		>
			{isLeft ? (
				<>
					<WindowControls className="ml-0!" />
					<div className="ml-auto!">{titlebarState.items}</div>
				</>
			) : (
				<>
					{titlebarState.items}
					<WindowControls className="ml-auto!" />
				</>
			)}
		</header>
	);
}

interface WindowControlsProps extends Omit<ComponentProps<"div">, "className"> {
	className?: string;
}

export function WindowControls({ className, ...props }: WindowControlsProps) {
	const ostype = osType();

	if (ostype === "windows") {
		return (
			<CaptionControlsWindows11
				className={cn("flex ml-auto", className)}
				{...props}
			/>
		);
	}

	if (ostype === "macos") {
		return <div data-tauri-drag-region className="flex w-20 h-full" />;
	}

	return null;
}
