export const site = {
	name: "Quiro",
	description: "Beautiful screen recordings, owned by you.",
	url: process.env.NEXT_PUBLIC_SITE_URL || "https://quiro.app",
	repository: "https://github.com/Nweremizu/quiro",
} as const;

const releaseBaseUrl =
	process.env.NEXT_PUBLIC_RELEASE_BASE_URL ||
	"https://pub-0bd568b6a8864cd5b8257f39f8b653ba.r2.dev";

export const downloads = {
	windows: `${releaseBaseUrl}/stable/downloads/quiro-windows-x64.exe`,
	macos: `${releaseBaseUrl}/stable/downloads/quiro-macos-arm64.dmg`,
	manifest: `${releaseBaseUrl}/stable/downloads.json`,
} as const;
