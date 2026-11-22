/**
 * Connector routing: turns an `DiagramEdge` plus the current node positions
 * into the polyline the canvas draws, the arrowheads point along, and hit
 * testing measures against.
 *
 * The polyline is always authoritative — `path` is a rendering of it (rounded
 * corners for elbows, a Catmull-Rom spline for curves), so labels, midpoint
 * handles and hit tests never disagree with what the user sees.
 *
 * Which sides an elbow joins is chosen from where its two boxes are
 * (`chooseEnds`): every pair of sides is drawn and priced — length, corners,
 * legs too short to read, any run back behind a side it leaves — and the
 * cheapest wins, unless the pair it used last time is still nearly as good
 * (so a box dragged along a diagonal does not flip its line back and forth).
 */

import {
    AVOID_MARGIN,
    orthogonalDetour,
    polylineCrosses,
    pullTight,
    type PortOption,
} from "./avoid";
import {
    addPt,
    autoPort,
    distance,
    EPSILON,
    lerp,
    nodeBounds,
    nodeCenter,
    nodeRect,
    pointAlongPolyline,
    portNormal,
    projectOntoPolyline,
    portPoint,
    rayRectIntersection,
    samePoint,
    scalePt,
    subPt,
} from "./geometry";
import { isContainer } from "./shapes";
import type {
    ArrowId,
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    Endpoint,
    Point,
    PortId,
    Rect,
} from "./types";

/** How far a connector runs straight out of a port before it may turn. */
export const STUB = 18;
/** Corner rounding on elbow connectors, in world px. */
export const CORNER_RADIUS = 8;
/** Corner rounding on a curved connector's detour round a box. */
const CURVED_DETOUR_RADIUS = 28;
/**
 * No leg of an elbow is shorter than this, unless its two boxes are closer
 * than that: a shorter one reads as a stub, and its rounded corners meet.
 */
export const MIN_LEG = 20;
/** A leg this long reads as a run rather than a stub; an L wants both of its legs this long. */
export const COMFORT_LEG = 40;

/**
 * The way steps run on a document worked as a flowchart. A target downstream
 * of its source is joined from the side facing downstream to the side facing
 * back up: bottom to top on a chart that runs down.
 */
export type FlowDirection = "down" | "right";

export interface RouteOptions {
    /** Set on a document worked as a flowchart (`worksAsFlow`); absent or null elsewhere. */
    flow?: FlowDirection | null;
}

const NO_OPTIONS: RouteOptions = {};

export interface RoutedEdge {
    /** Polyline in world space; at least two points. */
    points: Point[];
    /** SVG path data rendering those points in the edge's style. */
    path: string;
    start: Point;
    end: Point;
    /** Unit vectors pointing *out of* each endpoint, for arrowhead rotation. */
    startNormal: Point;
    endNormal: Point;
    /**
     * Set when the line is drawn as a polyline with this corner radius instead
     * of in its kind's own style (a curved connector's detour), so anything
     * redrawing it — shortened for arrowheads — draws the same shape.
     */
    cornerRadius?: number;
}

export type NodeLookup = (id: string) => DiagramNode | undefined;

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

interface ResolvedEnd {
    point: Point;
    /** Outward normal; zero-length when the endpoint is free-floating. */
    normal: Point;
}

/**
 * Anchor used to aim an `auto` port before the other end is known: the other
 * endpoint's node centre, or its literal point.
 */
function endpointAnchor(end: Endpoint, lookup: NodeLookup): Point {
    if (end.nodeId) {
        const node = lookup(end.nodeId);
        if (node) return nodeCenter(node);
    }
    return end.point ?? { x: 0, y: 0 };
}

function resolveEnd(
    end: Endpoint,
    toward: Point,
    lookup: NodeLookup,
    /** `toward` is a bend someone placed, not the other box (see `autoPort`). */
    atBend = false
): ResolvedEnd {
    const node = end.nodeId ? lookup(end.nodeId) : undefined;
    if (!node) {
        return { point: end.point ?? toward, normal: { x: 0, y: 0 } };
    }
    const port: PortId = end.port ?? "auto";
    if (port === "c") {
        // Centre-anchored: clip to the bounding box so the line stops at the
        // shape edge rather than diving into the middle of it.
        const p = rayRectIntersection(nodeRect(node), toward);
        const dir = subPt(toward, nodeCenter(node));
        const len = Math.hypot(dir.x, dir.y) || 1;
        return { point: p, normal: { x: dir.x / len, y: dir.y / len } };
    }
    const resolved = port === "auto" ? autoPort(node, toward, atBend) : port;
    return { point: portPoint(node, resolved), normal: portNormal(node, resolved) };
}

// ---------------------------------------------------------------------------
// Polyline construction
// ---------------------------------------------------------------------------

function dedupe(points: readonly Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (!last || !samePoint(last, p, 0.01)) out.push({ ...p });
    }
    return out.length >= 2 ? out : [...points.map(p => ({ ...p }))];
}

/** Drop collinear middles so a route has the fewest segments that describe it. */
function simplify(points: readonly Point[]): Point[] {
    if (points.length < 3) return points.map(p => ({ ...p }));
    const out: Point[] = [{ ...points[0]! }];
    for (let i = 1; i < points.length - 1; i++) {
        const a = out[out.length - 1]!;
        const b = points[i]!;
        const c = points[i + 1]!;
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(cross) > 0.01) out.push({ ...b });
    }
    out.push({ ...points[points.length - 1]! });
    return out;
}

function isHorizontal(v: Point): boolean {
    return Math.abs(v.x) >= Math.abs(v.y);
}

/**
 * Orthogonal route between two directed points. Both stubs are honoured, then
 * the gap is bridged with a mid-line on whichever axis the ports imply.
 */
function elbowSegment(
    a: Point,
    aN: Point,
    b: Point,
    bN: Point,
    /** For a bend: the way the route was travelling when it reached `a`. */
    arrival?: Point
): Point[] {
    const hasA = Math.hypot(aN.x, aN.y) > EPSILON;
    const hasB = Math.hypot(bN.x, bN.y) > EPSILON;
    const s = hasA ? addPt(a, scalePt(aN, STUB)) : a;
    const e = hasB ? addPt(b, scalePt(bN, STUB)) : b;

    let horizA = hasA ? isHorizontal(aN) : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    if (!hasA && arrival && Math.hypot(arrival.x, arrival.y) > EPSILON) {
        // Leaving a bend back the way the route came would retrace it — a
        // spike that `simplify` then folds away, so a bend dragged off a
        // straight run kept its handle while the line never moved. Turn the
        // corner instead, so the line visibly goes through the bend.
        const along = isHorizontal(arrival);
        const ahead = along ? (e.x - a.x) * arrival.x : (e.y - a.y) * arrival.y;
        if (ahead < -EPSILON) horizA = !along;
    }
    const horizB = hasB ? isHorizontal(bN) : !horizA;

    const mid: Point[] = [];
    if (horizA && horizB) {
        const mx = (s.x + e.x) / 2;
        mid.push({ x: mx, y: s.y }, { x: mx, y: e.y });
    } else if (!horizA && !horizB) {
        const my = (s.y + e.y) / 2;
        mid.push({ x: s.x, y: my }, { x: e.x, y: my });
    } else if (horizA) {
        mid.push({ x: e.x, y: s.y });
    } else {
        mid.push({ x: s.x, y: e.y });
    }
    return [a, s, ...mid, e, b];
}

/** Direction of the last non-zero step of a polyline. */
function lastHeading(points: readonly Point[]): Point | undefined {
    for (let i = points.length - 1; i > 0; i--) {
        const d = subPt(points[i]!, points[i - 1]!);
        if (Math.hypot(d.x, d.y) > EPSILON) return d;
    }
    return undefined;
}

/** Orthogonal route that threads a user's dragged waypoints in order. */
function elbowThrough(
    a: Point,
    aN: Point,
    waypoints: readonly Point[],
    b: Point,
    bN: Point
): Point[] {
    if (waypoints.length === 0) return elbowSegment(a, aN, b, bN);
    const pts: Point[] = [];
    let prev = a;
    let prevN = aN;
    let arrival: Point | undefined;
    for (const wp of waypoints) {
        const seg = elbowSegment(prev, prevN, wp, { x: 0, y: 0 }, arrival);
        pts.push(...seg.slice(0, -1));
        arrival = lastHeading(seg);
        prev = wp;
        prevN = { x: 0, y: 0 };
    }
    pts.push(...elbowSegment(prev, prevN, b, bN, arrival));
    return pts;
}

