import { cn } from "@quiro/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import IconLucidePencil from "~icons/lucide/pencil";

// Inline rename for the screenshot's display name, living in the titlebar.
//
// Idle: a hover-highlighted pill with a pencil hint. Double-click, F2 or Enter
// opens it. Editing: an auto-width input in the exact same spot — same
// typography, no form-field chrome — pre-selected, with an accent rule that
// draws in left-to-right. Enter or blur commits, Escape reverts. A blank name
// is refused with a shake and keeps the field open.
//
// Renaming a screenshot is a rare action, so the draw-in is deliberate delight;
// the return to idle is instant, and nothing moves under prefers-reduced-motion.

export function FileNameEditor({
	name,
	onRename,
}: {
	name: string;
	onRename: (next: string) => void | Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const [rejected, setRejected] = useState(false);
	const [inputWidth, setInputWidth] = useState<number>();

	const buttonRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const mirrorRef = useRef<HTMLSpanElement>(null);
	const refocusButton = useRef(false);

	// Follow an external rename while the field is idle.
	useEffect(() => {
		if (!editing) setDraft(name);
	}, [name, editing]);

	// Size the input to its text via a hidden mirror, so it reads as editing
	// the label in place rather than typing into a box. A ResizeObserver keeps
	// it in step with the draft (and any late font reflow) without a dep on it.
	useLayoutEffect(() => {
		const mirror = mirrorRef.current;
		if (!mirror) return;
		const measure = () => setInputWidth(mirror.offsetWidth + 2);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(mirror);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		} else if (refocusButton.current) {
			refocusButton.current = false;
			buttonRef.current?.focus();
		}
	}, [editing]);

	const begin = () => {
		setDraft(name);
		setEditing(true);
	};

	const commit = (fromKeyboard: boolean) => {
		const next = draft.trim();
		if (!next) {
			setDraft(name);
			setRejected(true);
			window.setTimeout(() => setRejected(false), 260);
			inputRef.current?.select();
			return;
		}
		refocusButton.current = fromKeyboard;
		setEditing(false);
		if (next !== name) void onRename(next);
	};

	const cancel = () => {
		refocusButton.current = true;
		setDraft(name);
		setEditing(false);
	};

	return (
		<div className="relative flex min-w-0 items-center">
			<span
				ref={mirrorRef}
				aria-hidden
				className="pointer-events-none invisible absolute whitespace-pre px-1.5 text-sm font-medium"
			>
				{draft || " "}
			</span>

			{editing ? (
				<span
					className={cn(
						"relative inline-flex items-center",
						rejected && "file-name-shake",
					)}
				>
					<input
						ref={inputRef}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={() => commit(false)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commit(true);
							} else if (event.key === "Escape") {
								event.preventDefault();
								cancel();
							}
						}}
						aria-label="Screenshot name"
						spellCheck={false}
						autoComplete="off"
						style={{ width: inputWidth }}
						className="min-w-[3ch] max-w-[52vw] rounded-md bg-gray-3 px-1.5 py-0.5 text-sm font-medium text-gray-12 outline-none ring-1 ring-accent-focus-ring/50"
					/>
					<span
						aria-hidden
						className={cn(
							"file-name-rule pointer-events-none absolute inset-x-1.5 bottom-0 h-px rounded-full",
							rejected ? "bg-red-9" : "bg-accent-solid",
						)}
					/>
				</span>
			) : (
				<button
					ref={buttonRef}
					type="button"
					onDoubleClick={(event) => {
						// Suppress the browser's word-selection so the field opens
						// clean with everything selected.
						event.preventDefault();
						begin();
					}}
					onKeyDown={(event) => {
						if (event.key === "F2" || event.key === "Enter") {
							event.preventDefault();
							begin();
						}
					}}
					title={`${name} — double-click to rename`}
					className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none transition-colors duration-150 hover:bg-gray-3 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50"
				>
					<span className="truncate text-sm font-medium text-gray-12">
						{name}
					</span>
					<IconLucidePencil
						aria-hidden
						className="size-3 shrink-0 text-gray-9 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
					/>
				</button>
			)}
		</div>
	);
}
