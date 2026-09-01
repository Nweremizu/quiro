import type {
	Annotation,
	ArrowCurve,
	ArrowHead,
	LineStyle,
} from "@/utils/tauri";

// Geometry engine for arrow annotations. One `buildArrow(spec)` call produces
// everything both renderers need as plain data, so the SVG editor
// (`AnnotationLayer`) and the Canvas exporter (`screenshotExport`) draw the
// exact same shape from the exact same numbers.
//
// The stored model stays tiny: two endpoints plus a signed `bend` scalar. Every
// curve — quadratic, cubic S, elbow — is reconstructed from those, so undo,
// serialization, resize and copy never touch raw control points. (Cap's arrow
// was a bare <line>; this is the essay's "editable shape model".)

export type Pt = { x: number; y: number };

export type ArrowSpec = {
	start: Pt;
	end: Pt;
	/** Perpendicular offset of the mid control point, as a fraction of the
	 * chord length. 0 = straight. Sign picks the side. Unused for `elbow`. */
	bend: number;
	curve: ArrowCurve;
	strokeWidth: number;
	/** Multiplies the default head size. */
	headScale: number;
	startHead: ArrowHead;
	endHead: ArrowHead;
	lineStyle: LineStyle;
	taper: boolean;
};

/** Pull an `ArrowSpec` off an annotation, filling every arrow field with the
 * value that reproduces a pre-feature arrow (straight, one solid head). */
export function arrowSpec(ann: Annotation): ArrowSpec {
	return {
		start: { x: ann.x, y: ann.y },
		end: { x: ann.x + ann.width, y: ann.y + ann.height },
		bend: ann.arrowBend ?? 0,
		curve: ann.arrowCurve ?? "straight",
		strokeWidth: ann.strokeWidth,
		headScale: ann.arrowHeadSize ?? 1,
		startHead: ann.arrowStartHead ?? "none",
		endHead: ann.arrowEndHead ?? "triangle",
		lineStyle: ann.lineStyle ?? "solid",
		taper: ann.arrowTaper ?? false,
	};
}

export type HeadShape =
	| { kind: "none" }
	/** Open chevron — drawn as a stroke, not a fill. */
	| { kind: "arrow"; points: [Pt, Pt, Pt] }
	| { kind: "triangle"; points: [Pt, Pt, Pt] }
	| { kind: "circle"; c: Pt; r: number }
	| { kind: "square"; points: Pt[] };

export type BuiltArrow = {
	/** Centreline polyline, already trimmed back from each tip so a thick
	 * stroke does not poke through a head. Stroke this when `outline` is null. */
	shaft: Pt[];
	/** Closed tapered polygon to fill instead of stroking `shaft`, or null. */
	outline: Pt[] | null;
	/** Dash pattern for the shaft, or null for a solid line. */
	dash: number[] | null;
	startHead: HeadShape;
	endHead: HeadShape;
	/** Untrimmed full centreline — for export bounds, which must contain the
	 * curve's bulge, not just the endpoint bounding box. */
	samples: Pt[];
};

const SAMPLES = 64;

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function controlPoints(spec: ArrowSpec): Pt[] {
	const { start: a, end: b } = spec;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len; // unit perpendicular
	const ny = dx / len;
	const off = spec.bend * len;

	switch (spec.curve) {
		case "quadratic": {
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			return [a, { x: mx + nx * off, y: my + ny * off }, b];
		}
		case "cubic":
			return [
				a,
				{ x: a.x + dx / 3 + nx * off, y: a.y + dy / 3 + ny * off },
				{ x: a.x + (dx * 2) / 3 - nx * off, y: a.y + (dy * 2) / 3 - ny * off },
				b,
			];
		case "elbow": {
			// One right-angled corner, turning along the dominant axis first.
			const corner =
				Math.abs(dx) >= Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
			return [a, corner, b];
		}
		default:
			return [a, b];
	}
}

/** de Casteljau — handles quadratic (3 pts) and cubic (4 pts). */
function bezier(cps: Pt[], t: number): Pt {
	let p = cps;
	while (p.length > 1) {
		const next: Pt[] = [];
		for (let i = 0; i < p.length - 1; i++) {
			next.push({
				x: p[i].x + (p[i + 1].x - p[i].x) * t,
				y: p[i].y + (p[i + 1].y - p[i].y) * t,
			});
		}
		p = next;
	}
	return p[0];
}

