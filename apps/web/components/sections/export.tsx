import { Download } from "lucide-react";
import { ExportPreview } from "@/components/previews/export-preview";
import FeatureCopy from "@/components/ui/feature-copy";

export default function ExportSection() {
	return (
		<section id="export" className="page-container section-space export-section">
			<div className="feature-row">
				<FeatureCopy
					icon={<Download size={18} />}
					label="04 / Export"
					title="Made in Quiro. Ready for anywhere."
					points={[
						"MP4 and MOV for your finished videos",
						"GIF for the moments worth looping",
						"Portable files you can share your way",
					]}
				>
					Drop a demo into a conversation. Add a walkthrough to your docs. Take
					the finished file wherever the work happens.
				</FeatureCopy>
				<ExportPreview />
			</div>
		</section>
	);
}
