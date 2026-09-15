"use client";

import { FileVideo, FolderOpen, ImageIcon, Search } from "lucide-react";
import { useState } from "react";

const captures = [
	{
		name: "A first look",
		type: "Recording",
		color: "apricot",
		detail: "Product walkthrough",
		icon: FileVideo,
	},
	{
		name: "The little details",
		type: "Screenshot",
		color: "lilac",
		detail: "Design feedback",
		icon: ImageIcon,
	},
	{
		name: "How it all works",
		type: "Recording",
		color: "ocean",
		detail: "A quick tutorial",
		icon: FileVideo,
	},
];

export function LibraryPreview() {
	const [filter, setFilter] = useState("All captures");
	const [search, setSearch] = useState("");
	const visible = captures.filter(
		(item) =>
			(filter === "All captures" || `${item.type}s` === filter) &&
			`${item.name} ${item.detail}`
				.toLowerCase()
				.includes(search.toLowerCase()),
	);
	return (
		<div className="library-preview">
			<div className="library-toolbar">
				<span>
					<FolderOpen size={19} /> Your library
				</span>
				<span className="preview-caption">Example captures</span>
			</div>
			<div className="library-filters">
				<fieldset
					className="filter-buttons"
					aria-label="Filter example captures"
				>
					{["All captures", "Screenshots", "Recordings"].map((item) => (
						<button
							key={item}
							type="button"
							aria-pressed={filter === item}
							onClick={() => setFilter(item)}
						>
							{item}
						</button>
					))}
				</fieldset>
				<label className="library-search">
					<Search size={15} />
					<input
						aria-label="Search example captures"
						placeholder="Find a capture…"
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</label>
			</div>
			<div className="library-grid" aria-live="polite">
				{visible.map(({ name, type, color, detail, icon: Icon }) => (
					<div className="library-card" key={name}>
						<div className={`library-thumbnail ${color}`}>
							<div className="mini-window">
								<div className="window-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="mini-content">
									<span />
									<span />
									<div />
								</div>
							</div>
							<span className="media-type">
								<Icon size={13} />
								{type}
							</span>
						</div>
						<h3>{name}</h3>
						<p>{detail}</p>
					</div>
				))}
				{visible.length === 0 && (
					<div className="library-empty">
						<Search size={24} />
						<h3>No captures found</h3>
						<p>Try “tutorial” or choose a different filter.</p>
						<button
							type="button"
							onClick={() => {
								setSearch("");
								setFilter("All captures");
							}}
						>
							Show all captures
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
