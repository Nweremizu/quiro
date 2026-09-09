import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { commands } from "@/utils/tauri";
import IconPencil from "~icons/ph/pencil-simple-fill";
import IconClose from "~icons/ph/x-bold";

export function CaptureDetails({
	item,
	folder,
	onClose,
	onSaved,
}: {
	item: { path: string; name: string; kind: string; sortTimeMillis: number };
	folder: string;
	onClose: () => void;
	onSaved: () => Promise<void>;
}) {
	const [name, setName] = useState(item.name);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	const save = async () => {
		if (saving || !name.trim() || name.trim() === item.name) return;
		setSaving(true);
		setError("");
		try {
			const result = await commands.renameLibraryCapture(
				item.path,
				name.trim(),
			);
			if (result.status === "error") throw new Error(result.error);
			await onSaved();
			setSaved(true);
		} catch (error) {
			setError(String(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<aside className="capture-details" aria-label="Capture details">
			<div className="capture-details-heading">
				<span>
					<IconPencil /> Capture details
				</span>
				<button type="button" aria-label="Close details" onClick={onClose}>
					<IconClose />
				</button>
			</div>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<label htmlFor="capture-name">Name</label>
				<input
					id="capture-name"
					maxLength={80}
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						setSaved(false);
					}}
					disabled={saving}
				/>
				<button
					type="submit"
					disabled={saving || !name.trim() || name.trim() === item.name}
				>
					{saving ? "Saving…" : "Save name"}
				</button>
				{saved && <p role="status">Name saved</p>}
				{error && <p role="alert">{error}</p>}
			</form>
			<dl>
				<dt>Type</dt>
				<dd>{item.kind === "recording" ? "Screen recording" : "Screenshot"}</dd>
				<dt>Folder</dt>
				<dd>{folder}</dd>
				<dt>Captured</dt>
				<dd>
					{item.sortTimeMillis > 0
						? new Date(item.sortTimeMillis).toLocaleString()
						: "Unknown"}
				</dd>
				<dt>File location</dt>
				<dd className="capture-location">{item.path}</dd>
			</dl>
			<button
				type="button"
				className="capture-reveal"
				onClick={() =>
					void revealItemInDir(item.path).catch((error) =>
						setError(String(error)),
					)
				}
			>
				Show in folder ↗
			</button>
		</aside>
	);
}
