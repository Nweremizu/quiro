import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button, type ButtonProps } from "@quiro/ui";
import type { ReactNode } from "react";

export function ConfirmAction({
	children,
	title,
	description,
	confirmLabel,
	onConfirm,
	triggerVariant = "outline",
	triggerSize = "sm",
	triggerClassName,
	confirmVariant = "destructive",
}: {
	children: ReactNode;
	title: string;
	description: string;
	confirmLabel: string;
	onConfirm: () => void;
	triggerVariant?: ButtonProps["variant"];
	triggerSize?: ButtonProps["size"];
	triggerClassName?: string;
	confirmVariant?: ButtonProps["variant"];
}) {
	return (
		<AlertDialog.Root>
			<AlertDialog.Trigger
				render={
					<Button
						type="button"
						variant={triggerVariant}
						size={triggerSize}
						className={triggerClassName}
					/>
				}
			>
				{children}
			</AlertDialog.Trigger>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="fixed inset-0 z-500 min-h-dvh bg-black/50" />
				<AlertDialog.Popup className="fixed left-1/2 top-1/2 z-501 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border border-gray-4 bg-gray-1 p-5 text-gray-12 shadow-lg outline-none">
					<div className="flex flex-col gap-1.5">
						<AlertDialog.Title className="text-balance text-base font-semibold">
							{title}
						</AlertDialog.Title>
						<AlertDialog.Description className="text-pretty text-sm text-gray-10">
							{description}
						</AlertDialog.Description>
					</div>
					<div className="flex justify-end gap-2">
						<AlertDialog.Close
							render={<Button type="button" variant="outline" size="sm" />}
						>
							Cancel
						</AlertDialog.Close>
						<AlertDialog.Close
							render={
								<Button
									type="button"
									variant={confirmVariant}
									size="sm"
									onClick={onConfirm}
								/>
							}
						>
							{confirmLabel}
						</AlertDialog.Close>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
