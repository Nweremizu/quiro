import { cn } from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { type ReactNode, useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { Slider, type SliderSize } from "@/components/Scrubber";
import { Tooltip } from "@/components/Tooltip";
import IconLucideImage from "~icons/lucide/image";
import IconLucideX from "~icons/lucide/x";
import { WALLPAPER_FILENAMES } from "./constants";

// React ports of Cap's screenshot-editor `ui.tsx` primitives. Kept as their
// own module for the same reason Cap does: every popover in the toolbar is
// built from these three, so they have to look and behave identically or the
// toolbar stops reading as one coherent control surface.

/** Cap's `EditorButton`: icon (+ optional label) in a compact 32px pill that
 * highlights while its popover is open (`active`). */
export function EditorButton({
	icon,
	label,
	tooltip,
	kbd,
	active,
	disabled,
	onClick,
	children,
}: {
	icon: ReactNode;
	label?: string;
	tooltip: string;
	kbd?: string[];
	active?: boolean;
	disabled?: boolean;
	onClick?: () => void;
	children?: ReactNode;
}) {
	return (
		<Tooltip content={tooltip} kbd={kbd}>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				aria-label={tooltip}
				className={cn(
					"flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] outline-none transition-colors duration-100",
					"focus-visible:ring-2 focus-visible:ring-accent-400/50 disabled:pointer-events-none disabled:opacity-45",
					active
						? "bg-accent-300 text-gray-1"
						: "text-gray-11 hover:bg-gray-3 hover:text-gray-12",
				)}
			>
				{icon}
				{/* The only caller passes a live zoom percentage here, so the
				    digits must not reflow the pill as they change. */}
				{label && <span className="tabular-nums">{label}</span>}
				{children}
			</button>
		</Tooltip>
	);
}

/** Section heading inside a popover, matching Cap's `Field`. */
export function Field({
	name,
	icon,
	value,
	children,
}: {
	name: string;
	icon?: ReactNode;
	value?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="flex flex-row items-center gap-1.5 text-xs font-medium text-gray-11">
				{icon}
				{name}
				{value && <span className="ml-auto text-gray-10">{value}</span>}
			</span>
			{children}
		</div>
	);
}

export function rgbToHex(rgb: [number, number, number]) {
	return `#${rgb
		.map((c) => c.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
	const cleaned = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-f]{6}$/i.test(cleaned)) return null;
	const value = Number.parseInt(cleaned, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Cap's `RgbInput`: a swatch that opens the native colour picker, paired with
 * an editable hex field. The hex field commits on Enter/blur and reverts to
 * the last good value if what was typed isn't a colour, so a half-typed hex
 * never propagates into the project as garbage.
 */
export function RgbInput({
	value,
	onChange,
}: {
	value: [number, number, number];
	onChange: (value: [number, number, number]) => void;
}) {
	const [text, setText] = useState(() => rgbToHex(value));
	const [editing, setEditing] = useState(false);

	// While not being edited the field mirrors the project; during editing it
	// holds whatever's typed, so a partial hex isn't overwritten mid-keystroke.
	const displayed = editing ? text : rgbToHex(value);

	const commit = (raw: string) => {
		const parsed = hexToRgb(raw);
		if (parsed) onChange(parsed);
		setEditing(false);
	};

	return (
		<div className="flex flex-row items-center gap-2">
			<label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-gray-5">
				<span
					className="block size-full"
					style={{ backgroundColor: rgbToHex(value) }}
				/>
				<input
					type="color"
					value={rgbToHex(value)}
					onChange={(e) => {
						const parsed = hexToRgb(e.target.value);
						if (parsed) onChange(parsed);
					}}
					className="absolute inset-0 cursor-pointer opacity-0"
				/>
			</label>
			<input
				type="text"
				value={displayed}
				spellCheck={false}
				onFocus={() => {
					setText(rgbToHex(value));
					setEditing(true);
				}}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						commit(e.currentTarget.value);
						e.currentTarget.blur();
					}
				}}
				onBlur={(e) => commit(e.target.value)}
				className="h-8 w-24 rounded-lg border border-gray-5 bg-gray-1 px-2 text-[13px] text-gray-12 outline-none transition-shadow focus:ring-1 focus:ring-accent-400"
			/>
		</div>
	);
}

export function ToolbarDivider() {
	return <div className="mx-0.5 h-5 w-px shrink-0 bg-gray-12/10" />;
}

/** One bundled wallpaper. The renderer takes a real filesystem path, so each
 * thumbnail resolves its resource once and hands that same path to the
 * config on click. */
/** Exported so callers besides `WallpaperTab` can reuse the same
 * resolve-then-select logic for a filename outside `WALLPAPER_FILENAMES` —
 * the video editor's gradient-section image presets, for one. */
export function WallpaperThumbnail({
	filename,
	selectedPath,
	onSelect,
}: {
	filename: string;
	selectedPath: string | null;
	onSelect: (resolvedPath: string) => void;
}) {
	const [resolved, setResolved] = useState<string | null>(null);
	// `resolveResource` only joins the path against the app's resource dir —
	// it doesn't check the file is actually there, so a missing asset used to
	// leave the button enabled with a broken <img> and a console 404 instead
	// of reading as unavailable. The <img>'s own onError is what actually
	// catches a missing file.
	const [broken, setBroken] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setBroken(false);
		resolveResource(`assets/backgrounds/${filename}`)
			.then((path) => {
				if (!cancelled) setResolved(path);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [filename]);

	const usable = resolved !== null && !broken;
	const selected = usable && resolved === selectedPath;
	// `filename` may include a subdirectory (the video editor's gradient
	// presets, e.g. "gradients/blue-sky.png") — humanize just the basename,
	// not the path segments before it.
	const basename = filename.slice(filename.lastIndexOf("/") + 1);
	const label = basename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");

	return (
		<button
			type="button"
			disabled={!usable}
			onClick={() => usable && onSelect(resolved)}
			aria-label={label}
			aria-pressed={selected}
			title={label}
			className={cn(
				"aspect-square size-8 overflow-hidden rounded-lg bg-gray-4 transition-[box-shadow]",
				selected
					? "ring-2 ring-accent-400 ring-offset-2 ring-offset-gray-1"
					: "hover:ring-1 hover:ring-gray-8",
			)}
		>
			{resolved && !broken && (
				<img
					src={convertFileSrc(resolved)}
					alt=""
					loading="lazy"
					draggable={false}
					onError={() => setBroken(true)}
					className="size-full object-cover"
				/>
			)}
		</button>
	);
}

/** Grid of the wallpapers bundled as Tauri resources. Shared by both editors:
 * the same background config drives the same renderer in each. */
export function WallpaperTab({
	selectedPath,
	onSelect,
	className,
}: {
	selectedPath: string | null;
	onSelect: (resolvedPath: string) => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid max-h-56 grid-cols-6 gap-2 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-6 scrollbar-track-transparent",
				className,
			)}
		>
			{WALLPAPER_FILENAMES.map((filename) => (
				<WallpaperThumbnail
					key={filename}
					filename={filename}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

export function ImageTab({
	path,
	onPick,
	onClear,
}: {
	path: string | null;
	onPick: () => void;
	onClear: () => void;
}) {
	if (!path) {
		return (
			<button
				type="button"
				onClick={onPick}
				className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-5 bg-gray-2 p-6 text-[13px] transition-colors hover:bg-gray-3"
			>
				<IconLucideImage className="size-6 text-gray-10" />
				<span className="text-gray-10">Click to select an image</span>
			</button>
		);
	}

	return (
		<div className="relative h-32 w-full overflow-hidden rounded-lg border border-gray-3">
			<img
				src={convertFileSrc(path)}
				alt=""
				className="size-full object-cover"
			/>
			<button
				type="button"
				onClick={onClear}
				aria-label="Remove background image"
				className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
			>
				<IconLucideX className="size-3.5" />
			</button>
		</div>
	);
}

export { PanelSection, Slider, type SliderSize };
