import { Toaster as SonnerToaster, type ToasterProps, toast } from "sonner";
import "sonner/dist/styles.css";

export { toast };

// Sonner ships its own light/dark hsl palette behind CSS custom properties
// (--normal-bg, --success-bg, ...) read by its stylesheet's [data-rich-colors]
// rules. Pointing those at our oklch tokens (instead of fighting the shipped
// CSS's specificity with !important classNames) means every toast type
// re-themes for free whenever :root.dark flips, no separate dark block here.
export function Toaster({ style, ...props }: ToasterProps) {
	return (
		<SonnerToaster
			richColors
			{...props}
			style={
				{
					"--normal-bg": "var(--gray-1)",
					"--normal-border": "var(--gray-3)",
					"--normal-text": "var(--gray-12)",
					"--success-bg": "var(--jade-2)",
					"--success-border": "var(--jade-6)",
					"--success-text": "var(--jade-11)",
					"--info-bg": "var(--blue-2)",
					"--info-border": "var(--blue-6)",
					"--info-text": "var(--blue-11)",
					"--warning-bg": "var(--accent-50)",
					"--warning-border": "var(--accent-200)",
					"--warning-text": "var(--accent-500)",
					"--error-bg": "var(--red-2)",
					"--error-border": "var(--red-6)",
					"--error-text": "var(--red-11)",
					"--gray11": "var(--gray-11)",
					"--border-radius": "0.75rem",
					fontFamily: "inherit",
					...style,
				} as React.CSSProperties
			}
		/>
	);
}
