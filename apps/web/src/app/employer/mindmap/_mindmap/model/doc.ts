/**
 * Queries and immutable edits over a `MindmapDoc`.
 *
 * Two different hierarchies live on a page and it matters which one you mean:
 *
 *   containment — `node.parentId`, used by groups, frames and swimlanes.
 *                 Moving a container moves its children.
 *   graph       — directed edges. A mindmap's outline, collapse state and
 *                 auto-layout all read this one.
 *
 * Every mutator returns a new page/doc; nothing here edits in place, so the
 * history stack can hold plain references.
 */

import { nodeBounds, unionRects } from "./geometry";
import type {
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    MindmapDoc,
    Rect,
    SelectionRef,
} from "./types";

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function pageById(doc: MindmapDoc, id: string): DiagramPage | undefined {
    return doc.pages.find(p => p.id === id);
}

export function activePage(doc: MindmapDoc): DiagramPage {
    return pageById(doc, doc.activePageId) ?? doc.pages[0]!;
}

export function nodeById(page: DiagramPage, id: string): DiagramNode | undefined {
    return page.nodes.find(nd => nd.id === id);
}

export function edgeById(page: DiagramPage, id: string): DiagramEdge | undefined {
    return page.edges.find(e => e.id === id);
}

export function nodeMap(page: DiagramPage): Map<string, DiagramNode> {
    const m = new Map<string, DiagramNode>();
    for (const nd of page.nodes) m.set(nd.id, nd);
    return m;
}

/** A `NodeLookup` for `routeEdge`, backed by a Map for O(1) hits. */
export function nodeLookup(page: DiagramPage): (id: string) => DiagramNode | undefined {
    const m = nodeMap(page);
    return id => m.get(id);
}

// ---------------------------------------------------------------------------
// Containment hierarchy
// ---------------------------------------------------------------------------

export function childrenOf(page: DiagramPage, parentId: string): DiagramNode[] {
    return page.nodes.filter(nd => nd.parentId === parentId);
}

export function descendantsOf(page: DiagramPage, parentId: string): DiagramNode[] {
    const out: DiagramNode[] = [];
    const stack = [parentId];
    const seen = new Set<string>([parentId]);
    while (stack.length) {
        const cur = stack.pop()!;
        for (const nd of page.nodes) {
            if (nd.parentId === cur && !seen.has(nd.id)) {
                seen.add(nd.id);
                out.push(nd);
                stack.push(nd.id);
            }
        }
    }
    return out;
}

export function ancestorsOf(page: DiagramPage, nodeId: string): DiagramNode[] {
    const out: DiagramNode[] = [];
    let cur = nodeById(page, nodeId);
    const seen = new Set<string>();
    while (cur?.parentId) {
        if (seen.has(cur.parentId)) break;
        seen.add(cur.parentId);
        const parent = nodeById(page, cur.parentId);
        if (!parent) break;
        out.push(parent);
        cur = parent;
    }
    return out;
}

/** The outermost non-container ancestor a click should actually select. */
export function selectionRoot(page: DiagramPage, nodeId: string): string {
    const chain = ancestorsOf(page, nodeId);
    const group = [...chain].reverse().find(a => a.shape === "group");
    return group ? group.id : nodeId;
}

/**
 * `ids` plus every descendant, deduped. Used everywhere a container operation
 * must carry its contents (move, delete, copy, style).
 */
export function withDescendants(page: DiagramPage, ids: readonly string[]): string[] {
    const out = new Set<string>();
    for (const id of ids) {
        out.add(id);
        for (const d of descendantsOf(page, id)) out.add(d.id);
    }
    return [...out];
}

// ---------------------------------------------------------------------------
// Graph hierarchy (edges)
// ---------------------------------------------------------------------------

export interface GraphIndex {
    /** node id → ids of nodes it points at. */
    out: Map<string, string[]>;
    /** node id → ids of nodes pointing at it. */
    in: Map<string, string[]>;
}

export function graphIndex(page: DiagramPage): GraphIndex {
    const out = new Map<string, string[]>();
    const inc = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, key: string, value: string) => {
        const list = m.get(key);
        if (list) list.push(value);
        else m.set(key, [value]);
    };
    for (const e of page.edges) {
        const a = e.from.nodeId;
        const b = e.to.nodeId;
        if (!a || !b || a === b) continue;
        push(out, a, b);
        push(inc, b, a);
    }
    return { out, in: inc };
}