export function sampleArrow(spec: ArrowSpec): Pt[] {
	const cps = controlPoints(spec);
	// Straight and elbow are already the polyline we want.
	if (cps.length === 2 || spec.curve === "elbow") return cps;
	const pts: Pt[] = [];
	for (let i = 0; i <= SAMPLES; i++) pts.push(bezier(cps, i / SAMPLES));
	return pts;
}

/** The arrow's curve as cubic control points, degree-elevating the quadratic
 * so tangent and bounding-box maths need only one code path. Null for the
 * straight and elbow modes, which are polylines and already exact. */
function cubicOf(spec: ArrowSpec): [Pt, Pt, Pt, Pt] | null {
	const cps = controlPoints(spec);
	if (spec.curve === "cubic" && cps.length === 4)
		return [cps[0], cps[1], cps[2], cps[3]];
	if (spec.curve === "quadratic" && cps.length === 3) {
		const [p0, q, p2] = cps;
		return [
			p0,
			{ x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
			{ x: p2.x + (2 / 3) * (q.x - p2.x), y: p2.y + (2 / 3) * (q.y - p2.y) },
			p2,
		];
	}
	return null;
}

/** Unit tangent of a cubic at `t`, from the analytic derivative B'(t) — exact,
 * unlike the direction of the last sampled segment. */
function cubicTangent(cps: [Pt, Pt, Pt, Pt], t: number): Pt {
	const t2 = t * t;
	const w0 = -3 * t2 + 6 * t - 3;
	const w1 = 9 * t2 - 12 * t + 3;
	const w2 = -9 * t2 + 6 * t;
	const w3 = 3 * t2;
	const x = cps[0].x * w0 + cps[1].x * w1 + cps[2].x * w2 + cps[3].x * w3;
	const y = cps[0].y * w0 + cps[1].y * w1 + cps[2].y * w2 + cps[3].y * w3;
	const len = Math.hypot(x, y);
	return len < 1e-9 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

/** The t values in (0,1) where one coordinate of a cubic is at an extreme:
 * the roots of the derivative, which is a quadratic. Solving these gives the
 * curve's exact bounding box — no sampling, no guessed padding. */
function derivativeRoots(
	c0: number,
	c1: number,
	c2: number,
	c3: number,
): number[] {
	const a = -3 * c0 + 9 * c1 - 9 * c2 + 3 * c3;
	const b = 6 * c0 - 12 * c1 + 6 * c2;
	const c = 3 * c1 - 3 * c0;

	const roots: number[] = [];
	if (Math.abs(a) < 1e-9) {
		// Degenerates to a linear equation.
		if (Math.abs(b) > 1e-9) roots.push(-c / b);
	} else {
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const s = Math.sqrt(disc);
			roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
		}
	}
	return roots.filter((t) => t > 0 && t < 1);
}

function headBaseLength(
	kind: ArrowHead,
	strokeWidth: number,
	scale: number,
): number {
	if (kind === "none") return 0;
	const w = Math.max(1, strokeWidth);
	if (kind === "circle" || kind === "square")
		return Math.max(10, w * 2.6) * scale;
	return Math.max(20, w * 6) * scale; // arrow / triangle
}

/** A head with its point at `tip`, its base sitting exactly on `base` (the
 * trimmed shaft end, so head and shaft can never separate) and aimed along
 * `axis` — the curve's exact tangent. Falls back to the base→tip chord when
 * no analytic tangent is available (straight and elbow arrows). */
function head(
	kind: ArrowHead,
	tip: Pt,
	base: Pt,
	axis: Pt,
	strokeWidth: number,
	scale: number,
): HeadShape {
	if (kind === "none") return { kind: "none" };

	const dx = tip.x - base.x;
	const dy = tip.y - base.y;
	const len = Math.hypot(dx, dy) || 1;
	let ux = axis.x;
	let uy = axis.y;
	if (ux === 0 && uy === 0) {
		ux = dx / len;
		uy = dy / len;
	}
	const px = -uy; // unit perpendicular
	const py = ux;

	if (kind === "circle" || kind === "square") {
		const r = len / 2;
		const cx = tip.x - ux * r;
		const cy = tip.y - uy * r;
		if (kind === "circle") return { kind: "circle", c: { x: cx, y: cy }, r };
		return {
			kind: "square",
			points: [
				{ x: cx + ux * r + px * r, y: cy + uy * r + py * r },
				{ x: cx + ux * r - px * r, y: cy + uy * r - py * r },
				{ x: cx - ux * r - px * r, y: cy - uy * r - py * r },
				{ x: cx - ux * r + px * r, y: cy - uy * r + py * r },
			],
		};
	}

	// arrow (open chevron) and triangle (filled): back corner → tip → back
	// corner, so the stroked chevron is a symmetric V with its apex on the tip.
	const wing = (Math.max(14, Math.max(1, strokeWidth) * 5) * scale) / 2;
	return {
		kind,
		points: [
			{ x: base.x + px * wing, y: base.y + py * wing },
			tip,
			{ x: base.x - px * wing, y: base.y - py * wing },
		],
	};
}

/** Drop `d` of arc length off the `pts[0]` end (or the far end if `fromEnd`). */
function trim(pts: Pt[], d: number, fromEnd: boolean): Pt[] {
	if (d <= 0 || pts.length < 2) return pts;
	const seq = fromEnd ? [...pts].reverse() : pts;
	let acc = 0;
	for (let i = 0; i < seq.length - 1; i++) {
		const seg = dist(seq[i], seq[i + 1]);
		if (acc + seg >= d) {
			const t = seg === 0 ? 0 : (d - acc) / seg;
			const cut = {
				x: seq[i].x + (seq[i + 1].x - seq[i].x) * t,
				y: seq[i].y + (seq[i + 1].y - seq[i].y) * t,
			};
			const rest = [cut, ...seq.slice(i + 1)];
			return fromEnd ? rest.reverse() : rest;
		}
		acc += seg;
	}
	// Whole line is shorter than the cut: collapse to the surviving endpoint.
	return fromEnd ? [pts[0]] : [pts[pts.length - 1]];
}

/** Centreline → closed polygon whose half-width eases from `wMin` at the start
 * to `wMax` at the end, for the tapered-brush look. */
function taperOutline(pts: Pt[], wMin: number, wMax: number): Pt[] {
	const n = pts.length;
	if (n < 2) return [];
	const cum = [0];
	for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
	const total = cum[n - 1] || 1;

	const left: Pt[] = [];
	const right: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const prev = pts[Math.max(0, i - 1)];
		const next = pts[Math.min(n - 1, i + 1)];
		const tx = next.x - prev.x;
		const ty = next.y - prev.y;
		const tl = Math.hypot(tx, ty) || 1;
		const nx = -ty / tl;
		const ny = tx / tl;
		const t = cum[i] / total;
		const half = (wMin + (wMax - wMin) * (t * (2 - t))) / 2; // easeOut
		left.push({ x: pts[i].x + nx * half, y: pts[i].y + ny * half });
		right.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
	}
	return [...left, ...right.reverse()];
}