/** The shortest the first and last legs of a route may be. */
interface LegNeeds {
    first: number;
    last: number;
}

function arrowLength(kind: ArrowId, strokeWidth: number): number {
    // The longest heads (`arrows.tsx`) run six stroke widths back from the tip.
    return kind === "none" ? 0 : 6 * Math.max(strokeWidth, 1);
}

/**
 * MIN_LEG, or — where there is an arrowhead — room for the head, the rounded
 * corner before it and a little straight line between them, whichever is
 * more. A thick line's head otherwise sat on the corner, squeezed.
 */
function legNeeds(edge: DiagramEdge): LegNeeds {
    const need = (kind: ArrowId) =>
        Math.max(MIN_LEG, arrowLength(kind, edge.style.strokeWidth) + CORNER_RADIUS + 4);
    return { first: need(edge.startArrow), last: need(edge.endArrow) };
}

/**
 * An elbow between two directed ends with no bends: `elbowSegment`, whose Z
 * runs its middle halfway between the ends — moved toward one end only as far
 * as it takes to give the other end's leg its minimum (room for the head).
 */
function plainElbow(a: ResolvedEnd, b: ResolvedEnd, needs: LegNeeds): Point[] {
    const pts = simplify(dedupe(elbowSegment(a.point, a.normal, b.point, b.normal)));
    if (pts.length !== 4) return pts;
    const [p0, p1, p2, p3] = pts as [Point, Point, Point, Point];
    const flat = (p: Point, q: Point, k: "x" | "y") => Math.abs(p[k] - q[k]) < 0.01;
    // Along `k` out of the first end, across, along `k` into the other.
    const k: "x" | "y" | null =
        flat(p0, p1, "y") && flat(p1, p2, "x") && flat(p2, p3, "y")
            ? "x"
            : flat(p0, p1, "x") && flat(p1, p2, "y") && flat(p2, p3, "x")
              ? "y"
              : null;
    if (!k) return pts;
    const first = p1[k] - p0[k];
    const last = p3[k] - p2[k];
    if (first * last <= 0) return pts;
    const lenFirst = Math.abs(first);
    const lenLast = Math.abs(last);
    let shift = 0;
    if (lenLast < needs.last && lenFirst > needs.first) {
        shift = Math.min(needs.last - lenLast, lenFirst - needs.first);
    } else if (lenFirst < needs.first && lenLast > needs.last) {
        shift = -Math.min(needs.first - lenFirst, lenLast - needs.last);
    }
    if (Math.abs(shift) < 0.01) return pts;
    const at = p1[k] - Math.sign(first) * shift;
    return [p0, { ...p1, [k]: at }, { ...p2, [k]: at }, p3];
}

/**
 * A connector whose ends land on the same node: a rounded tab off the node's
 * chosen side, so it stays visible instead of collapsing to a dot.
 */
function selfLoop(node: DiagramNode, port: PortId | undefined): Point[] {
    const resolved = port && port !== "auto" && port !== "c" ? port : "n";
    const p = portPoint(node, resolved);
    const nrm = portNormal(node, resolved);
    const out = Math.max(Math.min(node.w, node.h) * 0.5, 34);
    const side = { x: -nrm.y, y: nrm.x };
    const tip = addPt(p, scalePt(nrm, out));
    const a = addPt(tip, scalePt(side, -out * 0.7));
    const b = addPt(tip, scalePt(side, out * 0.7));
    const entry = addPt(p, scalePt(side, out * 0.55));
    return [p, a, b, entry];
}

// ---------------------------------------------------------------------------
// Path rendering
// ---------------------------------------------------------------------------

function fmt(v: number): string {
    return String(Math.round(v * 100) / 100);
}

export function polylinePath(points: readonly Point[]): string {
    if (points.length === 0) return "";
    const [first, ...rest] = points;
    return `M ${fmt(first!.x)} ${fmt(first!.y)} ${rest
        .map(p => `L ${fmt(p.x)} ${fmt(p.y)}`)
        .join(" ")}`;
}

/**
 * The radius each corner of a polyline is drawn with: `radius`, or less where
 * a leg is too short for it. A leg between two corners lends each of them
 * half its length; the first and last legs have one corner only and lend it
 * all of theirs. So a corner never overshoots into the next one, and the two
 * corners of a short middle run stay alike.
 */
export function cornerRadii(points: readonly Point[], radius = CORNER_RADIUS): number[] {
    const out: number[] = [];
    const last = points.length - 1;
    for (let i = 1; i < last; i++) {
        const inLen = distance(points[i - 1]!, points[i]!);
        const outLen = distance(points[i]!, points[i + 1]!);
        const inShare = i - 1 === 0 ? 1 : 0.5;
        const outShare = i + 1 === last ? 1 : 0.5;
        out.push(Math.max(0, Math.min(radius, inLen * inShare, outLen * outShare)));
    }
    return out;
}

/**
 * Polyline with quadratic corner fillets — the elbow connector look.
 * `radii` (from `cornerRadii` on the full route) draws a shortened copy of a
 * route — pulled back from its arrowheads — with the corners of the original,
 * so the line and its selection halo stay one shape.
 */
export function roundedPolylinePath(
    points: readonly Point[],
    radius = CORNER_RADIUS,
    radii?: readonly number[]
): string {
    if (points.length < 3) return polylinePath(points);
    const fit = cornerRadii(points, radius);
    const parts: string[] = [`M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`];
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]!;
        const cur = points[i]!;
        const next = points[i + 1]!;
        const inLen = distance(prev, cur);
        const outLen = distance(cur, next);
        const want = radii?.[i - 1];
        // Never more than this route's own legs allow, whatever was asked for.
        const r = want === undefined ? fit[i - 1]! : Math.min(want, fit[i - 1]!);
        if (r < 0.5) {
            parts.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
            continue;
        }
        const t1 = 1 - r / (inLen || 1);
        const enter = { x: lerp(prev.x, cur.x, t1), y: lerp(prev.y, cur.y, t1) };
        const t2 = r / (outLen || 1);
        const exit = { x: lerp(cur.x, next.x, t2), y: lerp(cur.y, next.y, t2) };
        parts.push(`L ${fmt(enter.x)} ${fmt(enter.y)}`);
        parts.push(`Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(exit.x)} ${fmt(exit.y)}`);
    }
    const last = points[points.length - 1]!;
    parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
    return parts.join(" ");
}

