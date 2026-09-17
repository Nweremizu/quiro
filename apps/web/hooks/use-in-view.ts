"use client";

import { useEffect, useRef, useState } from "react";

// One-shot: unobserves itself the first time the element is (mostly)
// visible, so a scroll back up never re-triggers the animation.
export function useInView<T extends Element>(margin = "-100px") {
	const ref = useRef<T>(null);
	const [inView, setInView] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setInView(true);
					observer.unobserve(el);
				}
			},
			{ rootMargin: margin, threshold: 0.2 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [margin]);

	return { ref, inView };
}
