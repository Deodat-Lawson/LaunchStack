/**
 * Pure geometry helpers — no DOM, no React. Everything here is exercised by
 * `__tests__/geometry.test.ts`.
 *
 * Coordinate spaces:
 *   world   — the infinite canvas. Node x/y/w/h live here.
 *   screen  — CSS pixels inside the canvas element. `world → screen` is
 *             `(p - viewport) * zoom`.
 *   local   — a rotated node's own frame, origin at its top-left.
 */

import type { DiagramNode, Point, PortId, Rect, Size } from "./types";

export const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
    return (rad * 180) / Math.PI;
}

/** Round to a sane number of decimals so saved JSON stays small and stable. */
export function round(v: number, decimals = 2): number {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}

export function snap(v: number, step: number): number {
    if (step <= 0) return v;
    return Math.round(v / step) * step;
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export function pt(x: number, y: number): Point {
    return { x, y };
}

export function addPt(a: Point, b: Point): Point {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function subPt(a: Point, b: Point): Point {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scalePt(a: Point, k: number): Point {
    return { x: a.x * k, y: a.y * k };
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function samePoint(a: Point, b: Point, tol = EPSILON): boolean {
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Rotate `p` about `origin` by `deg` degrees clockwise (screen axes). */
export function rotatePoint(p: Point, origin: Point, deg: number): Point {
    if (!deg) return { ...p };
    const r = toRad(deg);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return {
        x: origin.x + dx * cos - dy * sin,
        y: origin.y + dx * sin + dy * cos,
    };
}

// ---------------------------------------------------------------------------
// Rects
// ---------------------------------------------------------------------------

export function rect(x: number, y: number, w: number, h: number): Rect {
    return { x, y, w, h };
}

export function rectCenter(r: Rect): Point {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectRight(r: Rect): number {
    return r.x + r.w;
}

export function rectBottom(r: Rect): number {
    return r.y + r.h;
}

export function rectContains(r: Rect, p: Point): boolean {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function normalizeRect(a: Point, b: Point): Rect {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(a.x - b.x),
        h: Math.abs(a.y - b.y),
    };
}

export function expandRect(r: Rect, by: number): Rect {
    return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
    if (rects.length === 0) return null;
    const first = rects[0]!;
    let minX = first.x;
    let minY = first.y;
    let maxX = first.x + first.w;
    let maxY = first.y + first.h;
    for (let i = 1; i < rects.length; i++) {
        const r = rects[i]!;
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.w > maxX) maxX = r.x + r.w;
        if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export function nodeRect(n: DiagramNode): Rect {
    return { x: n.x, y: n.y, w: n.w, h: n.h };
}

export function nodeCenter(n: DiagramNode): Point {
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** The four corners of a node, rotation applied, in world space. */
export function nodeCorners(n: DiagramNode): [Point, Point, Point, Point] {
    const c = nodeCenter(n);
    const corners: Point[] = [
        { x: n.x, y: n.y },
        { x: n.x + n.w, y: n.y },
        { x: n.x + n.w, y: n.y + n.h },
        { x: n.x, y: n.y + n.h },
    ];
    const [a, b, d, e] = corners.map(p => rotatePoint(p, c, n.rotation)) as [
        Point,
        Point,
        Point,
        Point,
    ];
    return [a, b, d, e];
}

/**
 * Axis-aligned bounding box that still contains the node once rotated. Used for
 * marquee selection, `fit to screen`, and group bounds.
 */
export function nodeBounds(n: DiagramNode): Rect {
    if (!n.rotation) return nodeRect(n);
    const corners = nodeCorners(n);
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export function nodesBounds(nodes: readonly DiagramNode[]): Rect | null {
    return unionRects(nodes.map(nodeBounds));
}

/** World point → the node's unrotated local frame (origin at its top-left). */
export function worldToLocal(n: DiagramNode, p: Point): Point {
    const c = nodeCenter(n);
    const un = rotatePoint(p, c, -n.rotation);
    return { x: un.x - n.x, y: un.y - n.y };
}

export function localToWorld(n: DiagramNode, p: Point): Point {
    const c = nodeCenter(n);
    return rotatePoint({ x: n.x + p.x, y: n.y + p.y }, c, n.rotation);
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Unit-space (0–1) anchor for each named port. */
export const PORT_PRESETS: Record<Exclude<PortId, "auto">, Point> = {
    n: { x: 0.5, y: 0 },
    e: { x: 1, y: 0.5 },
    s: { x: 0.5, y: 1 },
    w: { x: 0, y: 0.5 },
    ne: { x: 1, y: 0 },
    nw: { x: 0, y: 0 },
    se: { x: 1, y: 1 },
    sw: { x: 0, y: 1 },
    c: { x: 0.5, y: 0.5 },
};

export const CARDINAL_PORTS: readonly Exclude<PortId, "auto">[] = ["n", "e", "s", "w"];
export const ALL_PORTS: readonly Exclude<PortId, "auto">[] = [
    "n",
    "e",
    "s",
    "w",
    "ne",
    "se",
    "sw",
    "nw",
];

/** World position of a named port on a node, rotation applied. */
export function portPoint(n: DiagramNode, port: Exclude<PortId, "auto">): Point {
    const u = PORT_PRESETS[port];
    return localToWorld(n, { x: u.x * n.w, y: u.y * n.h });
}

/** Outward normal of a port, in world space, as a unit vector. */
export function portNormal(n: DiagramNode, port: Exclude<PortId, "auto">): Point {
    const base: Record<Exclude<PortId, "auto">, Point> = {
        n: { x: 0, y: -1 },
        s: { x: 0, y: 1 },
        e: { x: 1, y: 0 },
        w: { x: -1, y: 0 },
        ne: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
        nw: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
        se: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
        sw: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
        c: { x: 0, y: 0 },
    };
    const v = base[port];
    return rotatePoint(v, { x: 0, y: 0 }, n.rotation);
}

/**
 * Pick the cardinal port that best faces `target`. Compares the direction to
 * the target against each side's outward normal, so a rotated node still
 * chooses the visually-correct side.
 */
export function autoPort(n: DiagramNode, target: Point): Exclude<PortId, "auto"> {
    const c = nodeCenter(n);
    const dir = subPt(target, c);
    const len = Math.hypot(dir.x, dir.y);
    if (len < EPSILON) return "e";
    const unit = { x: dir.x / len, y: dir.y / len };
    let best: Exclude<PortId, "auto"> = "e";
    let bestDot = -Infinity;
    for (const port of CARDINAL_PORTS) {
        const nrm = portNormal(n, port);
        const dot = nrm.x * unit.x + nrm.y * unit.y;
        if (dot > bestDot) {
            bestDot = dot;
            best = port;
        }
    }
    return best;
}

/** Resolve `auto` against a target point; named ports pass through. */
export function resolvePort(
    n: DiagramNode,
    port: PortId | undefined,
    target: Point
): Exclude<PortId, "auto"> {
    if (!port || port === "auto") return autoPort(n, target);
    return port;
}

// ---------------------------------------------------------------------------
// Segments & hit testing
// ---------------------------------------------------------------------------

/** Shortest distance from `p` to segment `a→b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < EPSILON) return distance(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = clamp(t, 0, 1);
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Shortest distance from `p` to a polyline. `Infinity` for <2 points. */
export function distanceToPolyline(p: Point, points: readonly Point[]): number {
    if (points.length < 2) return points.length === 1 ? distance(p, points[0]!) : Infinity;
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        const d = distanceToSegment(p, points[i]!, points[i + 1]!);
        if (d < best) best = d;
    }
    return best;
}

/** Total length of a polyline. */
export function polylineLength(points: readonly Point[]): number {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += distance(points[i]!, points[i + 1]!);
    return total;
}

/** Point at normalized distance `t` (0–1) along a polyline. */
export function pointAlongPolyline(points: readonly Point[], t: number): Point {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { ...points[0]! };
    const total = polylineLength(points);
    if (total < EPSILON) return { ...points[0]! };
    const target = clamp(t, 0, 1) * total;
    let travelled = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const seg = distance(a, b);
        if (travelled + seg >= target) {
            const local = seg < EPSILON ? 0 : (target - travelled) / seg;
            return { x: lerp(a.x, b.x, local), y: lerp(a.y, b.y, local) };
        }
        travelled += seg;
    }
    return { ...points[points.length - 1]! };
}

/**
 * Closest point on a polyline to `p`, as a normalized distance along it plus
 * the gap. Used to work out where in a connector's waypoint list a new bend
 * belongs.
 */
export function projectOntoPolyline(
    points: readonly Point[],
    p: Point
): { t: number; distance: number; point: Point } {
    if (points.length === 0) return { t: 0, distance: Infinity, point: { x: 0, y: 0 } };
    if (points.length === 1) {
        return { t: 0, distance: distance(p, points[0]!), point: { ...points[0]! } };
    }
    const total = polylineLength(points);
    let travelled = 0;
    let best = { t: 0, distance: Infinity, point: { ...points[0]! } };

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const seg = Math.sqrt(lenSq);
        const local =
            lenSq < EPSILON ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
        const foot = { x: a.x + local * dx, y: a.y + local * dy };
        const gap = distance(p, foot);
        if (gap < best.distance) {
            best = {
                distance: gap,
                point: foot,
                t: total < EPSILON ? 0 : (travelled + local * seg) / total,
            };
        }
        travelled += seg;
    }
    return best;
}

/** Unit tangent at normalized distance `t` along a polyline. */
export function tangentAlongPolyline(points: readonly Point[], t: number): Point {
    if (points.length < 2) return { x: 1, y: 0 };
    const total = polylineLength(points);
    const target = clamp(t, 0, 1) * total;
    let travelled = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const seg = distance(a, b);
        if (travelled + seg >= target || i === points.length - 2) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: dx / len, y: dy / len };
        }
        travelled += seg;
    }
    return { x: 1, y: 0 };
}

/**
 * Intersection of the segment `from → center-of-rect` with the rect border.
 * Used to stop a connector at the shape edge rather than its centre.
 */
export function rayRectIntersection(r: Rect, from: Point): Point {
    const c = rectCenter(r);
    const dx = from.x - c.x;
    const dy = from.y - c.y;
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return c;
    const halfW = r.w / 2;
    const halfH = r.h / 2;
    const scaleX = Math.abs(dx) < EPSILON ? Infinity : halfW / Math.abs(dx);
    const scaleY = Math.abs(dy) < EPSILON ? Infinity : halfH / Math.abs(dy);
    const k = Math.min(scaleX, scaleY);
    return { x: c.x + dx * k, y: c.y + dy * k };
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        const straddles = a.y > p.y !== b.y > p.y;
        if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// ---------------------------------------------------------------------------
// Viewport transforms
// ---------------------------------------------------------------------------

export interface ViewportLike {
    x: number;
    y: number;
    zoom: number;
}

export function worldToScreen(v: ViewportLike, p: Point): Point {
    return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom };
}

export function screenToWorld(v: ViewportLike, p: Point): Point {
    return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y };
}

/** Viewport that fits `bounds` inside `size` with `pad` screen px of margin. */
export function fitViewport(
    bounds: Rect,
    size: Size,
    pad = 64,
    maxZoom = 2
): { x: number; y: number; zoom: number } {
    const availW = Math.max(size.w - pad * 2, 1);
    const availH = Math.max(size.h - pad * 2, 1);
    const zoom = clamp(
        Math.min(availW / Math.max(bounds.w, 1), availH / Math.max(bounds.h, 1)),
        0.05,
        maxZoom
    );
    const c = rectCenter(bounds);
    return {
        x: c.x - size.w / 2 / zoom,
        y: c.y - size.h / 2 / zoom,
        zoom,
    };
}

/** Zoom about a fixed screen point (cursor-anchored wheel zoom). */
export function zoomAt(
    v: ViewportLike,
    nextZoom: number,
    screenAnchor: Point
): { x: number; y: number; zoom: number } {
    const world = screenToWorld(v, screenAnchor);
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    return {
        x: world.x - screenAnchor.x / zoom,
        y: world.y - screenAnchor.y / zoom,
        zoom,
    };
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS: readonly number[] = [
    0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8,
];

export function nextZoomStep(current: number, dir: 1 | -1): number {
    if (dir === 1) {
        for (const z of ZOOM_STEPS) if (z > current + 1e-4) return z;
        return MAX_ZOOM;
    }
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
        const z = ZOOM_STEPS[i]!;
        if (z < current - 1e-4) return z;
    }
    return MIN_ZOOM;
}
