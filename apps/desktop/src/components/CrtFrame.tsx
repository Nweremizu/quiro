import type { ReactNode } from "react";

// The miniature Quiro-branded CRT used by the target-picker hints. Adapted
// from the Dell CRT enclosure study; the plastic, recessed bezel, curved
// glass, scanlines and phosphor mask all live in App.css under
// `.quiro-crt-hint`. Whatever is passed as children renders *inside* the
// glass, behind the scanline and glare layers.
export default function CrtFrame({ children }: { children?: ReactNode }) {
	return (
		<div className="quiro-crt-hint" aria-hidden="true">
			<div className="quiro-crt-hint__lip" />

			<div className="quiro-crt-hint__bezel">
				<div className="quiro-crt-hint__glass">
					<div className="quiro-crt-hint__screen">{children}</div>
					<div className="quiro-crt-hint__scanlines" />
					<div className="quiro-crt-hint__phosphor" />
					<div className="quiro-crt-hint__glare" />
				</div>
			</div>

			<div className="quiro-crt-hint__chin">
				<div className="quiro-crt-hint__osd">
					<span />
					<span />
					<span />
				</div>
				<div className="quiro-crt-hint__badge">QUIRO</div>
				<div className="quiro-crt-hint__led" />
			</div>
		</div>
	);
}