export function buildArrow(spec: ArrowSpec): BuiltArrow {
	const samples = sampleArrow(spec);

	// Trim the shaft back by each head's length first; the surviving shaft
	// endpoints then *are* the head bases, so head and shaft can never drift
	// apart and the head always points along the real curve.
	let shaft = trim(
		samples,
		headBaseLength(spec.endHead, spec.strokeWidth, spec.headScale),
		true,
	);
	shaft = trim(
		shaft,
		headBaseLength(spec.startHead, spec.strokeWidth, spec.headScale),
		false,
	);

	// Exact tangents at the two ends. The start head points back out of the
	// curve, so its axis is the tangent at t=0 negated.
	const cubic = cubicOf(spec);
	const endAxis = cubic ? cubicTangent(cubic, 1) : { x: 0, y: 0 };
	const startAxis = cubic ? cubicTangent(cubic, 0) : { x: 0, y: 0 };

	const endHead = head(
		spec.endHead,
		spec.end,
		shaft[shaft.length - 1] ?? spec.end,
		endAxis,
		spec.strokeWidth,
		spec.headScale,
	);
	const startHead = head(
		spec.startHead,
		spec.start,
		shaft[0] ?? spec.start,
		{ x: -startAxis.x, y: -startAxis.y },
		spec.strokeWidth,
		spec.headScale,
	);

	const sw = Math.max(1, spec.strokeWidth);
	const dash =
		spec.lineStyle === "dashed"
			? [sw * 3, sw * 2]
			: spec.lineStyle === "dotted"
				? [sw * 0.01, sw * 2]
				: null;

	const outline = spec.taper ? taperOutline(shaft, sw * 0.15, sw) : null;

	return { shaft, outline, dash, startHead, endHead, samples };
}

