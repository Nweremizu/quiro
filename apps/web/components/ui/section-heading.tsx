import type { ReactNode } from "react";

export default function SectionHeading({
	label,
	title,
	children,
}: {
	label: string;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="section-heading">
			<span className="eyebrow">{label}</span>
			<h2>{title}</h2>
			{children && <p>{children}</p>}
		</div>
	);
}
