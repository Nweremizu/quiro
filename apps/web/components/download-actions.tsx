"use client";

import { useEffect, useState } from "react";
import { downloads } from "@/lib/site";
import { Icon } from "./icons";

type Platform = "macos" | "windows" | "linux";

const options = {
	windows: {
		href: downloads.windows,
		label: "Download for Windows",
		detail: "Windows 10 or later · x64",
	},
	macos: {
		href: downloads.macos,
		label: "Download for macOS",
		detail: "macOS 12 or later · Apple silicon",
	},
	linux: {
		href: downloads.linux,
		label: "Download for Linux",
		detail: "AppImage · x64 · most distros",
	},
} as const;

const platformOrder: Platform[] = ["windows", "macos", "linux"];

export function DownloadActions({ compact = false }: { compact?: boolean }) {
	const [preferred, setPreferred] = useState<Platform>("windows");

	useEffect(() => {
		const ua = navigator.userAgent;
		if (/Mac|iPhone|iPad/.test(ua)) {
			setPreferred("macos");
		} else if (/Linux/.test(ua) && !/Android/.test(ua)) {
			setPreferred("linux");
		}
	}, []);

	const alternates = platformOrder.filter((platform) => platform !== preferred);

	if (compact) {
		return (
			<div className="hero-actions">
				<a className="button button-primary" href={options[preferred].href}>
					<Icon name="download" />
					{options[preferred].label}
				</a>
				<a className="text-link" href="/features/">
					Explore features <Icon name="arrow" />
				</a>
			</div>
		);
	}

	return (
		<div className="download-options">
			<DownloadOption platform={preferred} featured />
			{alternates.map((platform) => (
				<DownloadOption key={platform} platform={platform} />
			))}
		</div>
	);
}

function DownloadOption({
	platform,
	featured = false,
}: {
	platform: Platform;
	featured?: boolean;
}) {
	const option = options[platform];

	return (
		<a
			className={`download-option${featured ? " featured" : ""}`}
			href={option.href}
		>
			<div className={`platform-mark ${platform}`} aria-hidden="true">
				{platform === "windows" && <WindowsMark />}
				{platform === "macos" && <AppleMark />}
				{platform === "linux" && <LinuxMark />}
			</div>
			<div>
				<strong>{option.label}</strong>
				<span>{option.detail}</span>
			</div>
			<Icon name="download" />
		</a>
	);
}

function WindowsMark() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M2 4.4 10.7 3v8.3H2V4.4Zm9.8-1.6L22 1.3v10h-10.2V2.8ZM2 12.5h8.7V21L2 19.6v-7.1Zm9.8 0H22v10.2l-10.2-1.5v-8.7Z" />
		</svg>
	);
}

function AppleMark() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M17.1 12.6c0-2.5 2-3.7 2.1-3.8a4.5 4.5 0 0 0-3.5-1.9c-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.8a4.7 4.7 0 0 0-4 2.4c-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8 1.5 0 2 .8 3.3.8 1.4 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.9c-.1 0-3.1-1.2-3.1-3.7ZM14.7 5.4a4.2 4.2 0 0 0 1-3 4.3 4.3 0 0 0-2.8 1.5 4 4 0 0 0-1 2.9c1 .1 2.1-.5 2.8-1.4Z" />
		</svg>
	);
}

function LinuxMark() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 2c-2.2 0-4 1.9-4 4.3 0 1.1.3 2.1.9 2.9-2.1 1-3.4 3.1-3.4 6v4.2C5.5 20.8 6.7 22 8.1 22h.4c.4 1.2 1.6 2 3 2h1c1.4 0 2.6-.8 3-2h.4c1.4 0 2.6-1.2 2.6-2.6v-4.2c0-2.9-1.3-5-3.4-6 .6-.8.9-1.8.9-2.9 0-2.4-1.8-4.3-4-4.3Zm-2.1 9.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4.2 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
		</svg>
	);
}
