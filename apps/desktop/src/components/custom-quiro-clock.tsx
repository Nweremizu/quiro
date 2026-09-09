import type { SVGProps } from "react";

interface GaugeIconProps extends SVGProps<SVGSVGElement> {
	strokeWidth?: number;
}

export function GaugeIcon({
	className,
	strokeWidth = 2,
	...props
}: GaugeIconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			className={className}
			{...props}
		>
			{/* Complete circle */}
			<circle
				cx="12"
				cy="12"
				r="10"
				stroke={props.fill}
				strokeWidth={strokeWidth}
			/>

			{/* Needle */}
			<path
				d="M12 14L16 10"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
