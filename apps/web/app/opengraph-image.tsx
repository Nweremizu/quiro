import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/logo";

export const alt = "Quiro — Your idea, made visible";
export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				padding: "68px 74px",
				background: "#fdfdfe",
				color: "#292a2f",
				fontFamily: "Arial, sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					width: "58%",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 56,
							height: 56,
							borderRadius: 12,
							background: "#f38020",
							color: "white",
							boxShadow:
								"0 1px 2px rgba(41,42,47,.08), 0 8px 20px -6px rgba(41,42,47,.18), inset 0 1px 0 rgba(255,255,255,.35)",
						}}
					>
						<BrandMark style={{ width: 38, height: 38 }} />
					</div>
					<div
						style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.04em" }}
					>
						Quiro
					</div>
				</div>
				<div style={{ display: "flex", flexDirection: "column" }}>
					<div
						style={{ fontSize: 74, fontWeight: 700, letterSpacing: "-0.065em" }}
					>
						Your idea,
					</div>
					<div
						style={{
							fontSize: 74,
							fontWeight: 700,
							letterSpacing: "-0.065em",
							color: "#f38020",
						}}
					>
						made visible.
					</div>
					<div style={{ marginTop: 26, fontSize: 22, color: "#686a70" }}>
						Beautiful screen recordings, owned by you.
					</div>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "38%",
					marginLeft: "auto",
					borderRadius: 24,
					background: "#f38020",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 330,
						height: 360,
						overflow: "hidden",
						border: "1px solid rgba(255,255,255,.16)",
						borderRadius: 16,
						background: "#2d2d2d",
						boxShadow: "0 30px 60px rgba(70,32,5,.28)",
					}}
				>
					<div style={{ height: 42, borderBottom: "1px solid #454545" }} />
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flex: 1,
							margin: 28,
							borderRadius: 16,
							background: "#ffd1aa",
						}}
					>
						<div
							style={{
								width: 150,
								height: 150,
								border: "1px solid rgba(25,21,18,.24)",
								borderRadius: 75,
							}}
						/>
					</div>
					<div style={{ height: 70, borderTop: "1px solid #454545" }} />
				</div>
			</div>
		</div>,
		size,
	);
}
