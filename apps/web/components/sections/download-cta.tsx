import { ArrowRight } from "lucide-react";
import QuiroLogo from "@/components/icons/quiro";
import WindowsDownloadButton from "@/components/ui/windows-download-button";

export default function DownloadCtaSection() {
	return (
		<section id="download" className="download-section">
			<div className="page-container">
				<QuiroLogo className="download-logo" />
				<span className="eyebrow">Your next great capture starts here</span>
				<h2>
					Make something
					<br />
					worth showing.
				</h2>
				<p>
					A screenshot, a quick explanation, a whole story.
					<br />
					Bring it together in Quiro.
				</p>
				<WindowsDownloadButton />
				<a href="/download" className="text-link release-link">
					Other platforms & release notes <ArrowRight size={14} />
				</a>
			</div>
		</section>
	);
}
