import { Camera, MousePointer2, Scan, Video } from "lucide-react";
import { RecordingControls } from "@/components/previews/recording-controls";
import FeatureCopy from "@/components/ui/feature-copy";
import SectionHeading from "@/components/ui/section-heading";

export default function CaptureSection() {
	return (
		<section id="capture" className="page-container section-space">
			<SectionHeading
				label="01 / Capture"
				title="Whatever’s on your screen. Make it yours."
			/>
			<div id="screenshots" className="feature-row">
				<FeatureCopy
					icon={<Camera size={18} />}
					label="Screenshots"
					title="The whole picture. Or just the important bit."
					points={[
						"Full screen, window, or selected area",
						"Open in the editor and make your point",
						"Save an image or copy to your clipboard",
					]}
				>
					A tiny detail, a fresh design, a bug that needs a second pair of eyes.
					Capture exactly what you need.
				</FeatureCopy>
				<div
					className="capture-stage"
					role="img"
					aria-label="Illustration of an area screenshot"
				>
					<div className="capture-window">
						<div className="window-dots">
							<i />
							<i />
							<i />
							<span>Your next great idea</span>
						</div>
						<div className="capture-selection">
							<div className="capture-line" />
							<div className="capture-line short" />
							<div className="capture-blocks">
								<span />
								<span />
								<span />
							</div>
							<Scan className="capture-corner" size={24} />
							<MousePointer2 className="capture-pointer" size={30} />
						</div>
					</div>
					<span className="stage-caption">
						<Camera size={15} /> Just the part you need.
					</span>
				</div>
			</div>
			<div id="screen-recordings" className="feature-row reverse">
				<FeatureCopy
					icon={<Video size={18} />}
					label="Screen recordings"
					title="Show it once. Make it click."
					points={[
						"Screen, camera, and audio together",
						"Pause, restart, or pick up where you left off",
						"Straight from recording into your editor",
					]}
				>
					Walk through the idea in your own words. Keep the controls close and
					your attention on what you’re showing.
				</FeatureCopy>
				<div className="recording-stage">
					<div className="recording-orbit" aria-hidden="true">
						<Video size={44} strokeWidth={1.4} />
					</div>
					<RecordingControls className="recording-demo" />
					<p className="stage-caption">Go ahead. Try the controls.</p>
				</div>
			</div>
		</section>
	);
}
