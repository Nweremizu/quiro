import { convertFileSrc } from "@tauri-apps/api/core";

const MAX_CACHED_IMAGES = 128;

type CachedImage = {
	image: HTMLImageElement | null;
	lastUsed: number;
	url: string;
};

const cachedImages = new Map<string, CachedImage>();
let useCounter = 0;

function pruneImageCache() {
	while (cachedImages.size > MAX_CACHED_IMAGES) {
		let oldestPath: string | null = null;
		let oldestUse = Number.POSITIVE_INFINITY;
		for (const [path, entry] of cachedImages) {
			if (entry.lastUsed < oldestUse) {
				oldestPath = path;
				oldestUse = entry.lastUsed;
			}
		}
		if (!oldestPath) return;
		cachedImages.delete(oldestPath);
	}
}

export function cachedFileImageUrl(path: string) {
	const cached = cachedImages.get(path);
	if (cached) {
		cached.lastUsed = ++useCounter;
		return cached.url;
	}

	const url = convertFileSrc(path);
	const image = typeof Image === "undefined" ? null : new Image();
	if (image) {
		image.decoding = "async";
		image.src = url;
		void image.decode().catch(() => undefined);
	}
	cachedImages.set(path, { image, lastUsed: ++useCounter, url });
	pruneImageCache();
	return url;
}

export function invalidateCachedFileImage(path: string) {
	cachedImages.delete(path);
}
