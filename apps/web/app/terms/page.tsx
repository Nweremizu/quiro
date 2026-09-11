import type { Metadata } from "next";
import { PageIntro } from "@/components/content";

export const metadata: Metadata = {
	title: "Terms",
	description: "Terms for using the Quiro website and desktop application.",
};

export default function TermsPage() {
	return (
		<>
			<PageIntro
				eyebrow="Terms"
				title="Use Quiro thoughtfully."
				copy="These terms set the baseline for using the public website, downloads, and desktop software."
			/>
			<article className="legal-content section-shell">
				<section>
					<h2>Using Quiro</h2>
					<p>
						You may use Quiro to create and export content you own or are
						authorized to record. You are responsible for following applicable
						privacy, intellectual property, workplace, and recording-consent
						laws.
					</p>
				</section>
				<section>
					<h2>Software and updates</h2>
					<p>
						Quiro may change as features are added, refined, or removed. Update
						services are provided to improve reliability and security, but
						uninterrupted availability is not guaranteed.
					</p>
				</section>
				<section>
					<h2>Your content</h2>
					<p>
						You retain responsibility for and rights to your recordings,
						projects, and exports. Keep backups of work that matters; local
						files can be lost through device failure, deletion, or storage
						changes outside Quiro's control.
					</p>
				</section>
				<section>
					<h2>Acceptable use</h2>
					<p>
						Do not use Quiro to violate the rights of others, distribute
						malicious content, or interfere with the website, release
						infrastructure, or software security.
					</p>
				</section>
				<section>
					<h2>No warranty</h2>
					<p>
						Quiro is provided as available. To the extent permitted by law, no
						warranties are made about uninterrupted operation, fitness for a
						particular purpose, or preservation of local files.
					</p>
				</section>
				<p className="legal-updated">Last updated: September 10, 2026</p>
			</article>
		</>
	);
}
