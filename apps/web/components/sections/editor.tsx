import { MessageSquare, MousePointer2, Palette, Scissors } from "lucide-react";
import Image from "next/image";
import { EditorPreview } from "@/components/previews/editor-preview";
import SectionHeading from "@/components/ui/section-heading";

const benefits = [
	{
		icon: Palette,
		title: "Set the scene",
		text: "Backgrounds, padding, rounded corners, and shadows that frame your work beautifully.",
	},
	{
		icon: MousePointer2,
		title: "Guide the eye",
		text: "Zooms and cursor emphasis bring the details that matter into focus.",
	},
	{
		icon: MessageSquare,
		title: "Give it context",
		text: "Add text, captions, and annotations so the idea comes through clearly.",
	},
];

export default function EditorSection() {
	return (
		<section id="edit" className="editor-section section-space">
			<div className="page-container">
				<SectionHeading
					label="02 / Edit"
					title="From a rough take to a good-looking finish."
				>
					Give your capture the care it deserves. A few small touches can make
					the whole story clearer.
				</SectionHeading>
				<EditorPreview />
				<div className="editor-benefits">
					{benefits.map(({ icon: Icon, title, text }) => (
						<div key={title}>
							<Icon size={23} />
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					))}
				</div>
				<div className="timeline-feature">
					<div>
						<span className="feature-label">
							<Scissors size={17} /> Make every second count
						</span>
						<h3>
							A little less waiting.
							<br />A little more story.
						</h3>
						<p>
							Trim the pauses, refine your zooms, and bring your recording
							together on one timeline.
						</p>
					</div>
					<div className="timeline-image">
						<Image
							src="/images/timeline.png"
							alt="Quiro timeline with video, zoom, and camera tracks"
							width={1358}
							height={238}
							sizes="(max-width: 760px) 90vw, 650px"
						/>
					</div>
				</div>
			</div>
		</section>
	);
}
