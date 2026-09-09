import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
	CAMERA_VARIANTS,
	type CameraPrototypeVariant,
	CameraSettingsPrototype,
	INITIAL_CAMERA_SETTINGS,
	PrototypeShell,
} from "./camera-settings-prototypes";
import "./camera-settings-variants.css";

export default function CameraSettingsVariants() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [settings, setSettings] = useState(INITIAL_CAMERA_SETTINGS);
	const requested = searchParams.get("variant");
	const active: CameraPrototypeVariant = CAMERA_VARIANTS.some(
		(variant) => variant.id === requested,
	)
		? (requested as CameraPrototypeVariant)
		: "spatial";

	const selectVariant = useCallback(
		(variant: CameraPrototypeVariant) => {
			setSearchParams((current) => {
				const next = new URLSearchParams(current);
				next.set("variant", variant);
				return next;
			});
		},
		[setSearchParams],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				target?.matches("button, input, select, summary, textarea")
			)
				return;

			const current = CAMERA_VARIANTS.findIndex(
				(variant) => variant.id === active,
			);
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				selectVariant(
					CAMERA_VARIANTS[
						(current - 1 + CAMERA_VARIANTS.length) % CAMERA_VARIANTS.length
					].id,
				);
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				selectVariant(
					CAMERA_VARIANTS[(current + 1) % CAMERA_VARIANTS.length].id,
				);
			}
			if (event.key === "1" || event.key === "2" || event.key === "3") {
				selectVariant(CAMERA_VARIANTS[Number(event.key) - 1].id);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [active, selectVariant]);

	return (
		<main className="camera-variant-page">
			<aside className="camera-variant-page__rail" aria-label="Editor tools">
				<span className="camera-variant-page__brand">Q</span>
				<button type="button" aria-label="Background">
					▧
				</button>
				<button type="button" aria-label="Camera" aria-pressed="true">
					◉
				</button>
				<button type="button" aria-label="Audio">
					⌁
				</button>
				<button type="button" aria-label="Cursor">
					↗
				</button>
			</aside>

			<aside className="camera-variant-page__inspector">
				<PrototypeShell>
					<CameraSettingsPrototype
						variant={active}
						settings={settings}
						onChange={setSettings}
					/>
				</PrototypeShell>
			</aside>

			<section
				className="camera-variant-page__workspace"
				aria-label="Editor preview"
			>
				<header className="camera-variant-page__toolbar">
					<button type="button">Auto⌄</button>
					<button type="button">⌗ Crop</button>
					<span />
					<small>Preview quality</small>
					<button type="button">Full⌄</button>
				</header>

				<div className="camera-variant-page__preview-wrap">
					<div className="camera-variant-page__preview">
						<div className="camera-variant-page__document">
							<div className="camera-variant-page__document-nav" />
							<div className="camera-variant-page__document-body">
								<strong>Make every frame feel intentional.</strong>
								<span />
								<span />
								<span />
							</div>
						</div>
						{!settings.hide && (
							<div
								className="camera-variant-page__camera"
								data-x={settings.position.x}
								data-y={settings.position.y}
								data-shape={settings.shape}
								style={{
									width: `${Math.max(80, settings.size * 3.4)}px`,
									borderRadius: `${settings.rounding}%`,
									boxShadow: `0 ${Math.round(settings.shadow / 5)}px ${Math.round(settings.shadow / 2)}px rgb(0 0 0 / ${settings.shadow / 180})`,
									filter:
										settings.backgroundBlur === "heavy"
											? "saturate(0.72) contrast(1.06)"
											: settings.backgroundBlur === "light"
												? "saturate(0.88)"
												: undefined,
									scale: settings.mirror ? "-1 1" : undefined,
								}}
							/>
						)}
					</div>
				</div>

				<div className="camera-variant-page__transport">
					<strong>0:12.08</strong>
					<span>/ 0:35.14</span>
					<button type="button" aria-label="Previous">
						↤
					</button>
					<button type="button" aria-label="Play">
						▷
					</button>
					<button type="button" aria-label="Next">
						↦
					</button>
				</div>
			</section>

			<section className="camera-variant-page__timeline" aria-label="Timeline">
				<div className="camera-variant-page__timeline-tools">
					<strong>＋ Add</strong>
					<button type="button">⌁ Auto zoom</button>
				</div>
				<div className="camera-variant-page__ruler">
					<span>0:00</span>
					<span>0:06</span>
					<span>0:12</span>
					<span>0:18</span>
					<span>0:24</span>
					<span>0:30</span>
				</div>
				<div className="camera-variant-page__track camera-variant-page__track--video">
					35.1s · 1×
				</div>
				<div className="camera-variant-page__track camera-variant-page__track--zoom">
					<span>1.0×</span>
					<span>2.0×</span>
					<span>1.6×</span>
				</div>
			</section>

			<nav className="variant-picker" aria-label="Variants">
				{CAMERA_VARIANTS.map((variant) => (
					<button
						key={variant.id}
						type="button"
						data-variant={variant.id}
						aria-current={active === variant.id ? "true" : undefined}
						onClick={() => selectVariant(variant.id)}
					>
						{variant.label}
					</button>
				))}
			</nav>
		</main>
	);
}