/** Catmull-Rom → cubic Bézier, for the `curved` connector kind. */
export function smoothPath(points: readonly Point[], tension = 0.5): string {
    if (points.length < 3) return polylinePath(points);
    const parts: string[] = [`M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] ?? points[i]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[i + 2] ?? p2;
        const c1 = {
            x: p1.x + ((p2.x - p0.x) / 6) * tension * 2,
            y: p1.y + ((p2.y - p0.y) / 6) * tension * 2,
        };
        const c2 = {
            x: p2.x - ((p3.x - p1.x) / 6) * tension * 2,
            y: p2.y - ((p3.y - p1.y) / 6) * tension * 2,
        };
        parts.push(
            `C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`
        );
    }
    return parts.join(" ");
}

/** Render a polyline in the style implied by `kind`. */
export function renderPath(kind: DiagramEdge["kind"], points: readonly Point[]): string {
    if (kind === "elbow") return roundedPolylinePath(points);
    if (kind === "curved") return smoothPath(points);
    return polylinePath(points);
}

/**
 * Pull both ends of a polyline inwards along their adjacent segments, so a
 * solid arrowhead does not have the line poking through its tip. Segments
 * shorter than the trim are consumed entirely.
 */
export function trimPolyline(
    points: readonly Point[],
    startTrim: number,
    endTrim: number
): Point[] {
    if (points.length < 2 || (startTrim <= 0 && endTrim <= 0)) return points.map(p => ({ ...p }));
    let work = points.map(p => ({ ...p }));

    const trimFront = (pts: Point[], amount: number): Point[] => {
        let remaining = amount;
        while (remaining > 0 && pts.length >= 2) {
            const a = pts[0]!;
            const b = pts[1]!;
            const seg = distance(a, b);
            if (seg <= EPSILON) {
                pts.shift();
                continue;
            }
            if (seg > remaining) {
                const t = remaining / seg;
                pts[0] = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
                return pts;
            }
            remaining -= seg;
            pts.shift();
        }
        return pts;
    };

    if (startTrim > 0) work = trimFront(work, startTrim);
    if (endTrim > 0) work = trimFront(work.reverse(), endTrim).reverse();
    return work.length >= 2 ? work : points.map(p => ({ ...p }));
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

const SIDES = ["n", "e", "s", "w"] as const;
type Side = (typeof SIDES)[number];

function sideOf(normal: Point): Side {
    if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x >= 0 ? "e" : "w";
    return normal.y >= 0 ? "s" : "n";
}

const isAuto = (end: Endpoint) => end.port === undefined || end.port === "auto";

/**
 * Sides of a shape that are straight along the whole bounding box, so an end
 * can sit anywhere on them and still be on the outline. Elsewhere (a
 * diamond's vertex, a circle) ends stay on the shape's own ports.
 */
const ALL_FOUR: readonly Side[] = ["n", "e", "s", "w"];
const FLAT: Readonly<Record<string, readonly Side[]>> = {
    rectangle: ALL_FOUR,
    "rounded-rectangle": ALL_FOUR,
    process: ALL_FOUR,
    "predefined-process": ALL_FOUR,
    "internal-storage": ALL_FOUR,
    "mind-root": ALL_FOUR,
    "mind-branch": ALL_FOUR,
    sticky: ALL_FOUR,
    text: ALL_FOUR,
    image: ALL_FOUR,
    "uml-class": ALL_FOUR,
    "uml-note": ALL_FOUR,
    "uml-package": ALL_FOUR,
    "uml-component": ALL_FOUR,
    "erd-entity": ALL_FOUR,
    frame: ALL_FOUR,
    group: ALL_FOUR,
    "swimlane-h": ALL_FOUR,
    "swimlane-v": ALL_FOUR,
    terminator: ["n", "s"],
    cylinder: ["e", "w"],
    database: ["e", "w"],
    "direct-data": ["n", "s"],
    "stored-data": ["n", "s"],
    display: ["n", "s"],
    delay: ["n", "s", "w"],
    document: ["n", "e", "w"],
};

function flatSide(node: DiagramNode, side: Side): boolean {
    return node.rotation % 360 === 0 && (FLAT[node.shape]?.includes(side) ?? false);
}

// ---------------------------------------------------------------------------
// Lined-up boxes
// ---------------------------------------------------------------------------

/** Overlap needed (px) before two boxes count as lined up. */
const MIN_ALIGN_OVERLAP = 12;
/** Boxes joined straight stay so down to this much overlap (see `chooseEnds`). */
const KEEP_ALIGN_OVERLAP = 4;

/**
 * Ends for an elbow connector between two boxes that are lined up — one above
 * the other with their widths overlapping, or side by side with their heights
 * overlapping: both ends on the shared span, so the line is straight. Ports
 * sit at the middle of each side, and boxes are never placed to the pixel, so
 * two steps a few pixels apart got a tiny zig-zag between them.
 */
function alignedEnds(
    from: DiagramNode,
    to: DiagramNode,
    minOverlap = MIN_ALIGN_OVERLAP
): { from: ResolvedEnd; to: ResolvedEnd } | null {
    const a = nodeRect(from);
    const b = nodeRect(to);
    const ca = nodeCenter(from);
    const cb = nodeCenter(to);

    const xLo = Math.max(a.x, b.x);
    const xHi = Math.min(a.x + a.w, b.x + b.w);
    const yLo = Math.max(a.y, b.y);
    const yHi = Math.min(a.y + a.h, b.y + b.h);
    const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

    const below = b.y >= a.y + a.h;
    const above = a.y >= b.y + b.h;
    const right = b.x >= a.x + a.w;
    const left = a.x >= b.x + b.w;
    // Keep the line off the boxes' rounded corners — less so for a narrow
    // overlap that is being held straight.
    const inset = Math.min(4, minOverlap / 3);
    /**
     * The shared coordinate for a straight line across `sideA` of `from` and
     * `sideB` of `to`: the middle of the overlap when both sides are flat;
     * the tip of a shape that is not (a diamond's vertex) when it falls on
     * the other's flat side; otherwise there is no straight line to draw.
     */
    const shared = (sideA: Side, sideB: Side, lo: number, hi: number, vertical: boolean) => {
        const flatA = flatSide(from, sideA);
        const flatB = flatSide(to, sideB);
        const coord = (p: Point) => (vertical ? p.x : p.y);
        if (flatA && flatB) {
            if (hi - lo < minOverlap) return null;
            return clampTo((coord(ca) + coord(cb)) / 2, lo + inset, hi - inset);
        }
        if (flatA !== flatB) {
            const tip = coord(flatA ? portPoint(to, sideB) : portPoint(from, sideA));
            const flat = flatA ? a : b;
            const start = vertical ? flat.x : flat.y;
            const length = vertical ? flat.w : flat.h;
            return tip >= start + 6 && tip <= start + length - 6 ? tip : null;
        }
        return null;
    };
    if (below || above) {
        const sideA: Side = below ? "s" : "n";
        const sideB: Side = below ? "n" : "s";
        const x = shared(sideA, sideB, xLo, xHi, true);
        if (x !== null) {
            const down = below ? 1 : -1;
            return {
                from: { point: { x, y: below ? a.y + a.h : a.y }, normal: { x: 0, y: down } },
                to: { point: { x, y: below ? b.y : b.y + b.h }, normal: { x: 0, y: -down } },
            };
        }
    }
    if (right || left) {
        const sideA: Side = right ? "e" : "w";
        const sideB: Side = right ? "w" : "e";
        const y = shared(sideA, sideB, yLo, yHi, false);
        if (y !== null) {
            const along = right ? 1 : -1;
            return {
                from: { point: { x: right ? a.x + a.w : a.x, y }, normal: { x: along, y: 0 } },
                to: { point: { x: right ? b.x : b.x + b.w, y }, normal: { x: -along, y: 0 } },
            };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Choosing sides
// ---------------------------------------------------------------------------

/** What each thing a route does is worth, in px of length. */
const SIDE_COST = {
    /**
     * One more corner — more than an L spends reaching the middle of the far
     * box's side, so a clean L beats a Z of about the same length.
     */
    bend: 100,
    /** Per px a leg falls short of its minimum (`MIN_LEG`, or room for the head). */
    stub: 25,
    /** Per px an end leg of a bent route falls short of `COMFORT_LEG`. */
    comfort: 8,
    /** Per px the route runs behind a side it leaves or arrives by: a U-turn. */
    uTurn: 40,
    /** Leaving by a side turned away from the other box (× 1 − cos); arriving, half that. */
    facing: 60,
    /** Side to side when mostly beside, end to end when mostly above or below. */
    axis: 120,
    /**
     * On a flowchart, a target downstream joined end to end — out of the
     * bottom, into the top on a chart that runs down — from a flat side (a
     * diamond's Yes and No keep its side tips).
     */
    flowPair: 170,
    /** On a flowchart, a target downstream entered from upstream (its top). */
    flowEntry: 40,
    /** Leaving the dot an end was pinned to. */
    unpin: 300,
} as const;

/** A route keeps the sides it used until another pair is better by this much. */
const SIDE_HYSTERESIS = 28;
/** A remembered choice only steers a route whose boxes moved less than this since. */
const SIDE_MEMORY_REACH = 200;

/** Where the ends of an elbow with no bends go, as `chooseEnds` decided. */
interface SideChoice {
    a: ResolvedEnd;
    b: ResolvedEnd;
    fromSide: Side;
    toSide: Side;
    /** Ends placed automatically — spread along their side. A pin dropped counts. */
    autoFrom: boolean;
    autoTo: boolean;
    /** Lined-up boxes: both ends on their shared span, a straight line. */
    lined: boolean;
}

/** One place an end may go. */
interface EndOption {
    side: Side;
    end: ResolvedEnd;
    /** The dot the end was pinned to. */
    pinned: boolean;
    /** What choosing it costs (leaving a pin). */
    penalty: number;
}

function endOptions(node: DiagramNode, end: Endpoint): EndOption[] {
    const port = end.port ?? "auto";
    const pinned = port !== "auto";
    const sides: EndOption[] = SIDES.map(side => ({
        side,
        end: { point: portPoint(node, side), normal: portNormal(node, side) },
        pinned: false,
        penalty: pinned ? SIDE_COST.unpin : 0,
    }));
    if (!pinned || port === "c") return sides;
    const normal = portNormal(node, port);
    return [
        { side: sideOf(normal), end: { point: portPoint(node, port), normal }, pinned, penalty: 0 },
        ...sides,
    ];
}

/** How far any point of `pts` lies behind the side `end` sits on. */
function behind(pts: readonly Point[], end: ResolvedEnd): number {
    let worst = 0;
    for (const p of pts) {
        const d = -((p.x - end.point.x) * end.normal.x + (p.y - end.point.y) * end.normal.y);
        if (d > worst) worst = d;
    }
    return worst;
}

/** 0 at `from`, 1 at `to`, linear between (either way round). */
function ramp(v: number, from: number, to: number): number {
    return Math.min(Math.max((v - from) / (to - from), 0), 1);
}

interface PairContext {
    from: DiagramNode;
    to: DiagramNode;
    /** Unit vector from `from`'s centre toward `to`'s. */
    dir: Point;
    /** Angle of `dir` from the horizontal, 0–90°. */
    angle: number;
    flow: FlowDirection | null;
    needs: LegNeeds;
}

/**
 * What a route between these two ends costs: its length, a price per corner,
 * steep prices for a leg too short to read or a run back behind a side it
 * leaves or enters by (a U-turn), and a little for a side turned away from
 * the other box. Pairs that read the way the boxes sit are cheaper: side to
 * side when mostly beside, end to end when mostly above or below, and on a
 * flowchart downstream out of the bottom and into the top. Continuous in the
 * boxes' positions, so `SIDE_HYSTERESIS` holds a choice still.
 */
function pairCost(pts: readonly Point[], a: ResolvedEnd, b: ResolvedEnd, ctx: PairContext): number {
    const legs: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) legs.push(distance(pts[i]!, pts[i + 1]!));
    let cost = legs.reduce((sum, l) => sum + l, 0) + SIDE_COST.bend * (legs.length - 1);
    const { needs } = ctx;
    if (legs.length === 1) {
        cost += SIDE_COST.stub * Math.max(0, Math.max(needs.first, needs.last) - legs[0]!);
    } else {
        const first = legs[0]!;
        const last = legs[legs.length - 1]!;
        let short = Math.max(0, needs.first - first) + Math.max(0, needs.last - last);
        for (let i = 1; i < legs.length - 1; i++) short += Math.max(0, MIN_LEG - legs[i]!);
        cost += SIDE_COST.stub * short;
        cost +=
            SIDE_COST.comfort *
            (Math.max(0, COMFORT_LEG - first) + Math.max(0, COMFORT_LEG - last));
    }
    cost += SIDE_COST.uTurn * (behind(pts, a) + behind(pts, b));

    const { dir } = ctx;
    const out = a.normal.x * dir.x + a.normal.y * dir.y;
    const back = -(b.normal.x * dir.x + b.normal.y * dir.y);
    cost += SIDE_COST.facing * (1 - out + 0.5 * (1 - back));

    const sa = sideOf(a.normal);
    const sb = sideOf(b.normal);
    const facingPair = out > 0.5 && back > 0.5 && a.normal.x === -b.normal.x;
    if (facingPair && (sa === "e" || sa === "w")) cost -= SIDE_COST.axis * ramp(ctx.angle, 35, 20);
    if (facingPair && (sa === "n" || sa === "s")) cost -= SIDE_COST.axis * ramp(ctx.angle, 55, 70);

    if (ctx.flow) {
        const ra = nodeRect(ctx.from);
        const rb = nodeRect(ctx.to);
        const down = ctx.flow === "down";
        // How far downstream the target sits: past the source by a comfortable leg is fully.
        const gap = down ? rb.y - (ra.y + ra.h) : rb.x - (ra.x + ra.w);
        const r = ramp(gap, 0, COMFORT_LEG);
        if (r > 0) {
            const exit: Side = down ? "s" : "e";
            const entry: Side = down ? "n" : "w";
            if (sb === entry) cost -= SIDE_COST.flowEntry * r;
            if (sb === entry && sa === exit && flatSide(ctx.from, exit)) {
                cost -= SIDE_COST.flowPair * r;
            }
        }
    }
    return cost;
}

interface SideMemo {
    fromId: string;
    toId: string;
    key: string;
    /** `to`'s centre relative to `from`'s when this was chosen. */
    rel: Point;
}

/**
 * The sides each connector used last, by id: the "current sides" a route
 * keeps while it is dragged until another pair is clearly better. Bounded —
 * it only matters for connectors on screen.
 */
const sideMemory = new Map<string, SideMemo>();
const SIDE_MEMORY_MAX = 5000;

interface ChoiceMemo {
    from: DiagramNode;
    to: DiagramNode;
    flow: FlowDirection | null;
    choice: SideChoice;
}

let choiceCache = new WeakMap<DiagramEdge, ChoiceMemo>();

/** Forget every remembered side choice (tests start from a clean slate). */
export function forgetRouteSides(): void {
    sideMemory.clear();
    choiceCache = new WeakMap();
    staleCache = new WeakMap();
}

/**
 * Sides for an elbow with no bends between two boxes, or null where the old
 * rules stand (curves and straight lines aim by angle; bends, free ends,
 * rotated boxes and centre-anchored ends keep their own).
 *
 * - Lined-up boxes get a straight line on their shared span.
 * - Otherwise every pair of sides is drawn and priced (`pairCost`) and the
 *   cheapest wins: one bend (an L) when both legs are comfortably long, else
 *   a Z with its middle run halfway; never a stub or a squeezed arrowhead
 *   where another pair avoids it.
 * - A pinned end keeps its dot unless every route from it is far worse — a
 *   U-turn once its box has moved round behind it.
 * - The pair used last time is kept until another is better by
 *   `SIDE_HYSTERESIS`, so dragging a box across a diagonal does not flicker.
 */
function chooseEnds(
    edge: DiagramEdge,
    lookup: NodeLookup,
    options: RouteOptions
): SideChoice | null {
    if (edge.kind !== "elbow" || edge.waypoints.length > 0) return null;
    const fromId = edge.from.nodeId;
    const toId = edge.to.nodeId;
    if (!fromId || !toId || fromId === toId) return null;
    if (edge.from.port === "c" || edge.to.port === "c") return null;
    const from = lookup(fromId);
    const to = lookup(toId);
    if (!from || !to || from.rotation % 360 !== 0 || to.rotation % 360 !== 0) return null;
    const flow = options.flow ?? null;
    const memo = choiceCache.get(edge);
    if (memo && memo.from === from && memo.to === to && memo.flow === flow) return memo.choice;
    const choice = pickSides(edge, from, to, flow);
    choiceCache.set(edge, { from, to, flow, choice });
    return choice;
}

function pickSides(
    edge: DiagramEdge,
    from: DiagramNode,
    to: DiagramNode,
    flow: FlowDirection | null
): SideChoice {
    const ca = nodeCenter(from);
    const cb = nodeCenter(to);
    const rel = subPt(cb, ca);
    const remembered = sideMemory.get(edge.id);
    const prev =
        remembered &&
        remembered.fromId === from.id &&
        remembered.toId === to.id &&
        Math.hypot(rel.x - remembered.rel.x, rel.y - remembered.rel.y) <= SIDE_MEMORY_REACH
            ? remembered.key
            : null;

    const len = Math.hypot(rel.x, rel.y) || 1;
    const ctx: PairContext = {
        from,
        to,
        dir: { x: rel.x / len, y: rel.y / len },
        angle: (Math.atan2(Math.abs(rel.y), Math.abs(rel.x)) * 180) / Math.PI,
        flow,
        needs: legNeeds(edge),
    };

    interface Candidate {
        key: string;
        cost: number;
        choice: SideChoice;
    }
    const candidates: Candidate[] = [];
    for (const fo of endOptions(from, edge.from)) {
        for (const tp of endOptions(to, edge.to)) {
            const pts = plainElbow(fo.end, tp.end, ctx.needs);
            candidates.push({
                key: `${fo.pinned ? "pin-" : ""}${fo.side}>${tp.pinned ? "pin-" : ""}${tp.side}`,
                cost: fo.penalty + tp.penalty + pairCost(pts, fo.end, tp.end, ctx),
                choice: {
                    a: fo.end,
                    b: tp.end,
                    fromSide: fo.side,
                    toSide: tp.side,
                    autoFrom: !fo.pinned,
                    autoTo: !tp.pinned,
                    lined: false,
                },
            });
        }
    }
    // Lined up: straight across the shared span — held while the overlap
    // shrinks to KEEP_ALIGN_OVERLAP once the line is straight.
    const lined = alignedEnds(from, to, prev === "lined" ? KEEP_ALIGN_OVERLAP : MIN_ALIGN_OVERLAP);
    if (lined) {
        const fromSide = sideOf(lined.from.normal);
        const toSide = sideOf(lined.to.normal);
        // A pin on the side the straight line uses is as good as kept.
        const pin = (end: Endpoint, side: Side) =>
            isAuto(end) || end.port === side ? 0 : SIDE_COST.unpin;
        candidates.push({
            key: "lined",
            cost:
                pin(edge.from, fromSide) +
                pin(edge.to, toSide) +
                pairCost([lined.from.point, lined.to.point], lined.from, lined.to, ctx),
            choice: {
                a: lined.from,
                b: lined.to,
                fromSide,
                toSide,
                autoFrom: true,
                autoTo: true,
                lined: true,
            },
        });
    }

    let best = candidates[0]!;
    for (const c of candidates) if (c.cost < best.cost - 1e-6) best = c;
    if (prev && prev !== best.key) {
        const kept = candidates.find(c => c.key === prev);
        if (kept && kept.cost <= best.cost + SIDE_HYSTERESIS) best = kept;
    }
    if (sideMemory.size >= SIDE_MEMORY_MAX) sideMemory.clear();
    sideMemory.set(edge.id, { fromId: from.id, toId: to.id, key: best.key, rel });
    return best.choice;
}

// ---------------------------------------------------------------------------
// Stale bends
// ---------------------------------------------------------------------------

interface StaleMemo {
    from: DiagramNode | undefined;
    to: DiagramNode | undefined;
    edge: DiagramEdge;
}

let staleCache = new WeakMap<DiagramEdge, StaleMemo>();

function insideRect(p: Point, r: Rect): boolean {
    return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/**
 * Whether a connector's bends no longer make a clean path: one sits on (or
 * in) one of its own boxes, or the line through them runs through either
 * box. A bend placed to steer a line round something stops meaning anything
 * once a box is moved over or past it, and drawing through it doubled the
 * line back through the box.
 */
function bendsGoneStale(edge: DiagramEdge, lookup: NodeLookup): boolean {
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    const ends = [from, to].filter((nd): nd is DiagramNode => nd !== undefined);
    if (ends.length === 0 || (from && to && from.id === to.id)) return false;
    if (ends.some(nd => nd.rotation % 360 !== 0)) return false;
    const boxes = ends.map(nodeBounds);
    if (edge.waypoints.some(p => boxes.some(r => insideRect(p, grow(r, 2))))) return true;
    const { a, b } = bentEnds(edge, lookup);
    return polylineCrosses(
        linePoints(edge, a, b),
        boxes.map(r => grow(r, -1))
    );
}

/**
 * The connector as it is routed: itself, or — when its bends have gone stale
 * (`bendsGoneStale`) — a copy without them, so it is routed automatically
 * again. The copy is the same object while its boxes stay put.
 */
function effectiveEdge(edge: DiagramEdge, lookup: NodeLookup): DiagramEdge {
    if (edge.waypoints.length === 0) return edge;
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    const hit = staleCache.get(edge);
    if (hit && hit.from === from && hit.to === to) return hit.edge;
    const out = bendsGoneStale(edge, lookup) ? { ...edge, waypoints: [] } : edge;
    staleCache.set(edge, { from, to, edge: out });
    return out;
}

/** Whether this connector's bends no longer make a clean path, so it is drawn without them. */
export function hasStaleBends(edge: DiagramEdge, lookup: NodeLookup): boolean {
    return effectiveEdge(edge, lookup) !== edge;
}

/**
 * `page` with the bends taken out of connectors on the moved boxes whose
 * bends no longer make a clean path (`hasStaleBends`) — the route already
 * ignores them, and this keeps their handles from floating off the line.
 * Connectors whose two ends moved together carried their bends along, so
 * theirs stay clean. Returns `page` itself when nothing changed.
 */
export function dropStaleBends(page: DiagramPage, movedIds: readonly string[]): DiagramPage {
    if (movedIds.length === 0) return page;
    const moved = new Set(movedIds);
    const byId = new Map(page.nodes.map(nd => [nd.id, nd]));
    const lookup: NodeLookup = id => byId.get(id);
    let changed = false;
    const edges = page.edges.map(e => {
        if (e.waypoints.length === 0 || e.locked) return e;
        const touches =
            (e.from.nodeId !== undefined && moved.has(e.from.nodeId)) ||
            (e.to.nodeId !== undefined && moved.has(e.to.nodeId));
        if (!touches || !hasStaleBends(e, lookup)) return e;
        changed = true;
        return { ...e, waypoints: [] };
    });
    return changed ? { ...page, edges } : page;
}

// ---------------------------------------------------------------------------
// Sharing a side
// ---------------------------------------------------------------------------

/** The bend or box an automatic end of `edge` aims at. */
function towardOf(edge: DiagramEdge, which: "from" | "to", lookup: NodeLookup): Point {
    if (edge.waypoints.length > 0) {
        return which === "from" ? edge.waypoints[0]! : edge.waypoints[edge.waypoints.length - 1]!;
    }
    return endpointAnchor(which === "from" ? edge.to : edge.from, lookup);
}

/**
 * The side of `nodeId` an automatic connector leaves or arrives on — the same
 * answer `routeEdge` reaches (`chooseEnds`, else facing the other end) — or
 * null for an end pinned to a dot, a self-loop, or a rotated box. `edge` is
 * the connector as routed (`effectiveEdge`).
 */
function autoSideAt(
    edge: DiagramEdge,
    which: "from" | "to",
    lookup: NodeLookup,
    options: RouteOptions
): Side | null {
    const end = edge[which];
    if (!end.nodeId || edge.from.nodeId === edge.to.nodeId) return null;
    const node = lookup(end.nodeId);
    if (!node || node.rotation % 360 !== 0) return null;
    const chosen = chooseEnds(edge, lookup, options);
    if (chosen) {
        if (which === "from") return chosen.autoFrom ? chosen.fromSide : null;
        return chosen.autoTo ? chosen.toSide : null;
    }
    if (!isAuto(end)) return null;
    return autoPort(node, towardOf(edge, which, lookup), edge.waypoints.length > 0) as Side;
}

/**
 * Where along its side (0 → 1, top/left first) this connector's end sits, and
 * how many automatic connectors share that side.
 */
export function sideSlotInfo(
    edgeIn: DiagramEdge,
    which: "from" | "to",
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles?: readonly DiagramNode[],
    options: RouteOptions = NO_OPTIONS
): { slot: number; count: number } {
    const edge = effectiveEdge(edgeIn, lookup);
    const nodeId = edge[which].nodeId;
    const node = nodeId ? lookup(nodeId) : undefined;
    const side = autoSideAt(edge, which, lookup, options);
    if (!nodeId || !node || !side || !flatSide(node, side)) return { slot: 0.5, count: 1 };
    // Ordered by the direction each line leaves in — its angle from the
    // side's outward normal, along the side's own axis — so lines fanning out
    // to the same side never cross: the one that turns toward the bottom
    // soonest takes the bottom slot. (Ordering by where the far ends sit put
    // a near target's line on the outside of a far one's, and they crossed.)
    const centre = nodeCenter(node);
    const normal = portNormal(node, side);
    const along = side === "e" || side === "w" ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const sharing: { id: string; key: number }[] = [];
    for (const raw of incidentEdges(edges, nodeId)) {
        const other = raw.id === edge.id ? edge : effectiveEdge(raw, lookup);
        const at: ("from" | "to")[] = [];
        if (other.from.nodeId === nodeId) at.push("from");
        if (other.to.nodeId === nodeId) at.push("to");
        // A neighbour that goes around a box leaves by another side.
        if (other.id !== edge.id && detours(other, lookup, obstacles, options)) continue;
        for (const w of at) {
            if (autoSideAt(other, w, lookup, options) !== side) continue;
            const toward = towardOf(other, w, lookup);
            const d = { x: toward.x - centre.x, y: toward.y - centre.y };
            const key = Math.atan2(d.x * along.x + d.y * along.y, d.x * normal.x + d.y * normal.y);
            sharing.push({ id: `${other.id}:${w}`, key });
        }
    }
    if (sharing.length < 2) return { slot: 0.5, count: sharing.length };
    // Ties (two lines to the same box) by id, so the order is stable.
    sharing.sort((p, q) => p.key - q.key || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    const i = sharing.findIndex(x => x.id === `${edge.id}:${which}`);
    return {
        slot: i < 0 ? 0.5 : (i + 1) / (sharing.length + 1),
        count: sharing.length,
    };
}

/** `sideSlotInfo`'s position alone. */
export function sideSlot(
    edge: DiagramEdge,
    which: "from" | "to",
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles?: readonly DiagramNode[],
    options: RouteOptions = NO_OPTIONS
): number {
    return sideSlotInfo(edge, which, lookup, edges, obstacles, options).slot;
}

/** Keeps a spread end clear of a side's rounded corners. */
const CORNER_CLEAR = 12;

/**
 * `spreadOnSide` for a straight connector between two lined-up boxes: both
 * ends take the slot of the busier side — the side with more lines to keep
 * apart — so the line stays straight and lands where that side reserved
 * room for it (each side counting its own neighbours put the two ends a few
 * pixels apart; taking the bigger offset instead landed it on a neighbour).
 */
function spreadStraight(
    edge: DiagramEdge,
    a: ResolvedEnd,
    b: ResolvedEnd,
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles: readonly DiagramNode[] | undefined,
    options: RouteOptions
): [ResolvedEnd, ResolvedEnd] {
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    if (!from || !to) return [a, b];
    // A line on a diamond's tip stays on the tip.
    if (!flatSide(from, sideOf(a.normal)) || !flatSide(to, sideOf(b.normal))) return [a, b];
    const vertical = Math.abs(a.normal.y) > Math.abs(a.normal.x);
    const ra = nodeRect(from);
    const rb = nodeRect(to);
    const infoA = sideSlotInfo(edge, "from", lookup, edges, obstacles, options);
    const infoB = sideSlotInfo(edge, "to", lookup, edges, obstacles, options);
    if (infoA.count < 2 && infoB.count < 2) return [a, b];
    const useA = infoA.count >= infoB.count;
    const r = useA ? ra : rb;
    const slot = useA ? infoA.slot : infoB.slot;
    const want = vertical ? r.x + r.w * slot : r.y + r.h * slot;
    const lo = vertical ? Math.max(ra.x, rb.x) + CORNER_CLEAR : Math.max(ra.y, rb.y) + CORNER_CLEAR;
    const hi = vertical
        ? Math.min(ra.x + ra.w, rb.x + rb.w) - CORNER_CLEAR
        : Math.min(ra.y + ra.h, rb.y + rb.h) - CORNER_CLEAR;
    const at = lo <= hi ? Math.min(Math.max(want, lo), hi) : vertical ? a.point.x : a.point.y;
    const move = (end: ResolvedEnd): ResolvedEnd => ({
        ...end,
        point: vertical ? { x: at, y: end.point.y } : { x: end.point.x, y: at },
    });
    return [move(a), move(b)];
}

/**
 * Spread connectors that share a side of a box along it, the way draw.io
 * distributes them. Every automatic connector used to attach at the middle of
 * its side, so a loop arriving where the next arrow leaves, or two arrows
 * between the same two boxes, ran on top of each other.
 */
function spreadOnSide(
    edge: DiagramEdge,
    which: "from" | "to",
    end: ResolvedEnd,
    auto: boolean,
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles: readonly DiagramNode[] | undefined,
    options: RouteOptions
): ResolvedEnd {
    const nodeId = edge[which].nodeId;
    const node = nodeId ? lookup(nodeId) : undefined;
    if (!node || !auto || Math.hypot(end.normal.x, end.normal.y) < EPSILON) {
        return end;
    }
    const slot = sideSlot(edge, which, lookup, edges, obstacles, options);
    if (slot === 0.5) return end;
    const r = nodeRect(node);
    const clampTo = (v: number, lo: number, hi: number) =>
        lo <= hi ? Math.min(Math.max(v, lo), hi) : (lo + hi) / 2;
    if (Math.abs(end.normal.x) >= Math.abs(end.normal.y)) {
        const y = clampTo(r.y + r.h * slot, r.y + CORNER_CLEAR, r.y + r.h - CORNER_CLEAR);
        return { ...end, point: { x: end.point.x, y } };
    }
    const x = clampTo(r.x + r.w * slot, r.x + CORNER_CLEAR, r.x + r.w - CORNER_CLEAR);
    return { ...end, point: { x, y: end.point.y } };
}

// ---------------------------------------------------------------------------
// Going around boxes
// ---------------------------------------------------------------------------

/** How far past its two boxes a detour may wander looking for a way round. */
const AVOID_REACH = 160;

/**
 * Can a connector be asked to go around this shape? Containers hold their
 * lines (a line inside a lane crosses the lane by design), free text and ink
 * are marks rather than boxes, and hidden shapes are not there.
 */
function isObstacle(nd: DiagramNode): boolean {
    if (nd.hidden || isContainer(nd.shape)) return false;
    return nd.shape !== "text" && nd.shape !== "ink";
}

function grow(r: Rect, by: number): Rect {
    return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The area a detour between these two boxes searches. */
function avoidWindow(from: DiagramNode, to: DiagramNode): Rect {
    const a = nodeBounds(from);
    const b = nodeBounds(to);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return grow(
        { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y },
        AVOID_REACH
    );
}

/**
 * The shapes a connector between `from` and `to` might have to go around:
 * obstacles inside its search window, other than its own two ends. A route
 * is a pure function of the edge, its two ends and exactly these, which is
 * what `routeEdgeCached` keys on.
 */
export function nearbyObstacles(
    from: DiagramNode,
    to: DiagramNode,
    obstacles: readonly DiagramNode[]
): DiagramNode[] {
    const window = avoidWindow(from, to);
    return obstacles.filter(
        nd =>
            nd.id !== from.id &&
            nd.id !== to.id &&
            isObstacle(nd) &&
            overlaps(nodeBounds(nd), window)
    );
}

/** A side other than the one facing the other end. */
const OFF_SIDE = 24;
/**
 * A side another connector already uses. Dearer than going round the far
 * side: a line back to an earlier step otherwise leaves and arrives through
 * the gaps the forward arrows sit in, and runs on top of them.
 */
const BUSY_SIDE = 80;

/** The side of `node` connector `other` (as routed) leaves or arrives by. */
function sideUsedAt(
    other: DiagramEdge,
    node: DiagramNode,
    lookup: NodeLookup,
    options: RouteOptions
): Side {
    const which = other.from.nodeId === node.id ? "from" : "to";
    const chosen = chooseEnds(other, lookup, options);
    if (chosen) return which === "from" ? chosen.fromSide : chosen.toSide;
    const port = other[which].port ?? "auto";
    if (port !== "auto" && port !== "c") return sideOf(portNormal(node, port));
    return autoPort(node, towardOf(other, which, lookup), other.waypoints.length > 0) as Side;
}

/**
 * The sides of `node` its other connectors use — `edge` aside — read the way
 * the router reads them (`sideUsedAt`).
 */
function busySides(
    node: DiagramNode,
    edge: DiagramEdge,
    incident: readonly DiagramEdge[],
    lookup: NodeLookup,
    options: RouteOptions
): Map<Side, number> {
    const out = new Map<Side, number>();
    for (const raw of incident) {
        if (raw.id === edge.id || raw.from.nodeId === raw.to.nodeId) continue;
        const side = sideUsedAt(effectiveEdge(raw, lookup), node, lookup, options);
        out.set(side, (out.get(side) ?? 0) + 1);
    }
    return out;
}

function portOptions(
    node: DiagramNode,
    end: Endpoint,
    /** Placed automatically (a pin that was dropped counts). */
    auto: boolean,
    /** The side the plain route uses, which a detour prefers. */
    preferred: Side,
    toward: Point,
    busy: ReadonlyMap<Side, number>
): PortOption[] {
    const port = end.port ?? "auto";
    if (!auto && port !== "auto" && port !== "c") {
        return [{ point: portPoint(node, port), normal: portNormal(node, port), penalty: 0 }];
    }
    // Any side will do; the plain route's is preferred, so a detour only
    // changes sides when that is the way round — and a side another
    // connector already uses is avoided where there is a free one.
    return SIDES.map(side => {
        const taken = busy.get(side) ?? 0;
        let point = portPoint(node, side);
        // On a busy flat side, land beside the lines already there rather
        // than on top of the one in the middle — on the end nearer where this
        // line comes from, so it does not cross them on the way in.
        if (taken > 0 && flatSide(node, side)) {
            const r = nodeRect(node);
            const c = nodeCenter(node);
            const upright = side === "e" || side === "w";
            const low = upright ? toward.y < c.y : toward.x < c.x;
            const f = low ? 1 / (taken + 2) : (taken + 1) / (taken + 2);
            point = upright ? { x: point.x, y: r.y + r.h * f } : { x: r.x + r.w * f, y: point.y };
        }
        return {
            point,
            normal: portNormal(node, side),
            penalty: (side === preferred ? 0 : OFF_SIDE) + (taken > 0 ? BUSY_SIDE : 0),
        };
    });
}

/** Connectors by the node ids they touch, built once per edge list. */
const incidenceCache = new WeakMap<readonly DiagramEdge[], Map<string, DiagramEdge[]>>();

function incidentEdges(edges: readonly DiagramEdge[], nodeId: string): readonly DiagramEdge[] {
    let index = incidenceCache.get(edges);
    if (!index) {
        index = new Map();
        for (const e of edges) {
            for (const id of new Set([e.from.nodeId, e.to.nodeId])) {
                if (!id) continue;
                const list = index.get(id) ?? [];
                list.push(e);
                index.set(id, list);
            }
        }
        incidenceCache.set(edges, index);
    }
    return index.get(nodeId) ?? NO_EDGES;
}

const NO_EDGES: readonly DiagramEdge[] = [];

/**
 * A route around whatever sits between the connector's ends, or null when
 * the default route is already clear (or no way round exists nearby). Only
 * for connectors nobody has routed by hand: bends someone placed are theirs.
 */
function avoidingRoute(
    edge: DiagramEdge,
    plain: PlainEnds,
    straight: readonly Point[],
    lookup: NodeLookup,
    obstacles: readonly DiagramNode[],
    edges: readonly DiagramEdge[],
    options: RouteOptions
): Point[] | null {
    if (edge.waypoints.length > 0 || !edge.from.nodeId || !edge.to.nodeId) return null;
    const from = lookup(edge.from.nodeId);
    const to = lookup(edge.to.nodeId);
    if (!from || !to || from.id === to.id) return null;
    // Orthogonal search needs axis-aligned sides.
    if (from.rotation % 360 !== 0 || to.rotation % 360 !== 0) return null;

    const near = nearbyObstacles(from, to, obstacles);
    const boxes = near.map(nodeBounds);
    // Touching is fine; only a line through a box counts — another box, or
    // one of its own two (a line pinned to a side facing away from the other
    // end otherwise runs back through the box it leaves).
    const inTheWay = [...boxes, nodeBounds(from), nodeBounds(to)].map(r => grow(r, -1));
    if (!polylineCrosses(straight, inTheWay)) return null;

    const padded = boxes.map(r => grow(r, AVOID_MARGIN));
    const needs = legNeeds(edge);
    const route = orthogonalDetour({
        starts: portOptions(
            from,
            edge.from,
            plain.autoFrom,
            sideOf(plain.a.normal),
            nodeCenter(to),
            busySides(from, edge, incidentEdges(edges, from.id), lookup, options)
        ),
        ends: portOptions(
            to,
            edge.to,
            plain.autoTo,
            sideOf(plain.b.normal),
            nodeCenter(from),
            busySides(to, edge, incidentEdges(edges, to.id), lookup, options)
        ),
        blocked: [
            ...padded,
            grow(nodeBounds(from), AVOID_MARGIN),
            grow(nodeBounds(to), AVOID_MARGIN),
        ],
        bounds: avoidWindow(from, to),
        stub: Math.max(STUB, needs.first),
        endStub: Math.max(STUB, needs.last),
    });
    if (!route) return null;
    const ortho = simplify(dedupe(route));
    if (edge.kind === "elbow") return ortho;
    // Straight and curved lines keep their character: the same way round,
    // without the right angles. Their own boxes count too, so the line does
    // not cut back across the box it leaves.
    return pullTight(ortho, [
        ...boxes.map(r => grow(r, AVOID_MARGIN / 2)),
        grow(nodeBounds(from), -1),
        grow(nodeBounds(to), -1),
    ]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface PlainEnds {
    lined: boolean;
    a: ResolvedEnd;
    b: ResolvedEnd;
    /** Ends placed automatically, so spread along their side. */
    autoFrom: boolean;
    autoTo: boolean;
}

/** Ends aimed at the connector's bends (or the other box), side by angle. */
function bentEnds(edge: DiagramEdge, lookup: NodeLookup): { a: ResolvedEnd; b: ResolvedEnd } {
    const bent = edge.waypoints.length > 0;
    return {
        a: resolveEnd(edge.from, towardOf(edge, "from", lookup), lookup, bent),
        b: resolveEnd(edge.to, towardOf(edge, "to", lookup), lookup, bent),
    };
}

/** A connector's ends before any spreading or detour (`edge` as routed). */
function plainEnds(edge: DiagramEdge, lookup: NodeLookup, options: RouteOptions): PlainEnds {
    const chosen = chooseEnds(edge, lookup, options);
    if (chosen) {
        return {
            lined: chosen.lined,
            a: chosen.a,
            b: chosen.b,
            autoFrom: chosen.autoFrom,
            autoTo: chosen.autoTo,
        };
    }
    const { a, b } = bentEnds(edge, lookup);
    return { lined: false, a, b, autoFrom: isAuto(edge.from), autoTo: isAuto(edge.to) };
}

/** The line a connector draws between two resolved ends, in its own style. */
function linePoints(edge: DiagramEdge, a: ResolvedEnd, b: ResolvedEnd): Point[] {
    const points =
        edge.kind !== "elbow"
            ? dedupe([a.point, ...edge.waypoints, b.point])
            : edge.waypoints.length === 0
              ? plainElbow(a, b, legNeeds(edge))
              : simplify(
                    dedupe(elbowThrough(a.point, a.normal, edge.waypoints, b.point, b.normal))
                );
    return points.length < 2 ? [a.point, b.point] : points;
}

/**
 * Whether this connector's plain route crosses a box, so it will be drawn as
 * a detour (`avoidingRoute`) — and so does not really occupy the side its
 * plain route would use. `edge` is the connector as routed.
 */
function detours(
    edge: DiagramEdge,
    lookup: NodeLookup,
    obstacles: readonly DiagramNode[] | undefined,
    options: RouteOptions
): boolean {
    if (!obstacles || edge.waypoints.length > 0) return false;
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    if (!from || !to || from.id === to.id) return false;
    if (from.rotation % 360 !== 0 || to.rotation % 360 !== 0) return false;
    const { a, b } = plainEnds(edge, lookup, options);
    const inTheWay = [
        ...nearbyObstacles(from, to, obstacles).map(nodeBounds),
        nodeBounds(from),
        nodeBounds(to),
    ].map(r => grow(r, -1));
    return polylineCrosses(linePoints(edge, a, b), inTheWay);
}

/**
 * `obstacles`: the page's shapes, when the connector should go around the
 * ones between its ends (the canvas and everything drawn from it pass them;
 * leaving them out gives the plain route). `edges`: the page's connectors,
 * so a detour can keep off the sides other lines already use. `options`:
 * how the document runs (`RouteOptions`) — every surface drawing the same
 * page passes the same, so they agree.
 */
export function routeEdge(
    edgeIn: DiagramEdge,
    lookup: NodeLookup,
    obstacles?: readonly DiagramNode[],
    edges: readonly DiagramEdge[] = NO_EDGES,
    options: RouteOptions = NO_OPTIONS
): RoutedEdge {
    // Self-loop: both ends on the same node.
    if (edgeIn.from.nodeId && edgeIn.from.nodeId === edgeIn.to.nodeId) {
        const node = lookup(edgeIn.from.nodeId);
        if (node) {
            const pts = selfLoop(node, edgeIn.from.port);
            return {
                points: pts,
                path: smoothPath(pts, 0.8),
                start: pts[0]!,
                end: pts[pts.length - 1]!,
                startNormal: portNormal(node, "n"),
                endNormal: portNormal(node, "n"),
            };
        }
    }

    const edge = effectiveEdge(edgeIn, lookup);
    const plain = plainEnds(edge, lookup, options);
    let { a, b } = plain;
    if (edges.length > 1) {
        if (plain.lined) {
            [a, b] = spreadStraight(edge, a, b, lookup, edges, obstacles, options);
        } else {
            a = spreadOnSide(edge, "from", a, plain.autoFrom, lookup, edges, obstacles, options);
            b = spreadOnSide(edge, "to", b, plain.autoTo, lookup, edges, obstacles, options);
        }
    }

    let points = linePoints(edge, a, b);
    let detoured = false;
    if (obstacles) {
        const around = avoidingRoute(edge, plain, points, lookup, obstacles, edges, options);
        if (around && around.length >= 2) {
            points = around;
            detoured = true;
        }
    }

    // A curved line going round a box gets wide rounded corners rather than a
    // spline through its corners: the spline overshoots, and dipped into the
    // box it was going round (or the one it was arriving at).
    const path =
        detoured && edge.kind === "curved"
            ? roundedPolylinePath(points, CURVED_DETOUR_RADIUS)
            : renderPath(edge.kind, points);

    // Arrowhead orientation. Both normals point *away from their own shape*,
    // matching the port normals they fall back to: an arrowhead is drawn with
    // its tip on the endpoint and its barbs along this vector, so at the start
    // that is forward along the line and at the end it is backward. Taking it
    // from the adjacent segment (rather than the straight line between the two
    // endpoints) keeps the head tangent when the route bends immediately.
    const second = points[1]!;
    const penultimate = points[points.length - 2]!;
    const startDir = subPt(second, points[0]!);
    const endDir = subPt(penultimate, points[points.length - 1]!);

    return {
        points,
        path,
        start: points[0]!,
        end: points[points.length - 1]!,
        startNormal: normalize(startDir, a.normal),
        endNormal: normalize(endDir, b.normal),
        ...(detoured && edge.kind === "curved" ? { cornerRadius: CURVED_DETOUR_RADIUS } : {}),
    };
}

function normalize(v: Point, fallback: Point): Point {
    const len = Math.hypot(v.x, v.y);
    if (len < EPSILON) {
        const flen = Math.hypot(fallback.x, fallback.y);
        return flen < EPSILON ? { x: 1, y: 0 } : { x: fallback.x / flen, y: fallback.y / flen };
    }
    return { x: v.x / len, y: v.y / len };
}

// ---------------------------------------------------------------------------
// Incremental routing
// ---------------------------------------------------------------------------

interface RouteMemo {
    from: DiagramNode | undefined;
    to: DiagramNode | undefined;
    flow: FlowDirection | null;
    /** The obstacles the route was found among (`nearbyObstacles`). */
    near: readonly DiagramNode[];
    /** Which sides of its two boxes other connectors used (`busySides`). */
    busy: string;
    /** Where its ends sit along their sides (`sideSlot`). */
    slots: string;
    routed: RoutedEdge;
}

const NONE: readonly DiagramNode[] = [];

function sameNodes(a: readonly DiagramNode[], b: readonly DiagramNode[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/**
 * Memo for `routeEdgeCached`, keyed on the edge object.
 *
 * A route is a pure function of the edge, the two nodes its ends are
 * attached to, and the shapes near enough to be gone around
 * (`nearbyObstacles`) — plus the sides it used last (`chooseEnds`), which
 * only steer it between near-equal choices. Nothing else on the page can
 * change it. So the memo stores which objects the cached route was computed
 * from, and a hit requires all of them to match.
 */
const routeCache = new WeakMap<DiagramEdge, RouteMemo>();

/**
 * `routeEdge`, recomputed only when this edge's own inputs changed.
 *
 * Dragging one shape on a 200-edge diagram used to re-route all 200 every
 * frame. Now the 198 whose endpoints did not move return their previous
 * `RoutedEdge` — the *same object*, which is what makes `EdgeView`'s `memo`
 * actually hit. Before this, `routed` was a fresh object every frame and the
 * memoisation never did anything.
 */
export function routeEdgeCached(
    edgeIn: DiagramEdge,
    lookup: NodeLookup,
    obstacles?: readonly DiagramNode[],
    edges: readonly DiagramEdge[] = NO_EDGES,
    options: RouteOptions = NO_OPTIONS
): RoutedEdge {
    const from = edgeIn.from.nodeId ? lookup(edgeIn.from.nodeId) : undefined;
    const to = edgeIn.to.nodeId ? lookup(edgeIn.to.nodeId) : undefined;
    const flow = options.flow ?? null;
    const edge = effectiveEdge(edgeIn, lookup);
    // Hand-routed lines never detour, so nothing nearby can change them.
    const near =
        obstacles && from && to && edge.waypoints.length === 0
            ? nearbyObstacles(from, to, obstacles)
            : NONE;

    // Only a detour picks sides, so only then do the neighbours' sides matter.
    const busy =
        near.length > 0 && from && to
            ? [
                  ...busySides(from, edge, incidentEdges(edges, from.id), lookup, options),
                  ["|", 0],
                  ...busySides(to, edge, incidentEdges(edges, to.id), lookup, options),
              ]
                  .map(([side, n]) => `${side}${n}`)
                  .join("")
            : "";

    const slots =
        from && to && edges.length > 1
            ? `${sideSlot(edge, "from", lookup, edges, obstacles, options)}|${sideSlot(edge, "to", lookup, edges, obstacles, options)}`
            : "";

    const hit = routeCache.get(edgeIn);
    if (
        hit &&
        hit.from === from &&
        hit.to === to &&
        hit.flow === flow &&
        hit.busy === busy &&
        hit.slots === slots &&
        sameNodes(hit.near, near)
    ) {
        return hit.routed;
    }

    const routed = routeEdge(edgeIn, lookup, obstacles, edges, options);
    routeCache.set(edgeIn, { from, to, flow, near, busy, slots, routed });
    return routed;
}

/**
 * Where a new bend dropped at `at` belongs in an edge's waypoint list.
 *
 * Both the click and the existing waypoints are projected onto the routed
 * polyline and compared by distance along it — comparing raw coordinates would
 * put a bend in the wrong place the moment a connector doubles back.
 */
export function waypointInsertIndex(
    routed: RoutedEdge,
    waypoints: readonly Point[],
    at: Point
): number {
    const clickT = projectOntoPolyline(routed.points, at).t;
    for (let i = 0; i < waypoints.length; i++) {
        if (projectOntoPolyline(routed.points, waypoints[i]!).t > clickT) return i;
    }
    return waypoints.length;
}

/**
 * Whether bend `index` no longer does anything: the line drawn without it
 * passes within `tolerance` of where it sits. Dragging a bend back into line
 * with its neighbours is how people straighten a connector in Lucid and
 * draw.io, so a bend dropped there is taken out rather than left as an
 * invisible handle that keeps the route from following its boxes.
 */
export function isRedundantBend(
    edge: DiagramEdge,
    index: number,
    lookup: NodeLookup,
    tolerance: number,
    obstacles?: readonly DiagramNode[],
    edges?: readonly DiagramEdge[],
    options: RouteOptions = NO_OPTIONS
): boolean {
    const bend = edge.waypoints[index];
    if (!bend) return false;
    const without = routeEdge(
        { ...edge, waypoints: edge.waypoints.filter((_, i) => i !== index) },
        lookup,
        obstacles,
        edges,
        options
    );
    if (projectOntoPolyline(without.points, bend).distance <= tolerance) return true;
    // A bend the line does not visibly go through changes nothing either.
    const withIt = routeEdge(edge, lookup, obstacles, edges, options);
    return (
        withIt.points.length === without.points.length &&
        withIt.points.every((p, i) => distance(p, without.points[i]!) <= tolerance)
    );
}

/** World position of an edge label, given its `t` and perpendicular offset. */
export function labelAnchor(routed: RoutedEdge, t: number, offset: number): Point {
    const base = pointAlongPolyline(routed.points, t);
    if (!offset) return base;
    const total = routed.points.length;
    const i = Math.min(Math.max(Math.floor(t * (total - 1)), 0), total - 2);
    const a = routed.points[i]!;
    const b = routed.points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: base.x + (-dy / len) * offset, y: base.y + (dx / len) * offset };
}
