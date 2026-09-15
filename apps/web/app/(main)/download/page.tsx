import { HardDrive, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import DownloadHelp from "@/components/download/download-help";
import ReleaseDownloads, {
	type DownloadSearch,
} from "@/components/download/release-downloads";
import QuiroLogo from "@/components/icons/quiro";
import SiteFooter from "@/components/layout/site-footer";

export const metadata: Metadata = {
	title: "Download",
	description:
		"Download Quiro for Windows, macOS, or Linux. Capture, edit, and export on your computer.",
	alternates: { canonical: "/download" },
};

export default function DownloadPage({
	searchParams,
}: {
	searchParams: DownloadSearch;
}) {
	return (
		<div className="download-page">
			<div className="download-page-heading">
				<QuiroLogo className="download-logo" />
				<span className="eyebrow">A little space for your next big idea</span>
				<h1>
					Make yourself
					<br />
					at home in Quiro.
				</h1>
				<p>
					Your screen, your story, your files. Choose your platform and start
					capturing.
				</p>
			</div>
			<div className="page-container ">
				<Suspense
					fallback={
						<p className="release-notice" role="status">
							Loading versions and downloads…
						</p>
					}
				>
					<ReleaseDownloads searchParams={searchParams} />
				</Suspense>
			</div>
			<div className="download-assurances">
				<span>
					<HardDrive size={16} /> Capture and edit locally
				</span>
				<span>
					<LockKeyhole size={16} /> No account needed
				</span>
			</div>
			<div className="page-container pb-10">
				<DownloadHelp />
			</div>
			<div className="border-t border-gray-6" />
			<SiteFooter />
		</div>
	);
}
