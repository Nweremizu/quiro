import { Icon } from "./icons";
import { BrandMark } from "./logo";

export function ProductStage() {
	return (
		<div className="product-stage" role="img" aria-label="Quiro editor preview">
			<div className="editor-window">
				<div className="editor-topbar">
					<div className="window-controls">
						<span />
						<span />
						<span />
					</div>
					<div className="project-name">Product walkthrough</div>
					<div className="export-pill">
						<Icon name="export" /> Export
					</div>
				</div>
				<div className="editor-body">
					<aside className="editor-sidebar">
						<div className="editor-app-mark">
							<BrandMark />
						</div>
						<div className="sidebar-tab active">
							<Icon name="sparkle" />
						</div>
						<div className="sidebar-tab">
							<Icon name="caption" />
						</div>
						<div className="sidebar-tab">
							<Icon name="cursor" />
						</div>
					</aside>
					<div className="canvas-area">
						<div className="canvas-frame">
							<div className="demo-desktop">
								<div className="demo-toolbar">
									<span />
									<span />
									<span />
								</div>
								<div className="demo-content">
									<div className="demo-copy">
										<div className="demo-kicker">THE NEW WORKFLOW</div>
										<div className="demo-title">Show it clearly.</div>
										<div className="demo-lines">
											<span />
											<span />
										</div>
									</div>
									<div className="demo-card">
										<div className="demo-orbit" />
										<div className="demo-dot" />
									</div>
								</div>
							</div>
							<div className="camera-bubble">
								<div className="avatar-head" />
								<div className="avatar-body" />
							</div>
							<div className="cursor-point">
								<Icon name="cursor" />
							</div>
						</div>
					</div>
					<aside className="inspector">
						<div className="inspector-title">Canvas</div>
						<div className="inspector-label">Background</div>
						<div className="swatches">
							<span className="swatch orange" />
							<span className="swatch peach" />
							<span className="swatch lilac" />
						</div>
						<div className="inspector-label">Padding</div>
						<div className="control-track">
							<span />
						</div>
						<div className="inspector-row">
							<span>Shadow</span>
							<span className="toggle" />
						</div>
					</aside>
				</div>
				<div className="timeline">
					<div className="timeline-controls">
						<span className="play-button">▶</span>
						<span>00:06 / 00:18</span>
					</div>
					<div className="timeline-track">
						<div className="timeline-playhead" />
						<div className="timeline-clip primary" />
						<div className="timeline-clip secondary" />
					</div>
				</div>
			</div>
			<div className="stage-note note-one">Smart zoom</div>
			<div className="stage-note note-two">Camera, your way</div>
		</div>
	);
}
