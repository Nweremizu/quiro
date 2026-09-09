import { Dialog } from "@base-ui/react/dialog";
import { useId, useState } from "react";

export function NameDialog({
	title,
	description,
	label,
	onClose,
	onSubmit,
}: {
	title: string;
	description: string;
	label: string;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	const [name, setName] = useState("");
	const id = useId();
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none" />
				<Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-6 bg-gray-2 p-6 text-gray-12 shadow-2xl transition-[opacity,scale] duration-200 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none">
					<div className="mb-5 h-1 w-10 rounded-full bg-accent-solid" />
					<Dialog.Title className="text-xl font-semibold tracking-tight">
						{title}
					</Dialog.Title>
					<Dialog.Description className="mt-2 text-sm leading-relaxed text-gray-10">
						{description}
					</Dialog.Description>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (name.trim()) onSubmit(name.trim());
						}}
					>
						<label
							htmlFor={id}
							className="mb-2 mt-6 block text-xs font-medium text-gray-11"
						>
							{label}
						</label>
						<input
							id={id}
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={80}
							placeholder="Give it a name…"
							className="h-11 w-full rounded-lg border border-gray-6 bg-gray-3 px-3 text-sm outline-none focus:border-accent-border-selected focus:ring-2 focus:ring-accent-focus-ring/25"
						/>
						<div className="mt-6 flex justify-end gap-2">
							<Dialog.Close className="rounded-lg px-4 py-2 text-sm text-gray-11 hover:bg-gray-4">
								Cancel
							</Dialog.Close>
							<button
								type="submit"
								disabled={!name.trim()}
								className="rounded-lg bg-accent-solid px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
							>
								Save {label.toLowerCase()}
							</button>
						</div>
					</form>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
