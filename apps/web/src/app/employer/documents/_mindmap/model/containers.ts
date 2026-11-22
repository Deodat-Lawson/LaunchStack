/**
 * Groups and frames holding their boxes. Pure; the store applies `fitContainers`
 * at its write boundary, so no command can leave a group or a frame out of step
 * with what it holds.
 *
 * - A **group** (⌘G) is exactly the bounds of its members: it follows them
 *   when one moves, grows or goes, and an empty group goes too.
 * - A **frame** holds its children with room around them: when one is
 *   added, moved or grows past its edge, the frame grows to fit (never
 *   shrinks on its own). Only at a commit — while a box is being dragged
 *   the frame stays put, so a box can be dragged out of it (it leaves the
 *   frame when its centre does, `reparentIntoContainers`).
 *
 * And who is selected by a click: a box in a group is selected as its group
 * (Figma's and PowerPoint's rule) until someone is working inside the group
 * — has one of its boxes selected — when a click picks the box itself.
 */

import { nodeById } from "./doc";
import { nodeBounds, nodesBounds, rectContains, unionRects } from "./geometry";
import { isContainer } from "./shapes";
import type { DiagramNode, DiagramPage, Point, Rect, SelectionRef } from "./types";

/** Room a frame keeps around a child that pushed it out. */
export const FRAME_PAD = 24;

/** Depth of a node in the containment tree (0 at the top). */
function depthOf(byId: Map<string, DiagramNode>, nd: DiagramNode): number {
    let depth = 0;
    let cur = nd.parentId ? byId.get(nd.parentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id) && depth < 64) {
        seen.add(cur.id);
        depth += 1;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return depth;
}

function sameRect(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * `next` with every group fitted to its members (an empty one removed) and,
 * with `frames`, every frame grown to hold the children that changed since
 * `prev` (all of them when there is no `prev`). Returns `next` itself when
 * nothing needed fitting.
 */
export function fitContainers(
    prev: DiagramPage | null,
    next: DiagramPage,
    opts: { frames: boolean }
): DiagramPage {
    const hasGroup = next.nodes.some(nd => nd.shape === "group");
    const hasFrame = opts.frames && next.nodes.some(nd => nd.shape === "frame");
    if (!hasGroup && !hasFrame) return next;

    const byId = new Map(next.nodes.map(nd => [nd.id, nd]));
    const kids = new Map<string, DiagramNode[]>();
    for (const nd of next.nodes) {
        if (!nd.parentId) continue;
        const list = kids.get(nd.parentId);
        if (list) list.push(nd);
        else kids.set(nd.parentId, [nd]);
    }

    // Frames that hold something that changed, and every frame above them.
    const grow = new Set<string>();
    if (hasFrame) {
        const before = new Set(prev?.nodes ?? []);
        for (const nd of next.nodes) {
            if (before.has(nd)) continue;
            let cur = nd.parentId ? byId.get(nd.parentId) : undefined;
            const seen = new Set<string>();
            while (cur && !seen.has(cur.id)) {
                seen.add(cur.id);
                if (cur.shape === "frame") grow.add(cur.id);
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
            }
        }
    }

    const containers = next.nodes
        .filter(nd => nd.shape === "group" || grow.has(nd.id))
        .sort((a, b) => depthOf(byId, b) - depthOf(byId, a));
    if (containers.length === 0) return next;

    const removed = new Set<string>();
    let changed = false;
    for (const c of containers) {
        const members = (kids.get(c.id) ?? [])
            .map(k => byId.get(k.id)!)
            .filter(k => !removed.has(k.id));
        if (c.shape === "group") {
            if (members.length === 0) {
                removed.add(c.id);
                changed = true;
                continue;
            }
            const b = nodesBounds(members)!;
            if (!sameRect(b, c)) {
                byId.set(c.id, { ...c, x: b.x, y: b.y, w: b.w, h: b.h });
                changed = true;
            }
            continue;
        }
        if (members.length === 0) continue;
        const b = nodesBounds(members)!;
        const room = {
            x: b.x - FRAME_PAD,
            y: b.y - FRAME_PAD,
            w: b.w + 2 * FRAME_PAD,
            h: b.h + 2 * FRAME_PAD,
        };
        const outer = unionRects([{ x: c.x, y: c.y, w: c.w, h: c.h }, room])!;
        // Only where a child pokes out: a frame drawn roomy stays as drawn.
        const fits = b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.w && b.y + b.h <= c.y + c.h;
        if (fits || sameRect(outer, c)) continue;
        byId.set(c.id, { ...c, x: outer.x, y: outer.y, w: outer.w, h: outer.h });
        changed = true;
    }
    if (!changed) return next;
    return {
        ...next,
        nodes: next.nodes.filter(nd => !removed.has(nd.id)).map(nd => byId.get(nd.id) ?? nd),
    };
}

/** The outermost group a box sits in, or null. */
export function outermostGroup(page: DiagramPage, nodeId: string): DiagramNode | null {
    let found: DiagramNode | null = null;
    let cur = nodeById(page, nodeId);
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const parent = nodeById(page, cur.parentId);
        if (!parent) break;
        if (parent.shape === "group") found = parent;
        cur = parent;
    }
    return found;
}

/** Whether `nodeId` sits (at any depth) inside `containerId`. */
export function isInside(page: DiagramPage, nodeId: string, containerId: string): boolean {
    let cur = nodeById(page, nodeId);
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.id)) {
        if (cur.parentId === containerId) return true;
        seen.add(cur.id);
        cur = nodeById(page, cur.parentId);
    }
    return false;
}

/**
 * What a click on `nodeId` selects: its outermost group, unless the person is
 * already working inside that group (one of its boxes is selected), when it
 * is the box itself.
 */
export function clickTarget(
    page: DiagramPage,
    nodeId: string,
    selection: readonly SelectionRef[]
): string {
    const group = outermostGroup(page, nodeId);
    if (!group) return nodeId;
    const inside = selection.some(
        s => s.kind === "node" && s.id !== group.id && isInside(page, s.id, group.id)
    );
    return inside ? nodeId : group.id;
}

/**
 * The frame (or other container that holds boxes, a group aside) a box
 * centred at `at` would join: the innermost one containing the point.
 */
export function containerAt(
    page: DiagramPage,
    at: Point,
    exclude: ReadonlySet<string> = new Set()
): DiagramNode | null {
    return (
        page.nodes
            .filter(
                nd =>
                    !nd.hidden &&
                    !exclude.has(nd.id) &&
                    isContainer(nd.shape) &&
                    nd.shape !== "group" &&
                    rectContains(nodeBounds(nd), at)
            )
            .sort((a, b) => a.w * a.h - b.w * b.h)[0] ?? null
    );
}

/** How far inside a frame's edge (screen px) a press still takes the frame. */
export const FRAME_EDGE = 8;

/**
 * Whether a press at `at` is on a frame's empty inside rather than on its
 * edge or its title — where a drag selects what is in it instead of moving
 * the frame. `edge` is `FRAME_EDGE` in board units.
 */
export function onFrameBody(frame: DiagramNode, at: Point, edge: number): boolean {
    if (frame.shape !== "frame") return false;
    return (
        at.x > frame.x + edge &&
        at.x < frame.x + frame.w - edge &&
        at.y > frame.y + edge &&
        at.y < frame.y + frame.h - edge
    );
}
