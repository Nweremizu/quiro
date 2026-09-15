import { ArrowDown } from "lucide-react";
import HeroImage from "@/components/hero-image";
import WindowsDownloadButton from "@/components/ui/windows-download-button";

export default function HeroSection() {
	return (
		<section className="hero-section" aria-labelledby="hero-title">
			<div className="page-container hero-content">
				<h1 id="hero-title">
					Capture, edit, export and organize in one place.
				</h1>
				<p>
					A home for your screenshots, screen recordings, and everything you
					make from them.
				</p>
				<WindowsDownloadButton />
				<a href="#features" className="text-link hero-explore">
					Explore what’s inside <ArrowDown size={14} />
				</a>
				<HeroImage />
			</div>
		</section>
	);
}
