export function ImageIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="15"
			height="15"
			viewBox="0 0 30 30"
			style={{ flexShrink: 0 }}
			{...props}
		>
			<path d="M0 0h30v30H0z" fill="none" />
			<path
				fill-rule="evenodd"
				clip-rule="evenodd"
				d="M1.875 7.5a2.813 2.813 0 0 1 2.813-2.812h20.625A2.813 2.813 0 0 1 28.125 7.5v15a2.813 2.813 0 0 1-2.813 2.813H4.688A2.813 2.813 0 0 1 1.875 22.5zM3.75 20.075V22.5c0 0.517 0.42 0.938 0.938 0.938h20.625A0.938 0.938 0 0 0 26.25 22.5v-2.425l-3.362-3.361a1.875 1.875 0 0 0-2.651 0l-1.1 1.099 1.213 1.212a0.938 0.938 0 1 1-1.325 1.325l-6.45-6.449a1.875 1.875 0 0 0-2.65 0z m12.656-9.762a1.406 1.406 0 1 1 2.813 0 1.406 1.406 0 0 1-2.813 0"
				fill="currentColor"
			/>
		</svg>
	);
}

export function VideoIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			style={{ flexShrink: "0" }}
			{...props}
		>
			<path
				d="M14.667 5.954C14.667 5.551 14.667 5.349 14.587 5.255 14.517 5.174 14.413 5.131 14.307 5.139 14.185 5.149 14.042 5.291 13.756 5.577L11.333 8 13.756 10.423C14.042 10.709 14.185 10.851 14.307 10.861 14.413 10.869 14.517 10.826 14.587 10.745 14.667 10.651 14.667 10.449 14.667 10.046V5.954Z"
				fill="currentColor"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M1.333 6.533C1.333 5.413 1.333 4.853 1.551 4.425 1.743 4.049 2.049 3.743 2.425 3.551 2.853 3.333 3.413 3.333 4.533 3.333H8.133C9.253 3.333 9.813 3.333 10.241 3.551 10.618 3.743 10.923 4.049 11.115 4.425 11.333 4.853 11.333 5.413 11.333 6.533V9.467C11.333 10.587 11.333 11.147 11.115 11.575 10.923 11.951 10.618 12.257 10.241 12.449 9.813 12.667 9.253 12.667 8.133 12.667H4.533C3.413 12.667 2.853 12.667 2.425 12.449 2.049 12.257 1.743 11.951 1.551 11.575 1.333 11.147 1.333 10.587 1.333 9.467V6.533Z"
				fill="currentColor"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function WindowIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			style={{ flexShrink: "0" }}
			{...props}
		>
			<path
				d="M2.236 12.908C2 12.48 2 11.92 2 10.8L2 5.2C2 4.08 2 3.52 2.236 3.092C2.444 2.716 2.776 2.41 3.183 2.218C3.647 2 4.253 2 5.467 2L11.533 2C12.747 2 13.353 2 13.817 2.218C14.225 2.41 14.556 2.716 14.764 3.092C15 3.52 15 4.08 15 5.2L15 10.8C15 11.92 15 12.48 14.764 12.908C14.556 13.285 14.225 13.59 13.817 13.782C13.353 14 12.747 14 11.533 14L5.467 14C4.253 14 3.647 14 3.183 13.782C2.776 13.59 2.444 13.285 2.236 12.908ZM4.167 4L4.167 4M6.333 4L6.333 4M8.5 4L8.5 4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

export function DisplayIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			style={{ flexShrink: "0" }}
			{...props}
		>
			<path
				d="M3.467 2C2.72 2 2.347 2 2.061 2.145C1.811 2.273 1.607 2.477 1.479 2.728C1.333 3.013 1.333 3.387 1.333 4.133L1.333 9.2C1.333 9.947 1.333 10.32 1.479 10.605C1.607 10.856 1.811 11.06 2.061 11.188C2.347 11.333 2.72 11.333 3.467 11.333L12.533 11.333C13.28 11.333 13.653 11.333 13.939 11.188C14.189 11.06 14.393 10.856 14.521 10.605C14.667 10.32 14.667 9.947 14.667 9.2L14.667 4.133C14.667 3.387 14.667 3.013 14.521 2.728C14.393 2.477 14.189 2.273 13.939 2.145C13.653 2 13.28 2 12.533 2L3.467 2ZM10 11.333L10 14L6 14L6 11.333"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

export function AreaIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			style={{ flexShrink: "0" }}
			{...props}
		>
			<path
				d="M2.218 12.908C2 12.48 2 11.92 2 10.8L2 5.2C2 4.08 2 3.52 2.218 3.092C2.41 2.716 2.716 2.41 3.092 2.218C3.52 2 4.08 2 5.2 2L10.8 2C11.92 2 12.48 2 12.908 2.218C13.285 2.41 13.59 2.716 13.782 3.092C14 3.52 14 4.08 14 5.2L14 10.8C14 11.92 14 12.48 13.782 12.908C13.59 13.285 13.285 13.59 12.908 13.782C12.48 14 11.92 14 10.8 14L5.2 14C4.08 14 3.52 14 3.092 13.782C2.716 13.59 2.41 13.285 2.218 12.908Z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M10.15 5.45L6.15 9.45"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M8 5L10.5 5L10.5 7.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M7.25 10.75L5 10.75L5 8.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}
