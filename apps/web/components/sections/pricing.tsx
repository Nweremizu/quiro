import { ArrowRight } from "lucide-react";

export default function PricingSection() {
	return (
		<section id="pricing" className="page-container pricing-section">
			<div>
				<span className="eyebrow">Pricing</span>
				<h2>Good things are taking shape.</h2>
				<p>
					We’re working on the details. Plans and pricing will be published here
					when they’re ready.
				</p>
			</div>
			<div className="pricing-note">
				<span className="status-dot" />
				<h3>Details coming soon</h3>
				<p>In the meantime, take a closer look at what Quiro can do.</p>
				<a className="text-link" href="#download">
					Explore Quiro <ArrowRight size={16} />
				</a>
			</div>
		</section>
	);
}