export function graphChildren(page: DiagramPage, nodeId: string, index?: GraphIndex): string[] {
    const idx = index ?? graphIndex(page);
    return idx.out.get(nodeId) ?? [];
}

/** Every node reachable downstream of `nodeId`, excluding itself. */
export function graphDescendants(
    page: DiagramPage,
    nodeId: string,
    index?: GraphIndex
): Set<string> {
    const idx = index ?? graphIndex(page);
    const seen = new Set<string>();
    const stack = [...(idx.out.get(nodeId) ?? [])];
    while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur) || cur === nodeId) continue;
        seen.add(cur);
        for (const nxt of idx.out.get(cur) ?? []) if (!seen.has(nxt)) stack.push(nxt);
    }
    return seen;
}

/** Roots of the graph: nodes nothing points at. Mindmap centre topics. */
export function graphRoots(page: DiagramPage, index?: GraphIndex): DiagramNode[] {
    const idx = index ?? graphIndex(page);
    return page.nodes.filter(nd => (idx.in.get(nd.id) ?? []).length === 0);
}

/**
 * Ids hidden because an ancestor branch is collapsed. Collapsed nodes stay
 * visible; everything downstream of them does not.
 */
export function collapsedHidden(page: DiagramPage): Set<string> {
    const hidden = new Set<string>();
    const collapsed = page.nodes.filter(nd => nd.collapsed);
    if (collapsed.length === 0) return hidden;
    const idx = graphIndex(page);
    // A collapsed node stays visible — only what hangs off it disappears. A
    // nested collapsed node is still hidden, because an outer branch's
    // descendant set already contains it.
    for (const nd of collapsed) {
        for (const id of graphDescendants(page, nd.id, idx)) hidden.add(id);
    }
    return hidden;
}

export function visibleNodes(page: DiagramPage): DiagramNode[] {
    const hidden = collapsedHidden(page);
    return page.nodes.filter(nd => !nd.hidden && !hidden.has(nd.id));
}

export function visibleEdges(page: DiagramPage): DiagramEdge[] {
    const hidden = collapsedHidden(page);
    return page.edges.filter(
        e =>
            !e.hidden &&
            !(e.from.nodeId && hidden.has(e.from.nodeId)) &&
            !(e.to.nodeId && hidden.has(e.to.nodeId))
    );
}

// ---------------------------------------------------------------------------
// Edge attachment
// ---------------------------------------------------------------------------

export function edgesForNode(page: DiagramPage, nodeId: string): DiagramEdge[] {
    return page.edges.filter(e => e.from.nodeId === nodeId || e.to.nodeId === nodeId);
}

