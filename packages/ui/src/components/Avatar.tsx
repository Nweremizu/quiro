import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../utils/helpers";

export interface AvatarProps {
	name: string | null | undefined;
	imageUrl?: string | null;
	className?: string;
	letterClassName?: string;
}

// ponytail: Cap's version picks from a 26-color rainbow palette keyed by the
// first letter. Flatter/more restrained brand direction — one neutral tile
// for every fallback rather than a different hue per letter. Swap back to a
// palette here if per-user color distinction turns out to matter.
export function Avatar({
	name,
	imageUrl,
	className,
	letterClassName,
}: AvatarProps) {
	const initial = name?.[0]?.toUpperCase() || "?";

	return (
		<AvatarPrimitive.Root
			className={cn(
				"flex size-8 items-center justify-center overflow-hidden rounded-full bg-gray-4 text-gray-11",
				className,
			)}
		>
			{imageUrl && (
				<AvatarPrimitive.Image
					src={imageUrl}
					alt={name ?? "Avatar"}
					className="size-full object-cover"
					referrerPolicy="no-referrer"
				/>
			)}
			<AvatarPrimitive.Fallback
				className={cn("text-xs font-medium", letterClassName)}
			>
				{initial}
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	);
}
