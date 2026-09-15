import type { ReactNode } from "react";

export default function FooterBottom({ children }: { children?: ReactNode }) {
	return (
		<div className="footer-bottom">
			<span>© {new Date().getFullYear()} Quiro</span>
			<span>Beautiful screen recordings, owned by you.</span>
			{children}
		</div>
	);
}
