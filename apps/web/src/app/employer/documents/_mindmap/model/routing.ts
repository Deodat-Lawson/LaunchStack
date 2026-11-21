/**
 * Connector routing: turns an `DiagramEdge` plus the current node positions
 * into the polyline the canvas draws, the arrowheads point along, and hit
 * testing measures against.
 *
 * The polyline is always authoritative — `path` is a rendering of it (rounded
 * corners for elbows, a Catmull-Rom spline for curves), so labels, midpoint
 * handles and hit tests never disagree with what the user sees.
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
import type { DiagramEdge, DiagramNode, Endpoint, Point, PortId, Rect } from "./types";

/** How far a connector runs straight out of a port before it may turn. */
export const STUB = 18;
/** Corner rounding on elbow connectors, in world px. */
export const CORNER_RADIUS = 8;
/** Corner rounding on a curved connector's detour round a box. */
const CURVED_DETOUR_RADIUS = 28;

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

/** Polyline with quadratic corner fillets — the elbow connector look. */
export function roundedPolylinePath(points: readonly Point[], radius = CORNER_RADIUS): string {
    if (points.length < 3) return polylinePath(points);
    const parts: string[] = [`M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`];
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]!;
        const cur = points[i]!;
        const next = points[i + 1]!;
        const inLen = distance(prev, cur);
        const outLen = distance(cur, next);
        const r = Math.min(radius, inLen / 2, outLen / 2);
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

/**
 * The side of `nodeId` an automatic connector leaves or arrives on — the same
 * answer `routeEdge` reaches (lined up, else facing the other end), or null
 * for an end pinned to a dot, a self-loop, or a rotated box.
 */
function autoSideAt(edge: DiagramEdge, which: "from" | "to", lookup: NodeLookup): Side | null {
    const end = edge[which];
    if (!end.nodeId || !isAuto(end) || edge.from.nodeId === edge.to.nodeId) return null;
    const node = lookup(end.nodeId);
    if (!node || node.rotation % 360 !== 0) return null;
    const lined = edge.kind === "elbow" ? alignedEnds(edge, lookup) : null;
    if (lined) return sideOf((which === "from" ? lined.from : lined.to).normal);
    const other = which === "from" ? edge.to : edge.from;
    const toward =
        edge.waypoints.length > 0
            ? which === "from"
                ? edge.waypoints[0]!
                : edge.waypoints[edge.waypoints.length - 1]!
            : endpointAnchor(other, lookup);
    return autoPort(node, toward, edge.waypoints.length > 0) as Side;
}

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

/**
 * Where along its side (0 → 1, top/left first) this connector's end sits, and
 * how many automatic connectors share that side.
 */
