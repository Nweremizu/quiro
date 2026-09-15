import type { ReactNode } from "react";
import { type ChangeEntry, formatReleaseDate } from "@/lib/release-data";

function inline(text: string): ReactNode[] {
	return text
		.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
		.map((part, index) => {
			const key = `${index}-${part}`;
			if (part.startsWith("`") && part.endsWith("`"))
				return <code key={key}>{part.slice(1, -1)}</code>;
			if (part.startsWith("**") && part.endsWith("**"))
				return <strong key={key}>{part.slice(2, -2)}</strong>;
			const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
			return link ? (
				<a key={key} href={link[2]} rel="noreferrer">
					{link[1]}
				</a>
			) : (
				part
			);
		});
}

export default function ReleaseNotes({ entry }: { entry: ChangeEntry }) {
	return (
		<div className="release-notes">
			{entry.date && (
				<p>
					<time dateTime={entry.date}>{formatReleaseDate(entry.date)}</time>
				</p>
			)}
			{entry.groups
				.filter((group) => group.items.length > 0)
				.map((group) => (
					<section key={group.kind}>
						<h3>{group.kind}</h3>
						<ul>
							{group.items.map((item) => (
								<li key={item}>{inline(item)}</li>
							))}
						</ul>
					</section>
				))}
		</div>
	);
}
