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
    addPt,
    autoPort,
    distance,
    EPSILON,
    lerp,
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
import type { DiagramEdge, DiagramNode, Endpoint, Point, PortId } from "./types";

/** How far a connector runs straight out of a port before it may turn. */
export const STUB = 18;
/** Corner rounding on elbow connectors, in world px. */
export const CORNER_RADIUS = 8;

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

function resolveEnd(end: Endpoint, toward: Point, lookup: NodeLookup): ResolvedEnd {
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
    const resolved = port === "auto" ? autoPort(node, toward) : port;
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
function elbowSegment(a: Point, aN: Point, b: Point, bN: Point): Point[] {
    const hasA = Math.hypot(aN.x, aN.y) > EPSILON;
    const hasB = Math.hypot(bN.x, bN.y) > EPSILON;
    const s = hasA ? addPt(a, scalePt(aN, STUB)) : a;
    const e = hasB ? addPt(b, scalePt(bN, STUB)) : b;

    const horizA = hasA ? isHorizontal(aN) : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
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
    for (const wp of waypoints) {
        const seg = elbowSegment(prev, prevN, wp, { x: 0, y: 0 });
        pts.push(...seg.slice(0, -1));
        prev = wp;
        prevN = { x: 0, y: 0 };
    }
    pts.push(...elbowSegment(prev, prevN, b, bN));
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function routeEdge(edge: DiagramEdge, lookup: NodeLookup): RoutedEdge {
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

    const firstWaypoint = edge.waypoints[0];
    const lastWaypoint = edge.waypoints[edge.waypoints.length - 1];
    const towardFrom = firstWaypoint ?? endpointAnchor(edge.to, lookup);
    const towardTo = lastWaypoint ?? endpointAnchor(edge.from, lookup);

    const a = resolveEnd(edge.from, towardFrom, lookup);
    const b = resolveEnd(edge.to, towardTo, lookup);

    let points: Point[];
    if (edge.kind === "elbow") {
        points = simplify(
            dedupe(elbowThrough(a.point, a.normal, edge.waypoints, b.point, b.normal))
        );
    } else {
        points = dedupe([a.point, ...edge.waypoints, b.point]);
    }
    if (points.length < 2) points = [a.point, b.point];

    const path = renderPath(edge.kind, points);

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
    routed: RoutedEdge;
}

/**
 * Memo for `routeEdgeCached`, keyed on the edge object.
 *
 * A route is a pure function of three things: the edge, and the two nodes its
 * ends are attached to. Nothing else on the page can change it. So the memo
 * stores which node objects the cached route was computed from, and a hit
 * requires all three identities to match.
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
export function routeEdgeCached(edge: DiagramEdge, lookup: NodeLookup): RoutedEdge {
    const from = edge.from.nodeId ? lookup(edge.from.nodeId) : undefined;
    const to = edge.to.nodeId ? lookup(edge.to.nodeId) : undefined;

    const hit = routeCache.get(edge);
    if (hit && hit.from === from && hit.to === to) return hit.routed;

    const routed = routeEdge(edge, lookup);
    routeCache.set(edge, { from, to, routed });
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
