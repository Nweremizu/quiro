import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils/helpers";

// Track sizing per size, `cva`-driven like Button's `size` variant. The thumb
// is sized and positioned to satisfy trackWidth = 2*padding + 2*thumbWidth,
// so `translate-x-full` (100% of the THUMB's own width) always lands it
// exactly at the opposite edge — no per-size travel distance to keep in sync.
const switchVariants = cva(
	"peer inline-flex shrink-0 cursor-pointer items-center rounded-full",
	{
		variants: {
			size: {
				sm: "h-5 w-9 p-0.5",
				md: "h-6 w-11 p-0.5",
				lg: "h-8 w-14 p-1",
			},
		},
		defaultVariants: { size: "sm" },
	},
);

const THUMB_SIZE = {
	sm: "size-4",
	md: "size-5",
	lg: "size-6",
} as const;

export interface SwitchProps
	extends SwitchPrimitive.Root.Props,
		VariantProps<typeof switchVariants> {}

export function Switch({ className, size = "sm", ...props }: SwitchProps) {
	return (
		<SwitchPrimitive.Root
			className={cn(
				switchVariants({ size }),
				"transition-[background-color,transform] duration-150 ease-[var(--ease-snappy)]",
				"active:scale-[0.97] disabled:active:scale-100",
				"motion-reduce:transition-[background-color] motion-reduce:active:scale-100",
				"bg-gray-5 data-[checked]:bg-accent-solid",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus-ring",
				"disabled:cursor-not-allowed disabled:opacity-40 disabled:data-[checked]:bg-gray-5",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				className={cn(
					"pointer-events-none block rounded-full bg-white shadow-sm",
					THUMB_SIZE[size ?? "md"],
					// A single overshoot rather than a literal keyframe bounce: this
					// stays a CSS transition, so a fast double-toggle retargets from
					// wherever the thumb currently is instead of restarting from 0 —
					// a keyframe animation would visibly snap back first. Reuses the
					// existing --ease-spring-out token (already the same "back-out"
					// curve family) rather than adding a near-duplicate.
					"transition-transform duration-[260ms] ease-[var(--ease-spring-out)] motion-reduce:transition-none",
					"data-[unchecked]:translate-x-0 data-[checked]:translate-x-full",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}
