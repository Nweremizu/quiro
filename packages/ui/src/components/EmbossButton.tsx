import { cva, type VariantProps } from "class-variance-authority";
import {
	type AnchorHTMLAttributes,
	type ButtonHTMLAttributes,
	forwardRef,
	type ReactNode,
} from "react";
import { cn } from "../utils/helpers";

// Layered pure-white/pure-black insets simulate a fixed overhead light
// source, so they read correctly on top of any `variant` background color
// without a hand-picked shadow tint per variant. oklch() rather than rgba()
// to match the project's notation (tokens.css is oklch throughout); no named
// token for these two — pure white/black are context-free constants that
// don't vary by theme or brand the way a real palette color would, so a
// token would name them without adding any decision worth reusing.
const RAISED_LAYERS = {
	none: "shadow-none",
	subtle:
		"shadow-[inset_0_1px_0_0_oklch(1_0_0/0.45),inset_0_-1px_0_0_oklch(0_0_0/0.2),0_1px_2px_0_oklch(0_0_0/0.18)] " +
		"active:shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.3),inset_0_-1px_0_0_oklch(1_0_0/0.15)]",
	medium:
		"shadow-[inset_0_1.5px_0_0_oklch(1_0_0/0.5),inset_0_-1.5px_0_0_oklch(0_0_0/0.25),inset_0_3px_4px_-2px_oklch(1_0_0/0.15),0_1px_2px_0_oklch(0_0_0/0.2),0_3px_6px_-2px_oklch(0_0_0/0.15)] " +
		"active:shadow-[inset_0_2px_3px_0_oklch(0_0_0/0.35),inset_0_-1px_0_0_oklch(1_0_0/0.2)]",
	deep:
		"shadow-[inset_0_2px_0_0_oklch(1_0_0/0.55),inset_0_-2px_0_0_oklch(0_0_0/0.3),inset_0_4px_6px_-2px_oklch(1_0_0/0.2),inset_0_-4px_6px_-3px_oklch(0_0_0/0.15),0_2px_4px_0_oklch(0_0_0/0.25),0_6px_12px_-3px_oklch(0_0_0/0.2)] " +
		"active:shadow-[inset_0_3px_5px_0_oklch(0_0_0/0.4),inset_0_-2px_0_0_oklch(1_0_0/0.25)]",
} as const;

const PRESSED_LAYERS = {
	none: "shadow-none",
	subtle:
		"shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.3),inset_0_-1px_0_0_oklch(1_0_0/0.2)] " +
		"active:shadow-[inset_0_2px_3px_0_oklch(0_0_0/0.4),inset_0_-1px_0_0_oklch(1_0_0/0.1)]",
	medium:
		"shadow-[inset_0_2px_3px_0_oklch(0_0_0/0.32),inset_0_-1.5px_0_0_oklch(1_0_0/0.22),inset_0_-3px_5px_-2px_oklch(1_0_0/0.1)] " +
		"active:shadow-[inset_0_3px_4px_0_oklch(0_0_0/0.42),inset_0_-1.5px_0_0_oklch(1_0_0/0.12),inset_0_-3px_5px_-2px_oklch(1_0_0/0.05)]",
	deep:
		"shadow-[inset_0_3px_5px_0_oklch(0_0_0/0.38),inset_0_-2px_0_0_oklch(1_0_0/0.25),inset_0_-5px_8px_-3px_oklch(1_0_0/0.12),inset_0_4px_2px_-3px_oklch(0_0_0/0.15)] " +
		"active:shadow-[inset_0_4px_6px_0_oklch(0_0_0/0.48),inset_0_-2px_0_0_oklch(1_0_0/0.15),inset_0_-5px_8px_-3px_oklch(1_0_0/0.06),inset_0_4px_2px_-3px_oklch(0_0_0/0.2)]",
} as const;

const FLAT_SHADOW = "shadow-none active:shadow-none";

