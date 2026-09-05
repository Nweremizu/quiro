import { type ComponentType, useEffect, useState } from "react";

// The dev-only boundary for the DialKit tuning panel.
//
// `dialkit` is a devDependency, so it must not appear in a production bundle at
// all — hiding the panel at runtime would not be enough, since the import
// itself would still be resolved and shipped.
//
// So the import is dynamic AND lives inside an `import.meta.env.DEV` branch.
// Vite replaces that with a literal `false` when building for production, and
// Rollup then eliminates the whole branch — including the `import()`, so the
// chunk is never emitted and `dialkit` never enters the graph. In dev the
// branch is `true` and the panel loads on mount.
//
// This is also why the guard cannot be `if (!import.meta.env.DEV) return null`
// over a static import: that hides the panel but still bundles the library.

export function DevDials() {
	const [Panel, setPanel] = useState<ComponentType | null>(null);

	useEffect(() => {
		if (!import.meta.env.DEV) return;
		let cancelled = false;
		void import("./SpringDials").then((module) => {
			if (!cancelled) setPanel(() => module.SpringDials);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return Panel ? <Panel /> : null;
}
