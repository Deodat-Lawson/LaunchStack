/**
 * Snapping while dragging or resizing: grid quantisation, edge/centre
 * alignment against other shapes, and equal-spacing detection.
 *
 * `computeSnap` is pure — it takes the rect the user is dragging plus the
 * rects it could snap to, and returns the correction to apply along with the
 * guides to draw. The canvas never decides on its own where a shape lands.
 */

import { snap } from "./geometry";
import type { Rect } from "./types";

/** Snap radius in *screen* px; callers divide by zoom before passing it in. */
export const SNAP_THRESHOLD = 6;

export type GuideAxis = "v" | "h";
export type GuideKind = "align" | "spacing" | "size";

export interface SnapGuide {
    axis: GuideAxis;
    /** World coordinate of the line (x for `v`, y for `h`). */
    pos: number;
    /** Extent of the line along the other axis, for drawing. */
    from: number;
    to: number;
    kind: GuideKind;
    /** Rendered next to spacing guides, e.g. "24". */
    label?: string;
    /** Spacing guides draw a bracket between these two coordinates. */
    span?: { from: number; to: number };
}

export interface SnapInput {
    /** Rect being dragged, already offset by the raw pointer delta. */
    moving: Rect;
    /** Candidate rects to snap against (exclude the moving selection). */
    others: readonly Rect[];
    gridSize: number;
    snapToGrid: boolean;
    snapToObjects: boolean;
    /** Threshold in world units (screen threshold ÷ zoom). */
    threshold: number;
}

export interface SnapResult {
    dx: number;
    dy: number;
    guides: SnapGuide[];
}

interface Candidate {
    delta: number;
    /** Coordinate the guide line is drawn at. */
    line: number;
    /** Other rect involved, for computing the guide's extent. */
    other: Rect;
}

function edgesX(r: Rect): number[] {
    return [r.x, r.x + r.w / 2, r.x + r.w];
}

function edgesY(r: Rect): number[] {
    return [r.y, r.y + r.h / 2, r.y + r.h];
}

function bestCandidate(list: Candidate[]): Candidate | null {
    let best: Candidate | null = null;
    for (const c of list) {
        if (!best || Math.abs(c.delta) < Math.abs(best.delta)) best = c;
    }
    return best;
}

/**
 * Equal-gap detection: if the moving rect sits between two others such that the
 * two gaps match, nudge it so they match exactly and report the measurement.
 */
function spacingCandidates(
    moving: Rect,
    others: readonly Rect[],
    threshold: number,
    axis: GuideAxis
): Candidate[] {
    const out: Candidate[] = [];
    const start = (r: Rect) => (axis === "v" ? r.x : r.y);
    const end = (r: Rect) => (axis === "v" ? r.x + r.w : r.y + r.h);
    const crossStart = (r: Rect) => (axis === "v" ? r.y : r.x);
    const crossEnd = (r: Rect) => (axis === "v" ? r.y + r.h : r.x + r.w);

    // Only consider rects that overlap on the other axis — otherwise "equal
    // spacing" is a coincidence the user never perceived.
    const band = others.filter(
        o => crossEnd(o) > crossStart(moving) - 40 && crossStart(o) < crossEnd(moving) + 40
    );

    const before = band.filter(o => end(o) <= start(moving) + threshold);
    const after = band.filter(o => start(o) >= end(moving) - threshold);
    if (before.length === 0 || after.length === 0) return out;

    const nearestBefore = before.reduce((a, b) => (end(b) > end(a) ? b : a));
    const nearestAfter = after.reduce((a, b) => (start(b) < start(a) ? b : a));

    const gapBefore = start(moving) - end(nearestBefore);
    const gapAfter = start(nearestAfter) - end(moving);
    const diff = gapAfter - gapBefore;
    if (Math.abs(diff) <= threshold * 2) {
        out.push({ delta: diff / 2, line: start(moving) + diff / 2, other: nearestBefore });
    }
    return out;
}

export function computeSnap(input: SnapInput): SnapResult {
    const { moving, others, gridSize, snapToGrid, snapToObjects, threshold } = input;
    const guides: SnapGuide[] = [];
    let dx = 0;
    let dy = 0;

    if (snapToObjects && others.length > 0) {
        const xCandidates: Candidate[] = [];
        const yCandidates: Candidate[] = [];
        const mx = edgesX(moving);
        const my = edgesY(moving);

        for (const other of others) {
            for (const ox of edgesX(other)) {
                for (const m of mx) {
                    const delta = ox - m;
                    if (Math.abs(delta) <= threshold) {
                        xCandidates.push({ delta, line: ox, other });
                    }
                }
            }
            for (const oy of edgesY(other)) {
                for (const m of my) {
                    const delta = oy - m;
                    if (Math.abs(delta) <= threshold) {
                        yCandidates.push({ delta, line: oy, other });
                    }
                }
            }
        }

        const bx = bestCandidate(xCandidates);
        if (bx) {
            dx = bx.delta;
            const snapped = { ...moving, x: moving.x + dx };
            guides.push({
                axis: "v",
                pos: bx.line,
                from: Math.min(snapped.y, bx.other.y) - 16,
                to: Math.max(snapped.y + snapped.h, bx.other.y + bx.other.h) + 16,
                kind: "align",
            });
        }
        const by = bestCandidate(yCandidates);
        if (by) {
            dy = by.delta;
            const snapped = { ...moving, y: moving.y + dy };
            guides.push({
                axis: "h",
                pos: by.line,
                from: Math.min(snapped.x, by.other.x) - 16,
                to: Math.max(snapped.x + snapped.w, by.other.x + by.other.w) + 16,
                kind: "align",
            });
        }

        // Equal spacing only fills in on an axis alignment did not claim, so
        // the two never fight over the same coordinate.
        if (!bx) {
            const sx = bestCandidate(spacingCandidates(moving, others, threshold, "v"));
            if (sx) {
                dx = sx.delta;
                guides.push({
                    axis: "v",
                    pos: moving.x + dx,
                    from: moving.y - 12,
                    to: moving.y + moving.h + 12,
                    kind: "spacing",
                });
            }
        }
        if (!by) {
            const sy = bestCandidate(spacingCandidates(moving, others, threshold, "h"));
            if (sy) {
                dy = sy.delta;
                guides.push({
                    axis: "h",
                    pos: moving.y + dy,
                    from: moving.x - 12,
                    to: moving.x + moving.w + 12,
                    kind: "spacing",
                });
            }
        }
    }

    // The grid is the fallback: object snapping wins where it fired, because
    // aligning to a neighbour is almost always what the user was aiming at.
    if (snapToGrid && gridSize > 0) {
        if (dx === 0) dx = snap(moving.x, gridSize) - moving.x;
        if (dy === 0) dy = snap(moving.y, gridSize) - moving.y;
    }

    return { dx, dy, guides };
}

/**
 * Snap for resize: quantises the dragged edge rather than the whole rect, and
 * reports a `size` guide when the result matches a neighbour's dimension.
 */
export function snapResize(
    value: number,
    gridSize: number,
    enabled: boolean,
    candidates: readonly number[] = [],
    threshold = 6
): number {
    let best = value;
    let bestDist = Infinity;
    for (const c of candidates) {
        const d = Math.abs(c - value);
        if (d <= threshold && d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    if (bestDist < Infinity) return best;
    return enabled && gridSize > 0 ? snap(value, gridSize) : value;
}
