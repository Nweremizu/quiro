import type { SVGProps } from "react";

export type MediaControlVariant = "play" | "pause" | "next" | "previous";

interface MediaControlIconProps extends SVGProps<SVGSVGElement> {
	variant?: MediaControlVariant;
}

export function MediaControlIcon({
	variant = "play",
	className,
	...props
}: MediaControlIconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={className}
			{...props}
		>
			{/* PLAY */}
			{variant === "play" && (
				<path
					d="
          M7.5 5.65
          C7.5 4.45 8.82 3.72 9.83 4.38
          L18.55 10.05
          C19.48 10.66 19.48 12.02 18.55 12.63
          L9.83 18.3
          C8.82 18.96 7.5 18.23 7.5 17.03
          Z
        "
				/>
			)}

			{/* PAUSE */}
			{variant === "pause" && (
				<>
					<rect x="6.5" y="4" width="4" height="16" rx="2" />

					<rect x="13.5" y="4" width="4" height="16" rx="2" />
				</>
			)}

			{/* NEXT */}
			{variant === "next" && (
				<>
					<path
						d="
            M5.5 5.65
            C5.5 4.45 6.82 3.72 7.83 4.38
            L15.55 10.05
            C16.48 10.66 16.48 12.02 15.55 12.63
            L7.83 18.3
            C6.82 18.96 5.5 18.23 5.5 17.03
            Z
          "
					/>

					<rect x="17.5" y="4" width="3" height="16" rx="1.5" />
				</>
			)}

			{/* PREVIOUS */}
			{variant === "previous" && (
				<>
					<rect x="3.5" y="4" width="3" height="16" rx="1.5" />

					<path
						d="
            M18.5 5.65
            C18.5 4.45 17.18 3.72 16.17 4.38
            L8.45 10.05
            C7.52 10.66 7.52 12.02 8.45 12.63
            L16.17 18.3
            C17.18 18.96 18.5 18.23 18.5 17.03
            Z
          "
					/>
				</>
			)}
		</svg>
	);
}
