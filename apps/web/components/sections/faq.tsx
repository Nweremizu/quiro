import { ArrowRight, Plus } from "lucide-react";
import { site } from "@/lib/site";

const questions = [
	{
		question: "What can I capture with Quiro?",
		answer:
			"Take a screenshot or record a display, a window, or a selected area. For recordings, you can include your camera, microphone, and system audio to give your walkthrough more context.",
	},
	{
		question: "Can I edit my captures before exporting?",
		answer:
			"Yes. Quiro includes editors for screenshots and recordings. Refine the framing with backgrounds, padding, and shadows, add annotations to screenshots, or polish recordings with trims, zooms, text, and captions.",
	},
	{
		question: "Do I need an account or an internet connection?",
		answer:
			"You don’t need an account for the desktop capture, editing, and export workflow. Your projects live on your computer. Downloads, updates, and some optional resources need an internet connection.",
	},
	{
		question: "Does Quiro upload my recordings automatically?",
		answer:
			"The core workflow is local: capture on your computer, edit there, and export a file. You decide where to send the finished result and which service to use to share it.",
	},
	{
		question: "What formats can I export?",
		answer:
			"Export recordings as MP4, MOV, or GIF. For screenshots, save an image or copy the result to your clipboard. Your audience can open exported files without installing Quiro.",
	},
	{
		question: "How much will Quiro cost?",
		answer:
			"Pricing details are coming soon. We’ll publish the plans and what’s included here when they’re ready.",
	},
];

export default function FaqSection() {
	return (
		<section id="faq" className="page-container section-space faq-section">
			<div>
				<span className="eyebrow">A few useful answers</span>
				<h2>
					Before you
					<br />
					hit record.
				</h2>
				<p>Still curious about something?</p>
				<a className="text-link" href={`${site.repository}/issues`}>
					Ask a question <ArrowRight size={16} />
				</a>
			</div>
			<div className="faq-list">
				{questions.map(({ question, answer }) => (
					<details key={question} name="faq">
						<summary>
							{question}
							<Plus size={19} aria-hidden="true" />
						</summary>
						<p>{answer}</p>
					</details>
				))}
			</div>
		</section>
	);
}
