import { cva, type VariantProps } from "class-variance-authority";
import {
	type AnchorHTMLAttributes,
	type ButtonHTMLAttributes,
	forwardRef,
	type ReactNode,
} from "react";
import { cn } from "../utils/helpers";
import { LoadingSpinner } from "./LoadingSpinner";

// ponytail: no asChild/Slot polymorphism (Cap's version supports it via
// @radix-ui/react-slot; Base UI's equivalent is the `render` prop, which
// needs its own merge-props plumbing). `href` covers the one case that
// actually comes up — add real polymorphism if a second one does.
export const buttonVariants = cva(
	"relative inline-flex items-center justify-center gap-1 rounded-lg font-medium cursor-pointer disabled:cursor-not-allowed " +
		// Properties named individually — `transition-all` would animate
		// unintended properties off the GPU. The press is feedback, not
		// decoration, so it stays even on the most frequently clicked control.
		"transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-snappy)] " +
		"active:scale-[0.97] disabled:active:scale-100 " +
		"motion-reduce:transition-[background-color,border-color,color] motion-reduce:active:scale-100",
	{
		variants: {
			variant: {
				primary:
					"bg-gray-12 text-gray-1 disabled:bg-gray-6 disabled:text-gray-9",
				// text-accent-on-solid, not white: the brand orange is light
				// enough that white on it is 2.66:1 (and the old accent-300
				// was 1.91:1). The warm near-black is 6.27:1.
				accent:
					"bg-accent-solid text-accent-on-solid hover:bg-accent-solid-hover active:bg-accent-solid-active disabled:bg-gray-7 disabled:text-gray-10",
				destructive:
					"bg-red-400 text-white hover:bg-red-500 disabled:bg-gray-7 disabled:text-gray-10",
				outline:
					"border border-gray-4 hover:border-gray-5 hover:bg-gray-3 text-gray-12 disabled:opacity-50",
				white:
					"bg-gray-3 border border-gray-5 hover:border-gray-6 hover:bg-gray-6 text-gray-12 disabled:opacity-50",
				gray: "bg-gray-5 hover:bg-gray-7 text-gray-12 disabled:bg-gray-8 disabled:text-gray-11",
				dark: "bg-gray-12 hover:bg-gray-11 text-gray-1 disabled:bg-gray-7 disabled:text-gray-10",
				ghost: "hover:bg-gray-3 text-gray-11 hover:text-gray-12",
				transparent: "text-gray-10 hover:text-gray-12 hover:underline",
			},
			size: {
				xs: "text-xs h-7 px-3",
				sm: "text-sm h-8 px-4",
				md: "text-sm h-9 px-5",
				lg: "text-base h-10 px-6",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "md",
		},
	},
);

export interface ButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	href?: string;
	spinner?: boolean;
	icon?: ReactNode;
	kbd?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{ className, variant, size, href, spinner, icon, kbd, children, ...props },
		ref,
	) => {
		const classes = cn(buttonVariants({ variant, size }), className);

		if (href) {
			return (
				<a
					ref={ref as never}
					href={href}
					className={classes}
					{...(props as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
				>
					{spinner && <LoadingSpinner size={16} />}
					{icon}
					{children}
					{kbd && <Kbd>{kbd}</Kbd>}
				</a>
			);
		}

		return (
			<button ref={ref} className={classes} {...props}>
				{spinner && <LoadingSpinner size={16} />}
				{icon}
				{children}
				{kbd && <Kbd>{kbd}</Kbd>}
			</button>
		);
	},
);
Button.displayName = "Button";

function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="hidden md:flex items-center justify-center ml-1 size-5 rounded-full border border-gray-10 bg-gray-11 text-xs text-gray-1">
			{children}
		</kbd>
	);
}
