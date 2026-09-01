import { cn } from "../utils/helpers";

export interface LoadingSpinnerProps {
	size?: number;
	color?: string;
	borderColor?: string;
	thickness?: number;
	className?: string;
}

export function LoadingSpinner({
	size = 20,
	color = "currentColor",
	borderColor = "color-mix(in oklch, currentColor 20%, transparent)",
	thickness = 2,
	className,
}: LoadingSpinnerProps) {
	return (
		<div
			className={cn("animate-spin rounded-full", className)}
			style={{
				width: size,
				height: size,
				borderWidth: thickness,
				borderStyle: "solid",
				borderColor,
				borderTopColor: color,
			}}
		/>
	);
}