type EmbossLayers = keyof typeof RAISED_LAYERS;

export const embossButtonVariants = cva(
	"relative inline-flex items-center justify-center gap-1.5 font-medium cursor-pointer select-none " +
		"outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring " +
		// Universal press feedback (emil-design-eng: every pressable element
		// gets scale(0.97) on :active) on top of whatever `emboss` adds —
		// raised also sinks 1px, pressed/flat rely on this alone.
		"active:scale-[0.97] " +
		"disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:active:translate-y-0 disabled:active:scale-100 " +
		"motion-reduce:transition-[background-color,color,border-color] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100",
	{
		variants: {
			// white on red-400 is 4.18:1 (2.97:1 in dark theme) — fails AA for
			// button-label text. text-red-on-solid is the same fix already
			// applied to text-accent-on-solid: a deep, hue-matched near-black
			// that clears 4.5:1 against the solid in both themes.
			variant: {
				primary: "bg-gray-12 text-gray-1",
				accent: "bg-accent-solid text-accent-on-solid",
				destructive: "bg-red-400 text-red-on-solid",
				gray: "bg-gray-5 text-gray-12",
				dark: "bg-gray-12 text-gray-1",
				white: "bg-gray-1 text-gray-12 border border-gray-4",
			},
			// icon: size-10 (40px), not size-9 (36px) — the dense-desktop hit-area
			// floor for a standalone control with no label to pad it out.
			size: {
				xs: "text-xs h-7 px-3 gap-1",
				sm: "text-sm h-8 px-4",
				md: "text-sm h-9 px-5",
				lg: "text-base h-10 px-6",
				icon: "size-10",
			},
			radius: {
				md: "rounded-lg",
				lg: "rounded-xl",
				full: "rounded-full",
			},
			// Non-shadow part of the emboss look: raised buttons physically move
			// down on press, pressed/flat buttons don't (they're already "in").
			// The shadow itself is set below via compoundVariants, since it
			// depends on both `emboss` and `layers` together.
			emboss: {
				raised:
					"active:translate-y-px transition-[box-shadow,transform,background-color,color,border-color] duration-150 ease-(--ease-snappy)",
				pressed:
					"transition-[box-shadow,transform,background-color,color,border-color] duration-150 ease-(--ease-snappy)",
				flat: "transition-[transform,background-color,color,border-color] duration-150 ease-(--ease-snappy)",
			},
			layers: {
				none: "",
				subtle: "",
				medium: "",
				deep: "",
			},
		},
		compoundVariants: [
			...(Object.keys(RAISED_LAYERS) as EmbossLayers[]).map((layers) => ({
				emboss: "raised" as const,
				layers,
				className: RAISED_LAYERS[layers],
			})),
			...(Object.keys(PRESSED_LAYERS) as EmbossLayers[]).map((layers) => ({
				emboss: "pressed" as const,
				layers,
				className: PRESSED_LAYERS[layers],
			})),
			{ emboss: "flat", className: FLAT_SHADOW },
		],
		defaultVariants: {
			variant: "primary",
			size: "md",
			radius: "md",
			emboss: "raised",
			layers: "medium",
		},
	},
);

export interface EmbossButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof embossButtonVariants> {
	href?: string;
	icon?: ReactNode;
}

export const EmbossButton = forwardRef<HTMLButtonElement, EmbossButtonProps>(
	(
		{ className, variant, size, radius, emboss, layers, href, icon, children, ...props },
		ref,
	) => {
		const classes = cn(
			embossButtonVariants({ variant, size, radius, emboss, layers }),
			className,
		);

		if (href) {
			return (
				<a
					ref={ref as never}
					href={href}
					className={classes}
					{...(props as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
				>
					{icon}
					{children}
				</a>
			);
		}

		return (
			<button ref={ref} className={classes} {...props}>
				{icon}
				{children}
			</button>
		);
	},
);
EmbossButton.displayName = "EmbossButton";
