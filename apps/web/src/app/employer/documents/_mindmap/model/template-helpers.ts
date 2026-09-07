/**
 * Document-level helpers shared by templates and importers — the store-free
 * half of the layout API, so a template can ship already tidied.
 */

import { computeLayout, type LayoutKind, type LayoutOptions } from "./layout";
import { nodesBounds } from "./geometry";
import type { MindmapDoc, Point } from "./types";

/** Run a layout over every page of `doc` and return the repositioned copy. */
export function runAutoLayout(
    doc: MindmapDoc,
    kind: LayoutKind,
    options: Omit<LayoutOptions, "kind"> = {}
): MindmapDoc {
    return {
        ...doc,
        pages: doc.pages.map(page => {
            const positions = computeLayout(page, { ...options, kind });
            if (positions.size === 0) return page;
            return {
                ...page,
                nodes: page.nodes.map(nd => {
                    const pos = positions.get(nd.id);
                    return pos ? { ...nd, x: pos.x, y: pos.y } : nd;
                }),
            };
        }),
    };
}

/** Translate every node on every page so the content starts at `origin`. */
export function normalizeOrigin(doc: MindmapDoc, origin: Point = { x: 0, y: 0 }): MindmapDoc {
    return {
        ...doc,
        pages: doc.pages.map(page => {
            const bounds = nodesBounds(page.nodes);
            if (!bounds) return page;
            const dx = origin.x - bounds.x;
            const dy = origin.y - bounds.y;
            if (dx === 0 && dy === 0) return page;
            return {
                ...page,
                nodes: page.nodes.map(nd => ({ ...nd, x: nd.x + dx, y: nd.y + dy })),
                edges: page.edges.map(e => ({
                    ...e,
                    waypoints: e.waypoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
                    from: e.from.point
                        ? { ...e.from, point: { x: e.from.point.x + dx, y: e.from.point.y + dy } }
                        : e.from,
                    to: e.to.point
                        ? { ...e.to, point: { x: e.to.point.x + dx, y: e.to.point.y + dy } }
                        : e.to,
                })),
            };
        }),
    };
}
