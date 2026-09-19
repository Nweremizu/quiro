"use client";

import { EmbossButton } from "@quiro/ui/EmbossButton";
import { track } from "@vercel/analytics";
import AppleIcon from "@/components/icons/apple";
import LinuxIcon from "@/components/icons/linux";
import MicrosoftIcon from "@/components/icons/microsoft";
import { formatBytes, type Release } from "@/lib/release-data";
import { downloads } from "@/lib/site";

const platforms = [
	{
		name: "Windows",
		architecture: "Intel & AMD · 64-bit",
		format: ".exe installer",
		href: downloads.windows,
		icon: MicrosoftIcon,
		iconClassName: "size-8",
		variant: "accent",
		iconLabel: undefined,
	},
	{
		name: "macOS",
		architecture: "Apple silicon",
		format: ".dmg disk image",
		href: downloads.macos,
		icon: AppleIcon,
		iconClassName: "size-8",
		variant: "white",
		iconLabel: undefined,
	},
	{
		name: "Linux",
		architecture: "Intel & AMD · 64-bit",
		format: ".AppImage",
		href: downloads.linux,
		icon: LinuxIcon,
		// ponytail: the Linux mark is stroke-only, so the shared fill has to go.
		iconClassName: "size-8 fill-transparent!",
		variant: "white",
		iconLabel: "Linux",
	},
] as const;

export default function PlatformGrid({
	release,
	fallback = false,
}: {
	release?: Release | null;
	fallback?: boolean;
}) {
	return (
		<div className="platform-grid">
			{platforms.map((platform) => {
				const Icon = platform.icon;
				const installer = release?.installers.find(
					(item) => item.platform === platform.name,
				);
				const href = installer?.url ?? (fallback ? platform.href : null);
				return (
					<section
						className="platform-card"
						key={platform.name}
						aria-labelledby={`platform-${platform.name}`}
					>
						<div className="platform-icon">
							<Icon
								className={platform.iconClassName}
								aria-label={platform.iconLabel}
							/>
						</div>

						<h2 id={`platform-${platform.name}`}>{platform.name}</h2>
						<p>{platform.architecture}</p>
						{href ? (
							<EmbossButton
								href={href}
								variant={platform.variant}
								size="lg"
								className="download-button"
								onClick={() =>
									track("download_clicked", {
										platform: platform.name,
										version: release?.version ?? "latest",
									})
								}
							>
								Download for {platform.name}
							</EmbossButton>
						) : (
							<p className="installer-unavailable">
								Not available for this version
							</p>
						)}
						<span className="platform-format">
							{platform.format}
							{installer ? ` · ${formatBytes(installer.bytes)}` : ""}
						</span>
					</section>
				);
			})}
		</div>
	);
}
