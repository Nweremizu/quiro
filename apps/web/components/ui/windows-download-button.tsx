"use client";

import { EmbossButton } from "@quiro/ui/EmbossButton";
import { track } from "@vercel/analytics";
import MicrosoftIcon from "@/components/icons/microsoft";
import { downloads } from "@/lib/site";

export default function WindowsDownloadButton() {
	return (
		<EmbossButton
			href={downloads.windows}
			variant="accent"
			size="lg"
			className="download-button"
			onClick={() => track("download_clicked", { platform: "Windows" })}
		>
			<MicrosoftIcon className="size-4" />
			Download for Windows
		</EmbossButton>
	);
}