/** Exact bounds of everything the arrow paints: the curve's true extremes
 * (from the derivative roots), both head shapes, and half the stroke width.
 * Replaces sampling the curve and padding by a guess. */
export function arrowBounds(spec: ArrowSpec): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	const built = buildArrow(spec);
	const pts: Pt[] = [spec.start, spec.end];

	const cubic = cubicOf(spec);
	if (cubic) {
		const [p0, c1, c2, p3] = cubic;
		for (const t of derivativeRoots(p0.x, c1.x, c2.x, p3.x))
			pts.push(bezier(cubic, t));
		for (const t of derivativeRoots(p0.y, c1.y, c2.y, p3.y))
			pts.push(bezier(cubic, t));
	} else {
		// Straight and elbow: the polyline vertices are the extremes.
		pts.push(...built.samples);
	}

	for (const shape of [built.startHead, built.endHead]) {
		if (shape.kind === "circle") {
			pts.push(
				{ x: shape.c.x - shape.r, y: shape.c.y - shape.r },
				{ x: shape.c.x + shape.r, y: shape.c.y + shape.r },
			);
		} else if (shape.kind !== "none") {
			pts.push(...shape.points);
		}
	}

	// The stroke straddles the centreline; a taper never exceeds it.
	const pad = Math.max(1, spec.strokeWidth) / 2;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	return {
		minX: minX - pad,
		minY: minY - pad,
		maxX: maxX + pad,
		maxY: maxY + pad,
	};
}

/**
 * Where the bend handle sits — a point *on* the curve, so it tracks the cursor
 * exactly instead of lagging it.
 *
 * The offset from the chord differs by mode. A quadratic's midpoint moves half
 * as far as its control point. A cubic's midpoint doesn't move at all (the two
 * lobes cancel), so the handle rides at t=0.25 where the first lobe peaks and
 * the offset is 18/64 of the control offset.
 */
const BEND_ANCHOR = {
	quadratic: { at: 1 / 2, gain: 1 / 2 },
	cubic: { at: 1 / 4, gain: 18 / 64 },
} as const;

export function bendHandle(spec: ArrowSpec): Pt | null {
	const cfg =
		spec.curve === "quadratic" || spec.curve === "cubic"
			? BEND_ANCHOR[spec.curve]
			: null;
	if (!cfg) return null;
	const dx = spec.end.x - spec.start.x;
	const dy = spec.end.y - spec.start.y;
	// perp = (-dy, dx) unnormalised and offset = gain·bend·chord, so the chord
	// length cancels and this is a plain multiply.
	return {
		x: spec.start.x + dx * cfg.at - dy * cfg.gain * spec.bend,
		y: spec.start.y + dy * cfg.at + dx * cfg.gain * spec.bend,
	};
}

/** Inverse of `bendHandle`: the `bend` that puts the curve under `point`. */
export function bendFromHandle(spec: ArrowSpec, point: Pt): number {
	const cfg =
		spec.curve === "cubic" ? BEND_ANCHOR.cubic : BEND_ANCHOR.quadratic;
	const dx = spec.end.x - spec.start.x;
	const dy = spec.end.y - spec.start.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return spec.bend;
	const ax = spec.start.x + dx * cfg.at;
	const ay = spec.start.y + dy * cfg.at;
	const d = ((point.x - ax) * -dy + (point.y - ay) * dx) / len;
	return d / (cfg.gain * len);
}

export function polylinePath(pts: Pt[]): string {
	if (!pts.length) return "";
	return `M ${pts.map((p, i) => `${i ? "L " : ""}${p.x} ${p.y}`).join(" ")}`;
}

export function polygonPath(pts: Pt[]): string {
	return pts.length ? `${polylinePath(pts)} Z` : "";
}

/** Draw a resolved head onto a 2D canvas. Filled heads use `color`; the open
 * chevron is stroked with the caller's current `strokeStyle`/`lineWidth`. */
export function paintHead(
	ctx: CanvasRenderingContext2D,
	shape: HeadShape,
	color: string,
): void {
	if (shape.kind === "none") return;
	ctx.beginPath();
	if (shape.kind === "circle") {
		ctx.arc(shape.c.x, shape.c.y, shape.r, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		return;
	}
	const points = shape.points;
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
	if (shape.kind === "arrow") {
		ctx.stroke();
	} else {
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
	}
}
