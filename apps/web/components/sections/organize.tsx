import { FolderOpen, HardDrive, Layers } from "lucide-react";
import { LibraryPreview } from "@/components/previews/library-preview";
import SectionHeading from "@/components/ui/section-heading";

export default function OrganizeSection() {
	return (
		<section id="organize" className="page-container section-space">
			<SectionHeading
				label="03 / Organize"
				title="A home for everything you capture."
			>
				Keep your work together, ready for the next edit, the next export, or
				the next good idea.
			</SectionHeading>
			<LibraryPreview />
			<div className="library-notes">
				<span>
					<Layers size={18} /> Screenshots and recordings together
				</span>
				<span>
					<FolderOpen size={18} /> Pick up where you left off
				</span>
				<span>
					<HardDrive size={18} /> Saved on your computer
				</span>
			</div>
		</section>
	);
}
