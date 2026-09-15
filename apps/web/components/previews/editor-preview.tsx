"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

const backgrounds = [
	{
		name: "Apricot",
		color: "linear-gradient(135deg, #ffd9b1, #f9a773 60%, #f4c4b1)",
	},
	{
		name: "Ocean",
		color: "linear-gradient(135deg, #bfe8f5, #87aeef 60%, #c4d5ff)",
	},
	{
		name: "Lilac",
		color: "linear-gradient(135deg, #eadcf8, #bbabed 60%, #e4c6e6)",
	},
];

export function EditorPreview() {
	const [background, setBackground] = useState(backgrounds[0]);
	const [padding, setPadding] = useState(24);
	return (
		<div className="editor-preview">
			<div className="editor-preview-toolbar">
				<span>
					<SlidersHorizontal size={16} /> A little polish goes a long way
				</span>
				<span className="preview-caption">Interactive preview</span>
			</div>
			<div
				className="editor-preview-canvas"
				style={{ background: background.color, padding: `${padding}px` }}
			>
				<Image
					src="/images/hero-img.png"
					alt="Quiro editor showing background controls, video preview, and a multitrack timeline"
					width={1919}
					height={1079}
					sizes="(max-width: 760px) 90vw, 1000px"
				/>
			</div>
			<div className="editor-preview-controls">
				<div className="background-controls">
					<span>Background</span>
					{backgrounds.map((item) => (
						<button
							type="button"
							key={item.name}
							aria-label={`${item.name} background`}
							aria-pressed={item.name === background.name}
							style={{ background: item.color }}
							onClick={() => setBackground(item)}
						>
							{item.name === background.name && <Check size={16} />}
						</button>
					))}
				</div>
				<label className="padding-control" htmlFor="preview-padding">
					Padding
					<input
						id="preview-padding"
						type="range"
						min="12"
						max="48"
						value={padding}
						onChange={(event) => setPadding(Number(event.target.value))}
					/>
					<output htmlFor="preview-padding">{padding}</output>
				</label>
			</div>
		</div>
	);
}