export function sideSlotInfo(
    edge: DiagramEdge,
    which: "from" | "to",
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles?: readonly DiagramNode[]
): { slot: number; count: number } {
    const nodeId = edge[which].nodeId;
    const node = nodeId ? lookup(nodeId) : undefined;
    const side = autoSideAt(edge, which, lookup);
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
    for (const other of incidentEdges(edges, nodeId)) {
        const at: ("from" | "to")[] = [];
        if (other.from.nodeId === nodeId) at.push("from");
        if (other.to.nodeId === nodeId) at.push("to");
        // A neighbour that goes around a box leaves by another side.
        if (other.id !== edge.id && detours(other, lookup, obstacles)) continue;
        for (const w of at) {
            if (autoSideAt(other, w, lookup) !== side) continue;
            const far = w === "from" ? other.to : other.from;
            const toward =
                other.waypoints.length > 0
                    ? w === "from"
                        ? other.waypoints[0]!
                        : other.waypoints[other.waypoints.length - 1]!
                    : endpointAnchor(far, lookup);
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
    obstacles?: readonly DiagramNode[]
): number {
    return sideSlotInfo(edge, which, lookup, edges, obstacles).slot;
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
    obstacles?: readonly DiagramNode[]
): [ResolvedEnd, ResolvedEnd] {
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    if (!from || !to) return [a, b];
    // A line on a diamond's tip stays on the tip.
    if (!flatSide(from, sideOf(a.normal)) || !flatSide(to, sideOf(b.normal))) return [a, b];
    const vertical = Math.abs(a.normal.y) > Math.abs(a.normal.x);
    const ra = nodeRect(from);
    const rb = nodeRect(to);
    const infoA = sideSlotInfo(edge, "from", lookup, edges, obstacles);
    const infoB = sideSlotInfo(edge, "to", lookup, edges, obstacles);
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
    lookup: NodeLookup,
    edges: readonly DiagramEdge[],
    obstacles?: readonly DiagramNode[]
): ResolvedEnd {
    const nodeId = edge[which].nodeId;
    const node = nodeId ? lookup(nodeId) : undefined;
    if (!node || !isAuto(edge[which]) || Math.hypot(end.normal.x, end.normal.y) < EPSILON) {
        return end;
    }
    const slot = sideSlot(edge, which, lookup, edges, obstacles);
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

/** Overlap needed (px) before two boxes count as lined up. */
const MIN_ALIGN_OVERLAP = 12;

const isAuto = (end: Endpoint) => end.port === undefined || end.port === "auto";

/**
 * Ends for an elbow connector between two boxes that are lined up — one above
 * the other with their widths overlapping, or side by side with their heights
 * overlapping: both ends on the shared span, so the line is straight. Ports
 * sit at the middle of each side, and boxes are never placed to the pixel, so
 * two steps a few pixels apart got a tiny zig-zag between them. Only for
 * connectors attached automatically and not routed by hand.
 */
function alignedEnds(
    edge: DiagramEdge,
    lookup: NodeLookup
): { from: ResolvedEnd; to: ResolvedEnd } | null {
    if (edge.waypoints.length > 0 || !isAuto(edge.from) || !isAuto(edge.to)) return null;
    if (!edge.from.nodeId || !edge.to.nodeId || edge.from.nodeId === edge.to.nodeId) return null;
    const from = lookup(edge.from.nodeId);
    const to = lookup(edge.to.nodeId);
    if (!from || !to || from.rotation % 360 !== 0 || to.rotation % 360 !== 0) return null;
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
            if (hi - lo < MIN_ALIGN_OVERLAP) return null;
            return clampTo((coord(ca) + coord(cb)) / 2, lo + 4, hi - 4);
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

const SIDES = ["n", "e", "s", "w"] as const;
type Side = (typeof SIDES)[number];

/** A side other than the one facing the other end. */
const OFF_SIDE = 24;
/**
 * A side another connector already uses. Dearer than going round the far
 * side: a line back to an earlier step otherwise leaves and arrives through
 * the gaps the forward arrows sit in, and runs on top of them.
 */
const BUSY_SIDE = 80;

function sideOf(normal: Point): Side {
    if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x >= 0 ? "e" : "w";
    return normal.y >= 0 ? "s" : "n";
}

/**
 * The sides of `node` its other connectors use — `edge` aside — read the way
 * the router reads them: a fixed port's side, or the side facing the other
 * end for an automatic one.
 */
function busySides(
    node: DiagramNode,
    edge: DiagramEdge,
    incident: readonly DiagramEdge[],
    lookup: NodeLookup
): Map<Side, number> {
    const out = new Map<Side, number>();
    const add = (side: Side) => out.set(side, (out.get(side) ?? 0) + 1);
    for (const other of incident) {
        if (other.id === edge.id || other.from.nodeId === other.to.nodeId) continue;
        const mine = other.from.nodeId === node.id ? other.from : other.to;
        const theirs = other.from.nodeId === node.id ? other.to : other.from;
        const port = mine.port ?? "auto";
        if (port !== "auto" && port !== "c") {
            add(sideOf(portNormal(node, port)));
            continue;
        }
        const toward =
            other.waypoints.length > 0
                ? other.from.nodeId === node.id
                    ? other.waypoints[0]!
                    : other.waypoints[other.waypoints.length - 1]!
                : endpointAnchor(theirs, lookup);
        add(autoPort(node, toward, other.waypoints.length > 0) as Side);
    }
    return out;
}

function portOptions(
    node: DiagramNode,
    end: Endpoint,
    toward: Point,
    busy: ReadonlyMap<Side, number>
): PortOption[] {
    const port = end.port ?? "auto";
    if (port !== "auto" && port !== "c") {
        return [{ point: portPoint(node, port), normal: portNormal(node, port), penalty: 0 }];
    }
    // Any side will do; the one facing the other end is preferred, so a
    // detour only changes sides when that is the way round — and a side
    // another connector already uses is avoided where there is a free one.
    const facing = autoPort(node, toward);
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
            penalty: (side === facing ? 0 : OFF_SIDE) + (taken > 0 ? BUSY_SIDE : 0),
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
    straight: readonly Point[],
    lookup: NodeLookup,
    obstacles: readonly DiagramNode[],
    edges: readonly DiagramEdge[]
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
    const route = orthogonalDetour({
        starts: portOptions(
            from,
            edge.from,
            nodeCenter(to),
            busySides(from, edge, incidentEdges(edges, from.id), lookup)
        ),
        ends: portOptions(
            to,
            edge.to,
            nodeCenter(from),
            busySides(to, edge, incidentEdges(edges, to.id), lookup)
        ),
        blocked: [
            ...padded,
            grow(nodeBounds(from), AVOID_MARGIN),
            grow(nodeBounds(to), AVOID_MARGIN),
        ],
        bounds: avoidWindow(from, to),
        stub: STUB,
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

/**
 * `obstacles`: the page's shapes, when the connector should go around the
 * ones between its ends (the canvas and everything drawn from it pass them;
 * leaving them out gives the plain route). `edges`: the page's connectors,
 * so a detour can keep off the sides other lines already use.
 */
/** A connector's ends before any spreading or detour: lined up, else facing. */
function plainEnds(
    edge: DiagramEdge,
    lookup: NodeLookup
): { lined: boolean; a: ResolvedEnd; b: ResolvedEnd } {
    const towardFrom = edge.waypoints[0] ?? endpointAnchor(edge.to, lookup);
    const towardTo = edge.waypoints[edge.waypoints.length - 1] ?? endpointAnchor(edge.from, lookup);
    const lined = edge.kind === "elbow" ? alignedEnds(edge, lookup) : null;
    const bent = edge.waypoints.length > 0;
    return {
        lined: lined !== null,
        a: lined?.from ?? resolveEnd(edge.from, towardFrom, lookup, bent),
        b: lined?.to ?? resolveEnd(edge.to, towardTo, lookup, bent),
    };
}

/** The line a connector draws between two resolved ends, in its own style. */
function linePoints(edge: DiagramEdge, a: ResolvedEnd, b: ResolvedEnd): Point[] {
    const points =
        edge.kind === "elbow"
            ? simplify(dedupe(elbowThrough(a.point, a.normal, edge.waypoints, b.point, b.normal)))
            : dedupe([a.point, ...edge.waypoints, b.point]);
    return points.length < 2 ? [a.point, b.point] : points;
}

/**
 * Whether this connector's plain route crosses a box, so it will be drawn as
 * a detour (`avoidingRoute`) — and so does not really occupy the side its
 * plain route would use.
 */
function detours(
    edge: DiagramEdge,
    lookup: NodeLookup,
    obstacles: readonly DiagramNode[] | undefined
): boolean {
    if (!obstacles || edge.waypoints.length > 0) return false;
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    if (!from || !to || from.id === to.id) return false;
    if (from.rotation % 360 !== 0 || to.rotation % 360 !== 0) return false;
    const { a, b } = plainEnds(edge, lookup);
    const inTheWay = [
        ...nearbyObstacles(from, to, obstacles).map(nodeBounds),
        nodeBounds(from),
        nodeBounds(to),
    ].map(r => grow(r, -1));
    return polylineCrosses(linePoints(edge, a, b), inTheWay);
}

export function routeEdge(
    edge: DiagramEdge,
    lookup: NodeLookup,
    obstacles?: readonly DiagramNode[],
    edges: readonly DiagramEdge[] = NO_EDGES
): RoutedEdge {
    // Self-loop: both ends on the same node.
    if (edge.from.nodeId && edge.from.nodeId === edge.to.nodeId) {
        const node = lookup(edge.from.nodeId);
        if (node) {
            const pts = selfLoop(node, edge.from.port);
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

    const plain = plainEnds(edge, lookup);
    const lined = plain.lined;
    let { a, b } = plain;
    if (edges.length > 1) {
        if (lined) {
            [a, b] = spreadStraight(edge, a, b, lookup, edges, obstacles);
        } else {
            a = spreadOnSide(edge, "from", a, lookup, edges, obstacles);
            b = spreadOnSide(edge, "to", b, lookup, edges, obstacles);
        }
    }

    let points = linePoints(edge, a, b);
    let detoured = false;
    if (obstacles) {
        const around = avoidingRoute(edge, points, lookup, obstacles, edges);
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
 * (`nearbyObstacles`). Nothing else on the page can change it. So the memo
 * stores which objects the cached route was computed from, and a hit
 * requires all of them to match.
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
    edge: DiagramEdge,
    lookup: NodeLookup,
    obstacles?: readonly DiagramNode[],
    edges: readonly DiagramEdge[] = NO_EDGES
): RoutedEdge {
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;
    // Hand-routed lines never detour, so nothing nearby can change them.
    const near =
        obstacles && from && to && edge.waypoints.length === 0
            ? nearbyObstacles(from, to, obstacles)
            : NONE;

    // Only a detour picks sides, so only then do the neighbours' sides matter.
    const busy =
        near.length > 0 && from && to
            ? [
                  ...busySides(from, edge, incidentEdges(edges, from.id), lookup),
                  ["|", 0],
                  ...busySides(to, edge, incidentEdges(edges, to.id), lookup),
              ]
                  .map(([side, n]) => `${side}${n}`)
                  .join("")
            : "";

    const slots =
        from && to && edges.length > 1
            ? `${sideSlot(edge, "from", lookup, edges, obstacles)}|${sideSlot(edge, "to", lookup, edges, obstacles)}`
            : "";

    const hit = routeCache.get(edge);
    if (
        hit &&
        hit.from === from &&
        hit.to === to &&
        hit.busy === busy &&
        hit.slots === slots &&
        sameNodes(hit.near, near)
    ) {
        return hit.routed;
    }

    const routed = routeEdge(edge, lookup, obstacles, edges);
    routeCache.set(edge, { from, to, near, busy, slots, routed });
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
    edges?: readonly DiagramEdge[]
): boolean {
    const bend = edge.waypoints[index];
    if (!bend) return false;
    const without = routeEdge(
        { ...edge, waypoints: edge.waypoints.filter((_, i) => i !== index) },
        lookup,
        obstacles,
        edges
    );
    if (projectOntoPolyline(without.points, bend).distance <= tolerance) return true;
    // A bend the line does not visibly go through changes nothing either.
    const withIt = routeEdge(edge, lookup, obstacles, edges);
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
