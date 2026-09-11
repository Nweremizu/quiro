import {
	currentMonitor,
	getCurrentWindow,
	LogicalSize,
	PhysicalPosition,
} from "@tauri-apps/api/window";

// Ported from Cap's real main-window resize logic (apps/desktop/src/routes/
// (window-chrome)/new-main/index.tsx). The main window is built non-resizable
// on the Rust side (see windows/variants/main_window.rs) — .resizable(false)
// only disables the user dragging the edges, programmatic setSize() still
// works, which is exactly what this drives.
export const MAIN_WINDOW_SIZE = {
	compact: { width: 330, height: 395 },
	expanded: { width: 600, height: 660 },
} as const;
const MAIN_WINDOW_SCREEN_PADDING = 12;
const MAIN_WINDOW_RESIZE_DURATION = 180;

const nextAnimationFrame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.min(Math.max(value, minimum), maximum);

export async function resizeMainWindow(expanded: boolean, animate: boolean) {
	const currentWindow = getCurrentWindow();
	const [physicalSize, outerSize, scaleFactor, physicalPosition, monitor] =
		await Promise.all([
			currentWindow.innerSize(),
			currentWindow.outerSize(),
			currentWindow.scaleFactor(),
			currentWindow.outerPosition().catch(() => null),
			currentMonitor().catch(() => null),
		]);

	const frameWidth = Math.max(
		0,
		(outerSize.width - physicalSize.width) / scaleFactor,
	);
	const frameHeight = Math.max(
		0,
		(outerSize.height - physicalSize.height) / scaleFactor,
	);
	const preferredSize = expanded
		? MAIN_WINDOW_SIZE.expanded
		: MAIN_WINDOW_SIZE.compact;
	const availableWidth = monitor
		? monitor.workArea.size.width / scaleFactor -
			frameWidth -
			MAIN_WINDOW_SCREEN_PADDING * 2
		: preferredSize.width;
	const availableHeight = monitor
		? monitor.workArea.size.height / scaleFactor -
			frameHeight -
			MAIN_WINDOW_SCREEN_PADDING * 2
		: preferredSize.height;
	const targetWidth = Math.max(
		MAIN_WINDOW_SIZE.compact.width,
		Math.min(preferredSize.width, availableWidth),
	);
	const targetHeight = Math.max(
		MAIN_WINDOW_SIZE.compact.height,
		Math.min(preferredSize.height, availableHeight),
	);
	const startWidth = physicalSize.width / scaleFactor;
	const startHeight = physicalSize.height / scaleFactor;
	const widthDelta = targetWidth - startWidth;
	const heightDelta = targetHeight - startHeight;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	if (monitor && physicalPosition) {
		const padding = MAIN_WINDOW_SCREEN_PADDING * scaleFactor;
		const workArea = monitor.workArea;
		const targetPhysicalWidth = (targetWidth + frameWidth) * scaleFactor;
		const targetPhysicalHeight = (targetHeight + frameHeight) * scaleFactor;
		const minimumX = workArea.position.x + padding;
		const minimumY = workArea.position.y + padding;
		const maximumX = Math.max(
			minimumX,
			workArea.position.x + workArea.size.width - targetPhysicalWidth - padding,
		);
		const maximumY = Math.max(
			minimumY,
			workArea.position.y +
				workArea.size.height -
				targetPhysicalHeight -
				padding,
		);
		const targetX = clamp(physicalPosition.x, minimumX, maximumX);
		const targetY = clamp(physicalPosition.y, minimumY, maximumY);

		if (targetX !== physicalPosition.x || targetY !== physicalPosition.y) {
			await currentWindow
				.setPosition(
					new PhysicalPosition(Math.round(targetX), Math.round(targetY)),
				)
				.catch(() => undefined);
		}
	}

	if (Math.abs(widthDelta) <= 0.5 && Math.abs(heightDelta) <= 0.5) return;

	if (!animate || reduceMotion) {
		await currentWindow.setSize(new LogicalSize(targetWidth, targetHeight));
		return;
	}

	let pendingSize: LogicalSize | undefined;
	let resizeWorker: Promise<void> | undefined;
	let resizeError: unknown;
	let resizeFailed = false;
	const scheduleResize = (size: LogicalSize) => {
		if (resizeFailed) return;
		pendingSize = size;
		if (resizeWorker) return;
		resizeWorker = (async () => {
			while (pendingSize) {
				const nextSize = pendingSize;
				pendingSize = undefined;
				await currentWindow.setSize(nextSize);
			}
		})()
			.catch((error) => {
				resizeFailed = true;
				resizeError = error;
				pendingSize = undefined;
			})
			.finally(() => {
				resizeWorker = undefined;
			});
	};

	const startedAt = performance.now();
	let progress = 0;
	while (progress < 1) {
		await nextAnimationFrame();
		progress = Math.min(
			1,
			(performance.now() - startedAt) / MAIN_WINDOW_RESIZE_DURATION,
		);
		const eased = 1 - (1 - progress) ** 3;
		scheduleResize(
			new LogicalSize(
				startWidth + widthDelta * eased,
				startHeight + heightDelta * eased,
			),
		);
	}
	await resizeWorker;
	if (resizeFailed) throw resizeError;
}
