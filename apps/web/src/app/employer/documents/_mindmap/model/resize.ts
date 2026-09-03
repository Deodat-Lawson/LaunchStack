/**
 * Resize maths.
 *
 * Two cases, deliberately different:
 *
 *   single node  — resized in its *own* rotated frame, so dragging the east
 *                  handle of a 30°-rotated box widens it along its own axis
 *                  rather than the screen's, and the opposite corner stays
 *                  pinned where the user can see it.
 *   multi-select — the selection's axis-aligned bounding box is scaled and
 *                  every member is mapped into the new box.
 */

import { localToWorld, rotatePoint, toRad, worldToLocal } from "./geometry";
import { shapeDef } from "./shapes";
import type { DiagramNode, Point, Rect } from "./types";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Unit-space position of each handle on the node box. */
export const HANDLE_ANCHORS: Record<ResizeHandle, Point> = {
    n: { x: 0.5, y: 0 },
    s: { x: 0.5, y: 1 },
    e: { x: 1, y: 0.5 },
    w: { x: 0, y: 0.5 },
    ne: { x: 1, y: 0 },
    nw: { x: 0, y: 0 },
    se: { x: 1, y: 1 },
    sw: { x: 0, y: 1 },
};

/** The handle diagonally opposite `handle` — the point that stays put. */
export function oppositeHandle(handle: ResizeHandle): ResizeHandle {
    const map: Record<ResizeHandle, ResizeHandle> = {
        n: "s",
        s: "n",
        e: "w",
        w: "e",
        ne: "sw",
        sw: "ne",
        nw: "se",
        se: "nw",
    };
    return map[handle];
}

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
};

/** Rotate a cursor name so it still points the right way on a rotated shape. */
export function rotatedCursor(handle: ResizeHandle, rotation: number): string {
    const base: Record<ResizeHandle, number> = {
        e: 0,
        se: 45,
        s: 90,
        sw: 135,
        w: 180,
        nw: 225,
        n: 270,
        ne: 315,
    };
    const angle = (((base[handle] + rotation) % 360) + 360) % 360;
    const bucket = Math.round(angle / 45) % 8;
    return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][bucket % 4] ?? "pointer";
}

export interface ResizeOptions {
    /** Preserve the aspect ratio (Shift, or a shape that demands it). */
    keepAspect: boolean;
    /** Resize about the centre instead of the opposite corner (Alt). */
    fromCentre: boolean;
    /** Quantise the dragged edge. */
    snap?: (value: number) => number;
}

/**
 * New geometry for a single node given a pointer position in world space.
 * Rotation is preserved; the anchor corner keeps its world position.
 */
export function resizeNode(
    node: DiagramNode,
    handle: ResizeHandle,
    pointer: Point,
    options: ResizeOptions
): DiagramNode {
    const min = shapeDef(node.shape).minSize;
    const anchorUnit = HANDLE_ANCHORS[oppositeHandle(handle)];
    const handleUnit = HANDLE_ANCHORS[handle];

    // Everything below happens in the node's unrotated local frame, where the
    // box is axis-aligned and the maths is the ordinary rectangle case.
    const local = worldToLocal(node, pointer);
    const anchorLocal = { x: anchorUnit.x * node.w, y: anchorUnit.y * node.h };
    const centreLocal = { x: node.w / 2, y: node.h / 2 };
    const origin = options.fromCentre ? centreLocal : anchorLocal;

    const movesX = handleUnit.x !== 0.5;
    const movesY = handleUnit.y !== 0.5;
    const factor = options.fromCentre ? 2 : 1;

    let w = movesX ? Math.abs(local.x - origin.x) * factor : node.w;
    let h = movesY ? Math.abs(local.y - origin.y) * factor : node.h;

    if (options.snap) {
        if (movesX) w = Math.max(options.snap(w), min.w);
        if (movesY) h = Math.max(options.snap(h), min.h);
    }

    if (options.keepAspect && node.w > 0 && node.h > 0) {
        const ratio = node.w / node.h;
        if (movesX && movesY) {
            // Corner drag: the larger delta wins so the box tracks the cursor.
            if (w / ratio >= h) h = w / ratio;
            else w = h * ratio;
        } else if (movesX) {
            h = w / ratio;
        } else if (movesY) {
            w = h * ratio;
        }
    }

    w = Math.max(w, min.w);
    h = Math.max(h, min.h);

    // Where the anchor sits in the *new* local frame.
    const anchorLocalNew = { x: anchorUnit.x * w, y: anchorUnit.y * h };
    const anchorWorld = options.fromCentre
        ? localToWorld(node, centreLocal)
        : localToWorld(node, anchorLocal);
    const anchorLocalNewEffective = options.fromCentre ? { x: w / 2, y: h / 2 } : anchorLocalNew;

    // localToWorld(n, p) = centre(n) + R·(p − centre(n)), and the offset from
    // the new centre to the anchor does not depend on the new x/y — so the
    // placement solves in closed form.
    const d = {
        x: anchorLocalNewEffective.x - w / 2,
        y: anchorLocalNewEffective.y - h / 2,
    };
    const rotated = rotatePoint(d, { x: 0, y: 0 }, node.rotation);

    return {
        ...node,
        w,
        h,
        x: anchorWorld.x - w / 2 - rotated.x,
        y: anchorWorld.y - h / 2 - rotated.y,
    };
}

