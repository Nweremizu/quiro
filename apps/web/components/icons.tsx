type IconProps = {
	name:
		| "arrow"
		| "camera"
		| "caption"
		| "cursor"
		| "download"
		| "export"
		| "layers"
		| "lock"
		| "mic"
		| "sparkle"
		| "timeline";
	className?: string;
};

const paths: Record<IconProps["name"], React.ReactNode> = {
	arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
	camera: (
		<>
			<rect x="3" y="6" width="14" height="12" rx="3" />
			<path d="m17 10 4-2v8l-4-2" />
		</>
	),
	caption: (
		<>
			<rect x="3" y="5" width="18" height="14" rx="3" />
			<path d="M7 10h4m2 0h4M7 14h6" />
		</>
	),
	cursor: <path d="m6 3 11 10-5 .8-2.8 4.5L6 3Z" />,
	download: (
		<>
			<path d="M12 3v12m-5-5 5 5 5-5" />
			<path d="M5 20h14" />
		</>
	),
	export: (
		<>
			<path d="M14 4h6v6" />
			<path d="m20 4-9 9" />
			<path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
		</>
	),
	layers: (
		<>
			<path d="m12 3 9 5-9 5-9-5 9-5Z" />
			<path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="10" width="14" height="11" rx="3" />
			<path d="M8 10V7a4 4 0 0 1 8 0v3" />
		</>
	),
	mic: (
		<>
			<rect x="9" y="3" width="6" height="12" rx="3" />
			<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
		</>
	),
	sparkle: (
		<path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Zm7 13 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
	),
	timeline: (
		<>
			<path d="M4 6h16M4 12h16M4 18h16" />
			<circle cx="8" cy="6" r="2" />
			<circle cx="16" cy="12" r="2" />
			<circle cx="10" cy="18" r="2" />
		</>
	),
};

export function Icon({ name, className }: IconProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{paths[name]}
		</svg>
	);
}
