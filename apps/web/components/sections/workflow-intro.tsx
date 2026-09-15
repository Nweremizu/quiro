import {
	ArrowRight,
	Camera,
	Download,
	FolderOpen,
	Scissors,
} from "lucide-react";
import SectionHeading from "@/components/ui/section-heading";

const workflow = [
	{ label: "Capture", href: "#capture", icon: Camera },
	{ label: "Edit", href: "#edit", icon: Scissors },
	{ label: "Organize", href: "#organize", icon: FolderOpen },
	{ label: "Export", href: "#export", icon: Download },
];

export default function WorkflowIntroSection() {
	return (
		<section id="features" className="intro-section">
			<div className="page-container">
				<SectionHeading
					label="A little capture. A lot of possibility."
					title="Your screen is just the starting point."
				>
					Turn a quick capture into a clear explanation, a thoughtful
					walkthrough, or something worth showing off.
				</SectionHeading>
				<nav aria-label="Explore features" className="workflow-nav">
					{workflow.map(({ label, href, icon: Icon }, index) => (
						<a href={href} key={label}>
							<Icon size={20} />
							<span>{label}</span>
							{index < workflow.length - 1 && (
								<ArrowRight className="workflow-arrow" size={16} />
							)}
						</a>
					))}
				</nav>
			</div>
		</section>
	);
}