/**
 * New bounding box for a multi-node selection. Members are mapped into it by
 * `scaleNodesToBounds`.
 */
export function resizeBounds(
    start: Rect,
    handle: ResizeHandle,
    pointer: Point,
    options: ResizeOptions
): Rect {
    const anchorUnit = HANDLE_ANCHORS[oppositeHandle(handle)];
    const handleUnit = HANDLE_ANCHORS[handle];
    const anchor = {
        x: start.x + anchorUnit.x * start.w,
        y: start.y + anchorUnit.y * start.h,
    };
    const centre = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
    const origin = options.fromCentre ? centre : anchor;

    const movesX = handleUnit.x !== 0.5;
    const movesY = handleUnit.y !== 0.5;
    const factor = options.fromCentre ? 2 : 1;

    let w = movesX ? Math.abs(pointer.x - origin.x) * factor : start.w;
    let h = movesY ? Math.abs(pointer.y - origin.y) * factor : start.h;

    if (options.snap) {
        if (movesX) w = options.snap(w);
        if (movesY) h = options.snap(h);
    }

    if (options.keepAspect && start.w > 0 && start.h > 0) {
        const ratio = start.w / start.h;
        if (movesX && movesY) {
            if (w / ratio >= h) h = w / ratio;
            else w = h * ratio;
        } else if (movesX) {
            h = w / ratio;
        } else if (movesY) {
            w = h * ratio;
        }
    }

    w = Math.max(w, 8);
    h = Math.max(h, 8);

    if (options.fromCentre) {
        return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
    }
    // Grow away from the anchor, in whichever direction the handle lies.
    const x = anchorUnit.x === 1 ? anchor.x - w : anchorUnit.x === 0 ? anchor.x : centre.x - w / 2;
    const y = anchorUnit.y === 1 ? anchor.y - h : anchorUnit.y === 0 ? anchor.y : centre.y - h / 2;
    return { x, y, w, h };
}

/** Angle in degrees from a centre to a point, with 0 pointing up. */
export function angleFromCentre(centre: Point, p: Point): number {
    return (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI + 90;
}

/** World position of a resize handle on a rotated node. */
export function handlePosition(node: DiagramNode, handle: ResizeHandle): Point {
    const u = HANDLE_ANCHORS[handle];
    return localToWorld(node, { x: u.x * node.w, y: u.y * node.h });
}

/** Where the rotation grip sits: above the shape's top edge, in world space. */
export function rotationGripPosition(node: DiagramNode, distance: number): Point {
    const centre = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
    const above = { x: centre.x, y: node.y - distance };
    return rotatePoint(above, centre, node.rotation);
}

/** Radians helper re-exported so callers need only this module. */
export { toRad };
