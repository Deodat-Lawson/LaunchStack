/**
 * Where a picked shape goes, and what it is. Pure: the menu, the ghost on the
 * canvas and the pick itself all ask these, so the preview is exactly what a
 * pick makes.
 */

import { createEdge, createNodeAt } from "../../model/factory";
import { expandRect, nodeBounds, nodeCenter, rectsIntersect } from "../../model/geometry";
import type { ThemeMode } from "../../model/palette";
import { dressBox, edgeOptions } from "../../model/flowchart/look";
import type { FlowLook } from "../../model/flowchart/lookTypes";
import type { DiagramEdge, DiagramNode, Point, ShapeId } from "../../model/types";

/** What the menu offers, in order; the number key is the position + 1. */
export const PICKS = [
    { id: "step", shape: "process" },
    { id: "decision", shape: "decision" },
    { id: "terminal", shape: "terminator" },
    { id: "data", shape: "data" },
    { id: "note", shape: "sticky" },
    { id: "arrow", shape: null },
] as const satisfies readonly { id: string; shape: ShapeId | null }[];

export type Pick = (typeof PICKS)[number];
export type PickId = Pick["id"];

/** The menu after a double-click: there is no arrow to keep on its own. */
export function picksFor(fromBox: boolean): readonly Pick[] {
    return fromBox ? PICKS : PICKS.filter(p => p.shape !== null);
}

/**
 * How close (screen px) a drop has to land to the source's centre line for
 * the new box to sit on it, so the arrow between them comes out straight.
 */
export const ALIGN_SNAP = 24;

/**
 * Snap a drop point onto the source box's horizontal or vertical centre line
 * when it lands within `ALIGN_SNAP` screen pixels of it.
 */
export function alignToSource(source: DiagramNode, at: Point, zoom: number): Point {
    const c = nodeCenter(source);
    const reach = ALIGN_SNAP / Math.max(zoom, 0.01);
    return {
        x: Math.abs(at.x - c.x) <= reach ? c.x : at.x,
        y: Math.abs(at.y - c.y) <= reach ? c.y : at.y,
    };
}

/** The least room left between the source and a box dropped close to it. */
export const MIN_GAP = 32;

/**
 * The centre of a box of `size` dropped at `at`: the drop point itself,
 * unless the box would sit on (or touch) the box its arrow comes from — a
 * drop just outside a box's edge — in which case it slides out along the
 * arrow until there is a clear gap.
 */
export function boxCentre(
    source: DiagramNode | null,
    at: Point,
    size: { w: number; h: number }
): Point {
    if (!source) return at;
    const s = nodeBounds(source);
    const rect = (p: Point) => ({ x: p.x - size.w / 2, y: p.y - size.h / 2, ...size });
    // One pixel short of the gap, so a box exactly a gap away is clear.
    const keepOut = expandRect(s, MIN_GAP - 1);
    const clear = (p: Point) => !rectsIntersect(rect(p), keepOut);
    if (clear(at)) return at;
    const c = nodeCenter(source);
    const dx = at.x - c.x;
    const dy = at.y - c.y;
    // Out along the axis the arrow mostly travels.
    if (Math.abs(dx) >= Math.abs(dy)) {
        const x = dx >= 0 ? s.x + s.w + MIN_GAP + size.w / 2 : s.x - MIN_GAP - size.w / 2;
        return { x, y: at.y };
    }
    const y = dy >= 0 ? s.y + s.h + MIN_GAP + size.h / 2 : s.y - MIN_GAP - size.h / 2;
    return { x: at.x, y };
}

export interface PickPlan {
    /** The new box; null for "Just the arrow". */
    node: DiagramNode | null;
    /** The arrow from the source; null when there is no source. */
    edge: DiagramEdge | null;
}

/**
 * Exactly what picking `pick` makes: the box in the look, centred on the
 * drop point (or slid clear of its source), and the arrow from the source to
 * it — or, for "Just the arrow", an arrow ending at the point.
 */
export function planPick(
    look: FlowLook,
    mode: ThemeMode,
    source: DiagramNode | null,
    at: Point,
    pick: Pick
): PickPlan {
    const arrow = (to: DiagramEdge["to"]): DiagramEdge | null =>
        source
            ? createEdge({
                  from: { nodeId: source.id, port: "auto" },
                  to,
                  ...edgeOptions(look, mode),
              })
            : null;
    if (pick.shape === null) return { node: null, edge: arrow({ point: at }) };
    const size = look.boxLook(pick.shape, mode).size;
    const centre = size ? boxCentre(source, at, size) : at;
    const node = dressBox(look, createNodeAt(pick.shape, centre, { mode }), mode);
    return { node, edge: arrow({ nodeId: node.id, port: "auto" }) };
}

export type Side = "top" | "right" | "bottom" | "left";

/**
 * Where to try the menu, best first. On past the end of the arrow, so it
 * covers neither the arrow nor the box about to appear; failing that beside
 * the new box, across the arrow; back over the arrow only as a last resort.
 * Below a double-click.
 */
const PREFERENCE: Record<Side | "here", readonly Side[]> = {
    right: ["right", "bottom", "top", "left"],
    left: ["left", "bottom", "top", "right"],
    bottom: ["bottom", "right", "left", "top"],
    top: ["top", "right", "left", "bottom"],
    here: ["bottom", "top", "right", "left"],
};

/**
 * The side of the drop point the menu opens on: the first in the arrow's
 * order of preference where a menu of `size`, `reach(side)` px away from the
 * point, stays inside the stage.
 */
export function menuSide(opts: {
    /** Centre of the box the arrow came out of (board), or null. */
    from: Point | null;
    /** The drop point (board). */
    at: Point;
    /** The drop point on the stage, px. */
    point: Point;
    stage: { w: number; h: number };
    size: { w: number; h: number };
    reach: (side: Side) => number;
    pad?: number;
}): Side {
    const { from, at, point, stage, size, reach, pad = 12 } = opts;
    let heading: Side | "here" = "here";
    if (from) {
        const dx = at.x - from.x;
        const dy = at.y - from.y;
        heading =
            Math.abs(dx) >= Math.abs(dy)
                ? dx >= 0
                    ? "right"
                    : "left"
                : dy >= 0
                  ? "bottom"
                  : "top";
    }
    const fits = (side: Side) => {
        const r = reach(side);
        if (side === "right") return point.x + r + size.w <= stage.w - pad;
        if (side === "left") return point.x - r - size.w >= pad;
        if (side === "bottom") return point.y + r + size.h <= stage.h - pad;
        return point.y - r - size.h >= pad;
    };
    const order = PREFERENCE[heading];
    return order.find(fits) ?? order[0]!;
}
