// Icons resolve as real components at build time via unplugin-icons,
// configured in each *consuming app's* vite.config.ts (see apps/desktop).
// This package ships raw TSX with no build step of its own, so a standalone
// `tsc --noEmit` here needs its own ambient declaration for `~icons/*` —
// apps/desktop gets the real one from `unplugin-icons/types/react`.
declare module "~icons/*" {
	import type { FC, SVGProps } from "react";

	const component: FC<SVGProps<SVGSVGElement>>;
	export default component;
}
