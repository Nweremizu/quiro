import posthog from "posthog-js";

type ErrorContext = Record<string, string | number | boolean>;

const projectToken = import.meta.env.VITE_QUIRO_POSTHOG_API_KEY;
let initialized = false;

export function initPostHog() {
	if (initialized || !projectToken) return;

	posthog.init(projectToken, {
		api_host: "https://eu.i.posthog.com",
		autocapture: false,
		capture_exceptions: true,
		capture_pageview: false,
		disable_session_recording: true,
		person_profiles: "never",
		persistence: "memory",
	});
	initialized = true;
}

export function captureDesktopException(error: unknown, context: ErrorContext) {
	if (!initialized) return;

	const normalized =
		error instanceof Error ? error : new Error("Desktop operation failed");
	posthog.captureException(normalized, {
		...context,
		error_type: error instanceof Error ? error.name : typeof error,
	});
}

export async function captureTauriCall<T>(
	area: string,
	operation: string,
	call: () => Promise<T>,
): Promise<T> {
	try {
		return await call();
	} catch (error) {
		captureDesktopException(error, { area, operation });
		throw error;
	}
}

export function captureTauriResult<T>(
	area: string,
	operation: string,
	result: { status: "ok"; data: T } | { status: "error"; error: unknown },
) {
	if (result.status === "error") {
		captureDesktopException(new Error(`${operation} failed`), {
			area,
			operation,
			error_type: "native_result",
		});
	}
	return result;
}
