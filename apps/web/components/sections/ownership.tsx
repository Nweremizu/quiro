import { Check, LockKeyhole } from "lucide-react";
import QuiroLogo from "@/components/icons/quiro";

export default function OwnershipSection() {
	return (
		<section className="ownership-section section-space">
			<div className="page-container ownership-layout">
				<div className="ownership-art" aria-hidden="true">
					<div className="ownership-ring">
						<div className="ownership-icon">
							<QuiroLogo className="size-20" />
							<LockKeyhole className="ownership-lock" size={30} />
						</div>
					</div>
					<span className="local-file file-one">walkthrough.mp4</span>
					<span className="local-file file-two">a-good-idea.png</span>
				</div>
				<div>
					<span className="eyebrow">Your work stays your work</span>
					<h2>
						On your computer.
						<br />
						On your terms.
					</h2>
					<p>
						Capture, edit, and export locally. Your creative process doesn’t
						need an account, an upload, or someone else’s storage.
					</p>
					<div className="ownership-points">
						<span>
							<Check size={17} /> No account needed
						</span>
						<span>
							<Check size={17} /> Files you control
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}
