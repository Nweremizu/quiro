import Link from "next/link";
import type { CSSProperties } from "react";

type LogoProps = {
	inverted?: boolean;
};

export function Logo({ inverted = false }: LogoProps) {
	return (
		<Link
			className="brand"
			data-inverted={inverted || undefined}
			href="/"
			aria-label="Quiro home"
		>
			<span className="brand-symbol">
				<BrandMark />
			</span>
			<span>Quiro</span>
		</Link>
	);
}

export function BrandMark({
	className,
	style,
}: {
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<svg
			className={className}
			style={style}
			viewBox="30 28 176 176"
			aria-hidden="true"
		>
			<path
				fill="currentColor"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M75.213 34.1612C80.3025 33.4587 89.6035 35.15 94.2593 37.3325C98.7249 39.426 103.613 42.5636 107.9 45.142L129.204 57.9114L168.659 81.2285C180.935 88.6216 196.019 94.5903 194.946 111.755C193.99 127.038 184.527 130.569 172.775 136.231L157.963 143.402C146.987 148.797 135.997 155.668 126.874 163.85C111.72 177.037 103.33 195.418 80.1109 197.807C70.734 198.787 61.3513 196.004 54.0209 190.071C46.8063 184.136 42.2452 175.574 41.3424 166.271C40.8157 160.944 41.0522 153.072 41.0573 147.525L41.0579 116.463L41.0698 85.4623C41.0753 79.269 40.7967 69.9321 41.8545 64.0587C42.9678 57.8977 45.6742 52.1363 49.704 47.3477C56.267 39.4233 65.0637 35.126 75.213 34.1612ZM185.042 145.082C191.144 144.171 188.571 151.108 187.808 154.223C180.03 186 151.806 196.336 122.125 198C120.702 198.015 118.005 197.602 118 195.868C117.99 192.7 121.347 187.492 123.099 185.02C134.793 168.531 152.216 157.2 170.741 149.652C175.268 147.807 180.326 145.972 185.042 145.082Z"
			/>
		</svg>
	);
}
