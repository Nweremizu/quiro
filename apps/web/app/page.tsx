import Link from "next/link";
import {
	CtaBand,
	Eyebrow,
	FeatureCard,
	SectionHeader,
} from "@/components/content";
import { DownloadActions } from "@/components/download-actions";
import { Icon } from "@/components/icons";
import { ProductStage } from "@/components/product-stage";

const capabilities = [
	{
		icon: "camera" as const,
		title: "Capture the whole story",
		copy: "Record your screen, camera, microphone, and system audio together in one native workflow.",
	},
	{
		icon: "timeline" as const,
		title: "Shape the pacing",
		copy: "Trim the noise, arrange the moment, and make every second earn its place on a focused timeline.",
	},
	{
		icon: "cursor" as const,
		title: "Guide every eye",
		copy: "Use zooms, cursor emphasis, and framing to direct attention without distracting from the idea.",
	},
	{
		icon: "caption" as const,
		title: "Add context in the frame",
		copy: "Layer captions, text, and annotations directly onto the canvas so meaning never gets lost.",
	},
	{
		icon: "layers" as const,
		title: "Design, not decoration",
		copy: "Create a considered composition with backgrounds, crop, spacing, shadows, and camera placement.",
	},
	{
		icon: "export" as const,
		title: "Finish in the right format",
		copy: "Export polished work as MP4, MOV, or GIF and publish it wherever your audience already is.",
	},
];

export default function HomePage() {
	return (
		<>
			<section className="hero section-shell">
				<div className="hero-copy reveal-one">
					<Eyebrow>Native screen studio for Windows and macOS</Eyebrow>
					<h1>
						Your idea,
						<br />
						<span>made visible.</span>
					</h1>
					<p>
						Quiro turns raw screen captures into thoughtful, polished
						stories—without moving your creative workflow into a browser.
					</p>
					<DownloadActions compact />
					<div className="hero-proof">
						<span>No account required</span>
						<span>Local editing</span>
						<span>Native performance</span>
					</div>
				</div>
				<div className="reveal-two">
					<ProductStage />
				</div>
			</section>

			<section className="statement-section section-shell">
				<p className="statement-label">
					Built for the moment between knowing and explaining.
				</p>
				<p className="statement-copy">
					A screen recording should feel like a finished piece of
					communication—not a raw artifact you apologize for sending.
				</p>
			</section>

			<section className="capabilities-section section-shell">
				<SectionHeader
					eyebrow="One coherent workflow"
					title="Record, compose, and deliver."
					copy="Quiro brings capture and visual editing into the same focused studio, so the final result feels intentional from the first frame to the last."
				/>
				<div className="feature-grid">
					{capabilities.map((capability) => (
						<FeatureCard key={capability.title} {...capability} />
					))}
				</div>
			</section>

			<section className="workflow-section">
				<div className="section-shell workflow-inner">
					<SectionHeader
						eyebrow="A quieter kind of tool"
						title="The interface gets out of the way."
						copy="A calm canvas, a precise timeline, and controls that appear where the work needs them. Nothing competes with the story you are shaping."
					/>
					<div className="workflow-steps">
						<WorkflowStep
							number="01"
							title="Capture"
							copy="Choose a display, window, or region. Bring your camera and audio when they add meaning."
						/>
						<WorkflowStep
							number="02"
							title="Compose"
							copy="Refine timing, frame the content, and direct attention with motion and annotation."
						/>
						<WorkflowStep
							number="03"
							title="Deliver"
							copy="Export a clean, portable file that stays yours and works anywhere."
						/>
					</div>
				</div>
			</section>

			<section className="ownership-section section-shell">
				<div className="ownership-card">
					<div className="ownership-visual">
						<div className="privacy-orbit orbit-one" />
						<div className="privacy-orbit orbit-two" />
						<div className="privacy-core">
							<Icon name="lock" />
						</div>
					</div>
					<div className="ownership-copy">
						<Eyebrow>Local by default</Eyebrow>
						<h2>Your work stays close.</h2>
						<p>
							Capture, edit, and export on your computer. Quiro is designed
							around files you control rather than an account you have to
							maintain.
						</p>
						<Link className="text-link" href="/privacy/">
							Read our privacy approach <Icon name="arrow" />
						</Link>
					</div>
				</div>
			</section>

			<CtaBand />
		</>
	);
}

function WorkflowStep({
	number,
	title,
	copy,
}: {
	number: string;
	title: string;
	copy: string;
}) {
	return (
		<article className="workflow-step">
			<span>{number}</span>
			<h3>{title}</h3>
			<p>{copy}</p>
		</article>
	);
}
