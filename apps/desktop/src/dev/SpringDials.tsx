import { DialRoot, useDialKitController } from "dialkit";
import { useEffect, useRef } from "react";
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

	const { values: dials, setValues } = useDialKitController(
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
	const previousDials = useRef({
		stiffness: dials.stiffness,
		damping: dials.damping,
		mass: dials.mass,
	});
	const previousSpring = useRef(spring && { ...spring });
	const springStiffness = spring?.stiffness;
	const springDamping = spring?.damping;
	const springMass = spring?.mass;

	useEffect(() => {
		const next = {
			stiffness: dials.stiffness,
			damping: dials.damping,
			mass: dials.mass,
		};
		const dialsChanged =
			previousDials.current.stiffness !== next.stiffness ||
			previousDials.current.damping !== next.damping ||
			previousDials.current.mass !== next.mass;
		const springChanged =
			previousSpring.current?.stiffness !== springStiffness ||
			previousSpring.current?.damping !== springDamping ||
			previousSpring.current?.mass !== springMass;

		if (
			springStiffness !== undefined &&
			springDamping !== undefined &&
			springMass !== undefined &&
			springChanged &&
			!dialsChanged
		) {
			setValues({
				stiffness: springStiffness,
				damping: springDamping,
				mass: springMass,
			});
		} else if (
			springStiffness !== undefined &&
			springDamping !== undefined &&
			springMass !== undefined &&
			dialsChanged &&
			(springStiffness !== next.stiffness ||
				springDamping !== next.damping ||
				springMass !== next.mass)
		) {
			setProject((current) => ({ ...current, screenMovementSpring: next }));
		}

		previousDials.current = next;
		previousSpring.current =
			springStiffness !== undefined &&
			springDamping !== undefined &&
			springMass !== undefined
				? {
						stiffness: springStiffness,
						damping: springDamping,
						mass: springMass,
					}
				: undefined;
	}, [
		dials.stiffness,
		dials.damping,
		dials.mass,
		springStiffness,
		springDamping,
		springMass,
		setProject,
		setValues,
	]);

	return <DialRoot position="bottom-right" defaultOpen={false} />;
}
