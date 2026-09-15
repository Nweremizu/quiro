import { Check } from "lucide-react";
import type { ReactNode } from "react";

export default function FeatureCopy({
	icon,
	label,
	title,
	children,
	points,
}: {
	icon: ReactNode;
	label: string;
	title: string;
	children: ReactNode;
	points: string[];
}) {
	return (
		<div className="feature-copy">
			<span className="feature-label">
				{icon}
				{label}
			</span>
			<h3>{title}</h3>
			<p>{children}</p>
			<ul>
				{points.map((point) => (
					<li key={point}>
						<Check size={16} aria-hidden="true" />
						{point}
					</li>
				))}
			</ul>
		</div>
	);
}
