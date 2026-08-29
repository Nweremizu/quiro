import { Button } from "@base-ui/react/button";
import { cn } from "@quiro/ui";
import IconChevronDown from "~icons/ci/chevron-down";

type MenuDropdownButtonProps = {
	className?: string;
	disabled?: boolean;
	expanded?: boolean;
} & React.ComponentProps<typeof Button>;

export default function MenuDropdownButton({
	className,
	expanded = false,
	disabled,
	...props
}: MenuDropdownButtonProps) {
	return (
		<Button
			{...props}
			type="button"
			disabled={disabled}
			aria-expanded={expanded}
			data-expanded={expanded ? "true" : "false"}
			className={cn(
				"flex w-7 shrink-0 items-center justify-center rounded-lg bg-gray-4 text-gray-12 transition-colors duration-150 hover:bg-gray-6 active:bg-gray-7 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1",
				expanded && "bg-accent-100 text-accent-500",
				disabled && "pointer-events-none opacity-60",
				className,
			)}
		>
			<IconChevronDown
				className={cn(
					"size-4 text-gray-11 transition-transform duration-150",
					expanded && "rotate-180 text-gray-12",
				)}
			/>
		</Button>
	);
}
