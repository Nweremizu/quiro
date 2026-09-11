import type { Metadata } from "next";
import {
	CtaBand,
	FeatureCard,
	PageIntro,
	SectionHeader,
} from "@/components/content";

export const metadata: Metadata = {
	title: "Features",
	description:
		"Explore Quiro's native capture, editing, annotation, and export tools.",
};

const captureFeatures = [
	{
		icon: "camera" as const,
		title: "Flexible capture",
		copy: "Record a display, window, or selected region with a workflow built for the desktop.",
	},
	{
		icon: "mic" as const,
		title: "Complete audio",
		copy: "Bring together microphone and system audio so the explanation arrives intact.",
	},
	{
		icon: "layers" as const,
		title: "Camera presence",
		copy: "Add and position your camera when a human face makes the message more direct.",
	},
];

const editFeatures = [
	{
		icon: "timeline" as const,
		title: "Focused timeline",
		copy: "Trim recordings and shape pacing without the weight of a traditional video editor.",
	},
	{
		icon: "cursor" as const,
		title: "Zoom and cursor direction",
		copy: "Create deliberate emphasis around the interactions that matter most.",
	},
	{
		icon: "caption" as const,
		title: "Captions and annotations",
		copy: "Place readable context on the canvas with text, captions, arrows, and shapes.",
	},
	{
		icon: "sparkle" as const,
		title: "Designed canvas",
		copy: "Use crop, padding, backgrounds, corner radius, and shadow to turn utility into presentation.",
	},
	{
		icon: "export" as const,
		title: "Useful exports",
		copy: "Render to MP4, MOV, or GIF for demos, updates, documentation, and social posts.",
	},
	{
		icon: "lock" as const,
		title: "Local ownership",
		copy: "Keep the core workflow and its media files on your machine, under your control.",
	},
];

export default function FeaturesPage() {
	return (
		<>
			<PageIntro
				eyebrow="The studio"
				title="Everything your explanation needs. Nothing it doesn't."
				copy="Quiro is a native visual communication studio: fast enough for a quick update, deliberate enough for a polished product story."
			/>
			<section className="section-shell feature-page-section">
				<SectionHeader
					eyebrow="Capture"
					title="Start with the right raw material."
					copy="The recording workflow keeps the choices clear while preserving the inputs you need for a strong edit."
				/>
				<div className="feature-grid three-column">
					{captureFeatures.map((feature) => (
						<FeatureCard key={feature.title} {...feature} />
					))}
				</div>
			</section>
			<section className="feature-page-section feature-page-dark">
				<div className="section-shell">
					<SectionHeader
						eyebrow="Edit and finish"
						title="Turn motion into meaning."
						copy="Every editing tool is there to improve comprehension, pacing, or presentation—not to crowd the interface."
					/>
					<div className="feature-grid">
						{editFeatures.map((feature) => (
							<FeatureCard key={feature.title} {...feature} />
						))}
					</div>
				</div>
			</section>
			<CtaBand />
		</>
	);
}
