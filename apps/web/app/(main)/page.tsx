import SiteFooter from "@/components/layout/site-footer";
import CaptureSection from "@/components/sections/capture";
import DownloadCtaSection from "@/components/sections/download-cta";
import EditorSection from "@/components/sections/editor";
import ExportSection from "@/components/sections/export";
import FaqSection from "@/components/sections/faq";
import HeroSection from "@/components/sections/hero";
import OrganizeSection from "@/components/sections/organize";
import OwnershipSection from "@/components/sections/ownership";
import PricingSection from "@/components/sections/pricing";
import UseCasesSection from "@/components/sections/use-cases";
import WorkflowIntroSection from "@/components/sections/workflow-intro";

export default function Page() {
	return (
		<div className="marketing-page">
			<HeroSection />
			<WorkflowIntroSection />
			<div className="light-surface">
				<CaptureSection />
				<EditorSection />
				<OrganizeSection />
				<ExportSection />
			</div>
			<OwnershipSection />
			<div className="light-surface bottom-surface">
				<UseCasesSection />
				<PricingSection />
				<FaqSection />
				<DownloadCtaSection />
				<SiteFooter />
			</div>
		</div>
	);
}
