import type { SVGProps } from "react";

type VideoIconProps = SVGProps<SVGSVGElement> & {
	strokeColor?: string;
	fillColor?: string;
	strokeWidth?: number;
};

export function VideoIcon({
	className,
	strokeColor = "currentColor",
	fillColor = "none",
	strokeWidth = 2,
	...props
}: VideoIconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			{...props}
		>
			<path
				d="M22 8.931C22 8.326 22 8.023 21.88 7.882C21.776 7.761 21.62 7.696 21.461 7.709C21.277 7.723 21.063 7.937 20.634 8.366L17 12L20.634 15.634C21.063 16.063 21.277 16.277 21.461 16.291C21.62 16.304 21.776 16.239 21.88 16.118C22 15.977 22 15.674 22 15.069V8.931Z"
				fill={fillColor}
				stroke={strokeColor}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			<path
				d="M2 9.8C2 8.12 2 7.28 2.327 6.638C2.615 6.074 3.074 5.615 3.638 5.327C4.28 5 5.12 5 6.8 5H12.2C13.88 5 14.72 5 15.362 5.327C15.927 5.615 16.385 6.074 16.673 6.638C17 7.28 17 8.12 17 9.8V14.2C17 15.88 17 16.72 16.673 17.362C16.385 17.927 15.927 18.385 15.362 18.673C14.72 19 13.88 19 12.2 19H6.8C5.12 19 4.28 19 3.638 18.673C3.074 18.385 2.615 17.927 2.327 17.362C2 16.72 2 15.88 2 14.2V9.8Z"
				fill={fillColor}
				stroke={strokeColor}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
