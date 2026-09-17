"use client";

import { ArrowUpRight, Check, Download, FileVideo } from "lucide-react";
import { useState } from "react";

const formats = [
	{
		name: "MP4",
		description:
			"A versatile video file for presentations, messages, and the web.",
	},
	{
		name: "MOV",
		description: "A video file ready to take into your next editing workflow.",
	},
	{
		name: "GIF",
		description:
			"A looping moment for a quick explanation, a document, or a reply.",
	},
];

export function ExportPreview() {
	const [format, setFormat] = useState(formats[0]);
	return (
		<div className="export-stage">
			<div className="export-card">
				<div className="export-card-title">
					<span>
						<Download size={17} /> The finishing touch
					</span>
					<span className="preview-caption">Preview</span>
				</div>
				<div className="export-file">
					<div>
						<FileVideo size={32} />
					</div>
					<strong>
						something-worth-showing<span>.{format.name.toLowerCase()}</span>
					</strong>
				</div>
				<fieldset
					className="export-formats"
					aria-label="Preview export formats"
				>
					{formats.map((item) => (
						<button
							type="button"
							aria-pressed={item.name === format.name}
							key={item.name}
							onClick={() => setFormat(item)}
						>
							{item.name}
							{item.name === format.name && <Check size={14} />}
						</button>
					))}
				</fieldset>
				<p className="export-description" aria-live="polite">
					{format.description}
				</p>
				<a className="export-cta" href="#download">
					Make your first capture <ArrowUpRight size={16} />
				</a>
			</div>
		</div>
	);
}