export function edgesForNodes(page: DiagramPage, ids: readonly string[]): DiagramEdge[] {
    const set = new Set(ids);
    return page.edges.filter(
        e =>
            (e.from.nodeId !== undefined && set.has(e.from.nodeId)) ||
            (e.to.nodeId !== undefined && set.has(e.to.nodeId))
    );
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export function selectionBounds(
    page: DiagramPage,
    selection: readonly SelectionRef[]
): Rect | null {
    const rects: Rect[] = [];
    for (const ref of selection) {
        if (ref.kind === "node") {
            const nd = nodeById(page, ref.id);
            if (nd) rects.push(nodeBounds(nd));
        }
    }
    return unionRects(rects);
}

export function pageBounds(page: DiagramPage): Rect | null {
    const rects = page.nodes.filter(nd => !nd.hidden).map(nodeBounds);
    for (const e of page.edges) {
        for (const wp of e.waypoints) rects.push({ x: wp.x, y: wp.y, w: 0, h: 0 });
        if (e.from.point) rects.push({ x: e.from.point.x, y: e.from.point.y, w: 0, h: 0 });
        if (e.to.point) rects.push({ x: e.to.point.x, y: e.to.point.y, w: 0, h: 0 });
    }
    return unionRects(rects);
}

// ---------------------------------------------------------------------------
// Immutable page edits
// ---------------------------------------------------------------------------

export function updatePage(
    doc: MindmapDoc,
    pageId: string,
    fn: (page: DiagramPage) => DiagramPage
): MindmapDoc {
    let changed = false;
    const pages = doc.pages.map(p => {
        if (p.id !== pageId) return p;
        const next = fn(p);
        changed = next !== p;
        return next;
    });
    return changed ? { ...doc, pages } : doc;
}

export function mapNodes(
    page: DiagramPage,
    ids: readonly string[],
    fn: (nd: DiagramNode) => DiagramNode
): DiagramPage {
    const set = new Set(ids);
    if (set.size === 0) return page;
    let touched = false;
    const nodes = page.nodes.map(nd => {
        if (!set.has(nd.id)) return nd;
        const next = fn(nd);
        if (next !== nd) touched = true;
        return next;
    });
    return touched ? { ...page, nodes } : page;
}

export function mapEdges(
    page: DiagramPage,
    ids: readonly string[],
    fn: (e: DiagramEdge) => DiagramEdge
): DiagramPage {
    const set = new Set(ids);
    if (set.size === 0) return page;
    let touched = false;
    const edges = page.edges.map(e => {
        if (!set.has(e.id)) return e;
        const next = fn(e);
        if (next !== e) touched = true;
        return next;
    });
    return touched ? { ...page, edges } : page;
}

export function addNodes(page: DiagramPage, nodes: readonly DiagramNode[]): DiagramPage {
    if (nodes.length === 0) return page;
    return { ...page, nodes: [...page.nodes, ...nodes] };
}

export function addEdges(page: DiagramPage, edges: readonly DiagramEdge[]): DiagramPage {
    if (edges.length === 0) return page;
    return { ...page, edges: [...page.edges, ...edges] };
}

/**
 * Delete nodes, their descendants, and any edge that touched them. Edges are
 * removed rather than orphaned: a connector to nothing is never what the user
 * meant by "delete this box".
 */
export function removeNodes(page: DiagramPage, ids: readonly string[]): DiagramPage {
    const all = new Set(withDescendants(page, ids));
    if (all.size === 0) return page;
    return {
        ...page,
        nodes: page.nodes.filter(nd => !all.has(nd.id)),
        edges: page.edges.filter(
            e =>
                !(e.from.nodeId && all.has(e.from.nodeId)) && !(e.to.nodeId && all.has(e.to.nodeId))
        ),
    };
}

export function removeEdges(page: DiagramPage, ids: readonly string[]): DiagramPage {
    const set = new Set(ids);
    if (set.size === 0) return page;
    return { ...page, edges: page.edges.filter(e => !set.has(e.id)) };
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

type ZMove = "front" | "back" | "forward" | "backward";

/**
 * Reorder `ids` within `page.nodes`. Relative order among the moved nodes is
 * preserved, so raising a multi-selection doesn't shuffle it.
 */
export function reorderNodes(page: DiagramPage, ids: readonly string[], move: ZMove): DiagramPage {
    const set = new Set(ids);
    if (set.size === 0) return page;
    const nodes = [...page.nodes];

    if (move === "front" || move === "back") {
        const moved = nodes.filter(nd => set.has(nd.id));
        const rest = nodes.filter(nd => !set.has(nd.id));
        return { ...page, nodes: move === "front" ? [...rest, ...moved] : [...moved, ...rest] };
    }

    const dir = move === "forward" ? 1 : -1;
    // Walk from the leading edge so a block of selected nodes shifts as a unit.
    const order = dir === 1 ? [...nodes.keys()].reverse() : [...nodes.keys()];
    for (const i of order) {
        const nd = nodes[i]!;
        if (!set.has(nd.id)) continue;
        const j = i + dir;
        if (j < 0 || j >= nodes.length) continue;
        const neighbour = nodes[j]!;
        if (set.has(neighbour.id)) continue;
        nodes[i] = neighbour;
        nodes[j] = nd;
    }
    return { ...page, nodes };
}

// ---------------------------------------------------------------------------
// Doc-level helpers
// ---------------------------------------------------------------------------

export function countNodes(doc: MindmapDoc): number {
    return doc.pages.reduce((sum, p) => sum + p.nodes.length, 0);
}

export function countEdges(doc: MindmapDoc): number {
    return doc.pages.reduce((sum, p) => sum + p.edges.length, 0);
}

/** Plain-text digest of a doc, used for search indexing and the source export. */
export function docText(doc: MindmapDoc): string {
    const parts: string[] = [doc.title];
    for (const page of doc.pages) {
        parts.push(page.name);
        for (const nd of page.nodes) if (nd.text.trim()) parts.push(nd.text);
        for (const e of page.edges) for (const l of e.labels) if (l.text.trim()) parts.push(l.text);
    }
    for (const c of doc.comments) {
        parts.push(c.body);
        for (const r of c.replies) parts.push(r.body);
    }
    return parts.join("\n");
}
