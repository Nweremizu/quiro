import { useEffect, useRef } from "react";

// React port of Cap's `useEditorShortcuts`: one combo table for the whole
// editor instead of a keydown listener per component, so bindings can't
// silently shadow each other.

export type ShortcutBinding = {
	/** "Mod+=", "Mod+-", "Space", "KeyS", "Delete" — Mod is Cmd or Ctrl. */
	combo: string;
	handler: (event: KeyboardEvent) => void | Promise<void>;
	preventDefault?: boolean;
	when?: () => boolean;
};

function normalizeCombo(event: KeyboardEvent) {
	const parts: string[] = [];
	if (event.metaKey || event.ctrlKey) parts.push("Mod");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");

	switch (event.code) {
		case "Equal":
			parts.push("=");
			break;
		case "Minus":
			parts.push("-");
			break;
		default:
			parts.push(event.code);
	}

	return parts.join("+");
}

/** True while focus is in a field, where shortcuts must not fire. */
function typingInField() {
	const element = document.activeElement as HTMLElement | null;
	if (!element) return false;

	return (
		element.tagName === "INPUT" ||
		element.tagName === "TEXTAREA" ||
		element.isContentEditable
	);
}

export function useEditorShortcuts(bindings: ShortcutBinding[]) {
	const bindingsRef = useRef(bindings);
	bindingsRef.current = bindings;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				event.repeat ||
				typingInField()
			)
				return;

			const combo = normalizeCombo(event);
			const binding = bindingsRef.current.find(
				(candidate) => candidate.combo === combo,
			);
			if (!binding || (binding.when && !binding.when())) return;

			if (binding.preventDefault !== false) event.preventDefault();
			void binding.handler(event);
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);
}
