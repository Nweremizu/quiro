import { Clapperboard, Scan, Sparkles } from "lucide-react";
import SectionHeading from "@/components/ui/section-heading";

const useCases = [
	{
		icon: Sparkles,
		title: "Give your product its moment",
		text: "Turn a feature walkthrough into a demo that feels as considered as the product itself.",
		tag: "Product demos",
	},
	{
		icon: Scan,
		title: "Put the problem in the picture",
		text: "Capture the exact steps, point out the detail, and help someone get straight to the fix.",
		tag: "Bug reports & feedback",
	},
	{
		icon: Clapperboard,
		title: "Make the next step obvious",
		text: "Show someone how it’s done with a tutorial they can pause, replay, and follow at their pace.",
		tag: "Tutorials & walkthroughs",
	},
];

export default function UseCasesSection() {
	return (
		<section className="page-container section-space" id="use-cases">
			<SectionHeading
				label="Built for the things you do"
				title="Less explaining. More showing."
			/>
			<div className="use-case-grid">
				{useCases.map(({ icon: Icon, title, text, tag }, index) => (
					<article key={title} className="use-case">
						<div
							className={`use-case-art use-case-art-${index}`}
							aria-hidden="true"
						>
							<Icon size={48} strokeWidth={1.3} />
							<span>0{index + 1}</span>
						</div>
						<span className="eyebrow">{tag}</span>
						<h3>{title}</h3>
						<p>{text}</p>
					</article>
				))}
			</div>
		</section>
	);
}
