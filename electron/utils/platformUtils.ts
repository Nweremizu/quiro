let cachedPlatform: string | null = null;

function getNavigatorFallbackPlatform(): string {
	if (typeof navigator === "undefined") {
		return "win32";
	}

	const navigatorWithUAData = navigator as Navigator & {
		userAgentData?: { platform?: string };
	};
	const platformSource = navigatorWithUAData.userAgentData?.platform ?? navigator.userAgent ?? "";

	if (/mac|iphone|ipad|ipod/i.test(platformSource)) {
		return "darwin";
	}

	if (/linux/i.test(platformSource)) {
		return "linux";
	}

	return "win32";
}

/**
 * Gets the current platform from Electron
 */
const getPlatform = async (): Promise<string> => {
	if (cachedPlatform) return cachedPlatform;

	try {
		const platform = await window.electronAPI.getPlatform();
		cachedPlatform = platform;
		return platform;
	} catch (error) {
		console.warn("Failed to get platform from Electron, falling back to navigator:", error);
		const fallbackPlatform = getNavigatorFallbackPlatform();
		cachedPlatform = fallbackPlatform;
		return fallbackPlatform;
	}
};

/**
 * Detects if the current platform is macOS
 */
export const isMac = async (): Promise<boolean> => {
	const platform = await getPlatform();
	return platform === "darwin";
};

/**
 * Gets the modifier key symbol based on the platform
 */
export const getModifierKey = async (): Promise<string> => {
	return (await isMac()) ? "⌘" : "Ctrl";
};

/**
 * Gets the shift key symbol based on the platform
 */
export const getShiftKey = async (): Promise<string> => {
	return (await isMac()) ? "⇧" : "Shift";
};

/**
 * Formats a keyboard shortcut for display based on the platform
 * @param keys Array of key combinations (e.g., ['mod', 'D'] or ['shift', 'mod', 'Scroll'])
 */
export const formatShortcut = async (keys: string[]): Promise<string> => {
	const isMacPlatform = await isMac();
	return keys
		.map((key) => {
			if (key.toLowerCase() === "mod") return isMacPlatform ? "⌘" : "Ctrl";
			if (key.toLowerCase() === "shift") return isMacPlatform ? "⇧" : "Shift";
			return key;
		})
		.join(" + ");
};
