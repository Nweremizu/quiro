import { DialRoot, useDialKit } from "dialkit";
import { useEffect } from "react";
import "dialkit/styles.css";
import { useEditorContext } from "@/routes/editor/context";

// DEV ONLY. Never reached in a production build — see `DevDials.tsx`, which is
// the only importer and loads this module behind an `import.meta.env.DEV`
// branch so Rollup drops the chunk entirely.
//
// Three dials for `ScreenMovementSpring`, the spring that drives both the zoom
// framing and all six motion channels. Tuning these is the whole point: the
// motion state says *where* the canvas goes, and this says how it gets there
// and back.
//
// It works live because the spring is a `ProjectConfiguration` field, so a
// change round-trips over IPC and the Rust renderer rebuilds its timeline on
// the next frame. No rebuild, no restart.

/** Rust's `ScreenMovementSpring::default()` — the reset target, and the values
 * to beat. Kept in step with `configuration.rs`. */
const DEFAULTS = { stiffness: 200, damping: 40, mass: 2.25 };

export function SpringDials() {
	const { project, setProject } = useEditorContext();
	const spring = project?.screenMovementSpring;

	const dials = useDialKit(
		"Motion spring",
		{
			// [default, min, max, step]. Ranges are wide enough to find the edges
			// of usable — a stiffness of 20 crawls, 600 snaps.
			stiffness: [spring?.stiffness ?? DEFAULTS.stiffness, 20, 600, 5],
			damping: [spring?.damping ?? DEFAULTS.damping, 1, 120, 1],
			mass: [spring?.mass ?? DEFAULTS.mass, 0.1, 10, 0.05],
			reset: { type: "action" as const, label: "Reset to Rust defaults" },
		},
		{
			id: "motion-spring",
			// Survives a webview reload, so a tuning session is not lost to hot
			// reload. The project write below is what actually drives the render.
			persist: true,
			shortcuts: {
				stiffness: { key: "s", mode: "fine" },
				damping: { key: "d", mode: "fine" },
				mass: { key: "m", mode: "fine" },
			},
			onAction: () => {
				setProject((current) => ({
					...current,
					screenMovementSpring: { ...DEFAULTS },
				}));
			},
		},
	);

	// Push dial values into the project, which is the only thing the Rust
	// renderer reads. Guarded on a real change so dragging one dial does not
	// republish the config on every unrelated re-render.
	useEffect(() => {
		const next = {
			stiffness: dials.stiffness,
			damping: dials.damping,
			mass: dials.mass,
		};
		if (
			spring?.stiffness === next.stiffness &&
			spring?.damping === next.damping &&
			spring?.mass === next.mass
		) {
			return;
		}
		setProject((current) => ({ ...current, screenMovementSpring: next }));
	}, [dials.stiffness, dials.damping, dials.mass, spring, setProject]);

	return <DialRoot position="bottom-right" defaultOpen={false} />;
}
