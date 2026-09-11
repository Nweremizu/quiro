import type { ComponentProps, ReactNode } from "react";
import { DownloadActions } from "./download-actions";
import { Icon } from "./icons";

type IconName = ComponentProps<typeof Icon>["name"];

export function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<div className="eyebrow">
			<span />
			{children}
		</div>
	);
}

type SectionHeaderProps = {
	eyebrow?: string;
	title: string;
	copy?: string;
	centered?: boolean;
};

export function SectionHeader({
	eyebrow,
	title,
	copy,
	centered = false,
}: SectionHeaderProps) {
	return (
		<div className={`section-header${centered ? " centered" : ""}`}>
			{eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
			<h2>{title}</h2>
			{copy ? <p>{copy}</p> : null}
		</div>
	);
}

type FeatureCardProps = {
	icon: IconName;
	title: string;
	copy: string;
	className?: string;
	children?: ReactNode;
};

export function FeatureCard({
	icon,
	title,
	copy,
	className = "",
	children,
}: FeatureCardProps) {
	return (
		<article className={`feature-card ${className}`}>
			<div className="feature-icon">
				<Icon name={icon} />
			</div>
			<div className="feature-card-copy">
				<h3>{title}</h3>
				<p>{copy}</p>
			</div>
			{children}
		</article>
	);
}

export function CtaBand() {
	return (
		<section className="cta-section section-shell">
			<div className="cta-band">
				<div>
					<Eyebrow>Ready when you are</Eyebrow>
					<h2>Make your next explanation unmistakably clear.</h2>
				</div>
				<DownloadActions compact />
			</div>
		</section>
	);
}

export function PageIntro({
	eyebrow,
	title,
	copy,
	children,
}: {
	eyebrow: string;
	title: string;
	copy: string;
	children?: ReactNode;
}) {
	return (
		<section className="page-intro section-shell">
			<Eyebrow>{eyebrow}</Eyebrow>
			<h1>{title}</h1>
			<p>{copy}</p>
			{children}
		</section>
	);
}
