/**
 * Automatic layouts.
 *
 * All of them are variable-size tidy-tree placements: each subtree reserves the
 * cross-axis room it actually needs, and a parent is centred on the block its
 * children occupy. That keeps a mindmap readable when one branch has 2 children
 * and its sibling has 20 — the naive "divide the arc evenly" approach does not.
 *
 * A layout returns positions only (`Map<nodeId, {x, y}>`); applying them is the
 * caller's job, so one layout run is one history entry.
 */

import { graphIndex, nodeById, nodeMap } from "./doc";
import { nodesBounds } from "./geometry";
import type { DiagramPage, Point } from "./types";

export type LayoutDirection = "right" | "left" | "down" | "up";

export type LayoutKind =
    | "mindmap" // root in the middle, branches fanning both ways
    | "tree" // one direction, tidy
    | "org" // top-down, parents centred over children
    | "radial" // concentric rings
    | "grid"; // ignore the graph, pack into rows

export interface LayoutOptions {
    kind: LayoutKind;
    direction?: LayoutDirection;
    /** Gap along the direction of growth. */
    mainGap?: number;
    /** Gap between siblings, across the direction of growth. */
    crossGap?: number;
    /** Restrict layout to this root; defaults to every graph root. */
    rootId?: string;
    /** Grid layout only. */
    columns?: number;
}

export type Positions = Map<string, Point>;

const DEFAULT_MAIN_GAP = 90;
const DEFAULT_CROSS_GAP = 26;

// ---------------------------------------------------------------------------
// Tree extraction
// ---------------------------------------------------------------------------

interface TreeNode {
    id: string;
    w: number;
    h: number;
    children: TreeNode[];
    /** Cross-axis extent of this node's whole subtree. */
    extent: number;
    /** Assigned during placement. */
    main: number;
    cross: number;
}

/**
 * Depth-first spanning tree of the page's graph, starting at `rootId`. Cycles
 * and diamonds are broken by first-visit, so every node is placed exactly once.
 */
function buildTree(
    page: DiagramPage,
    rootId: string,
    visited: Set<string>,
    horizontal: boolean
): TreeNode | null {
    if (visited.has(rootId)) return null;
    const map = nodeMap(page);
    const idx = graphIndex(page);

    const build = (id: string): TreeNode | null => {
        if (visited.has(id)) return null;
        const nd = map.get(id);
        if (!nd) return null;
        visited.add(id);
        const kids: TreeNode[] = [];
        if (!nd.collapsed) {
            for (const childId of idx.out.get(id) ?? []) {
                const child = build(childId);
                if (child) kids.push(child);
            }
        }
        return {
            id,
            w: nd.w,
            h: nd.h,
            children: kids,
            extent: 0,
            main: 0,
            cross: 0,
        };
    };

    const tree = build(rootId);
    if (tree) measure(tree, horizontal, DEFAULT_CROSS_GAP);
    return tree;
}

/** Bottom-up: a node's extent is max(own size, sum of children + gaps). */
function measure(node: TreeNode, horizontal: boolean, crossGap: number): number {
    const own = horizontal ? node.h : node.w;
    if (node.children.length === 0) {
        node.extent = own;
        return own;
    }
    let total = 0;
    for (const c of node.children) total += measure(c, horizontal, crossGap);
    total += crossGap * (node.children.length - 1);
    node.extent = Math.max(own, total);
    return node.extent;
}

/** Top-down: stack children across the cross axis, centre the parent on them. */
function place(
    node: TreeNode,
    main: number,
    crossStart: number,
    horizontal: boolean,
    mainGap: number,
    crossGap: number,
    sign: 1 | -1
): void {
    node.main = main;
    const own = horizontal ? node.h : node.w;
    node.cross = crossStart + (node.extent - own) / 2;

    if (node.children.length === 0) return;
    const childrenExtent =
        node.children.reduce((s, c) => s + c.extent, 0) + crossGap * (node.children.length - 1);
    let cursor = crossStart + (node.extent - childrenExtent) / 2;
    const ownMain = horizontal ? node.w : node.h;
    for (const c of node.children) {
        const childMain =
            sign === 1 ? main + ownMain + mainGap : main - mainGap - (horizontal ? c.w : c.h);
        place(c, childMain, cursor, horizontal, mainGap, crossGap, sign);
        cursor += c.extent + crossGap;
    }
}

function collect(node: TreeNode, horizontal: boolean, into: Positions): void {
    into.set(
        node.id,
        horizontal ? { x: node.main, y: node.cross } : { x: node.cross, y: node.main }
    );
    for (const c of node.children) collect(c, horizontal, into);
}

// ---------------------------------------------------------------------------
// Layout kinds
// ---------------------------------------------------------------------------

function layoutTree(
    page: DiagramPage,
    opts: Required<Pick<LayoutOptions, "mainGap" | "crossGap">> & LayoutOptions
): Positions {
    const dir = opts.direction ?? "right";
    const horizontal = dir === "right" || dir === "left";
    const sign: 1 | -1 = dir === "right" || dir === "down" ? 1 : -1;
    const positions: Positions = new Map();
    const visited = new Set<string>();

    const roots = opts.rootId ? [opts.rootId] : rootIds(page);
    let crossCursor = 0;
    for (const rootId of roots) {
        const root = buildTree(page, rootId, visited, horizontal);
        if (!root) continue;
        const anchor = nodeById(page, rootId);
        const mainStart = anchor ? (horizontal ? anchor.x : anchor.y) : 0;
        place(root, mainStart, crossCursor, horizontal, opts.mainGap, opts.crossGap, sign);
        collect(root, horizontal, positions);
        crossCursor += root.extent + opts.crossGap * 3;
    }
    return positions;
}

/** Classic mindmap: root centred, first-level children split left and right. */
function layoutMindmap(
    page: DiagramPage,
    opts: Required<Pick<LayoutOptions, "mainGap" | "crossGap">> & LayoutOptions
): Positions {
    const positions: Positions = new Map();
    const idx = graphIndex(page);
    const roots = opts.rootId ? [opts.rootId] : rootIds(page);
    const rootId = roots[0];
    if (!rootId) return positions;

    const rootNode = nodeById(page, rootId);
    if (!rootNode) return positions;

    const firstLevel = (idx.out.get(rootId) ?? []).filter(id => nodeById(page, id));
    const half = Math.ceil(firstLevel.length / 2);
    const rightIds = firstLevel.slice(0, half);
    const leftIds = firstLevel.slice(half);

    positions.set(rootId, { x: rootNode.x, y: rootNode.y });

    const runSide = (ids: string[], sign: 1 | -1) => {
        if (ids.length === 0) return;
        const visited = new Set<string>([rootId]);
        const subtrees: TreeNode[] = [];
        for (const id of ids) {
            const t = buildTree(page, id, visited, true);
            if (t) subtrees.push(t);
        }
        if (subtrees.length === 0) return;
        const total =
            subtrees.reduce((s, t) => s + t.extent, 0) + opts.crossGap * (subtrees.length - 1);
        let cursor = rootNode.y + rootNode.h / 2 - total / 2;
        for (const t of subtrees) {
            const mainStart =
                sign === 1
                    ? rootNode.x + rootNode.w + opts.mainGap
                    : rootNode.x - opts.mainGap - t.w;
            place(t, mainStart, cursor, true, opts.mainGap, opts.crossGap, sign);
            collect(t, true, positions);
            cursor += t.extent + opts.crossGap;
        }
    };

    runSide(rightIds, 1);
    runSide(leftIds, -1);
    return positions;
}

/** Concentric rings; each ring's radius grows with the count it must hold. */
function layoutRadial(
    page: DiagramPage,
    opts: Required<Pick<LayoutOptions, "mainGap" | "crossGap">> & LayoutOptions
): Positions {
    const positions: Positions = new Map();
    const idx = graphIndex(page);
    const roots = opts.rootId ? [opts.rootId] : rootIds(page);
    const rootId = roots[0];
    const rootNode = rootId ? nodeById(page, rootId) : undefined;
    if (!rootId || !rootNode) return positions;

    const cx = rootNode.x + rootNode.w / 2;
    const cy = rootNode.y + rootNode.h / 2;
    positions.set(rootId, { x: rootNode.x, y: rootNode.y });

    // Breadth-first rings, each node keeping the angular slice of its parent so
    // a branch stays contiguous instead of interleaving with its siblings.
    interface Slot {
        id: string;
        from: number;
        to: number;
        depth: number;
    }
    const queue: Slot[] = [{ id: rootId, from: 0, to: Math.PI * 2, depth: 0 }];
    const seen = new Set<string>([rootId]);

    while (queue.length) {
        const slot = queue.shift()!;
        const kids = (idx.out.get(slot.id) ?? []).filter(id => !seen.has(id));
        if (kids.length === 0) continue;
        const span = (slot.to - slot.from) / kids.length;
        const radius = ringMinRadius(slot.depth + 1, opts.mainGap, page, kids.length);
        kids.forEach((id, i) => {
            seen.add(id);
            const from = slot.from + span * i;
            const to = from + span;
            const angle = (from + to) / 2;
            const nd = nodeById(page, id);
            if (nd) {
                positions.set(id, {
                    x: cx + Math.cos(angle) * radius - nd.w / 2,
                    y: cy + Math.sin(angle) * radius - nd.h / 2,
                });
            }
            queue.push({ id, from, to, depth: slot.depth + 1 });
        });
    }
    return positions;
}

function ringMinRadius(depth: number, gap: number, page: DiagramPage, count: number): number {
    // Wide enough that `count` average-sized nodes fit around the circle.
    const avg =
        page.nodes.length > 0 ? page.nodes.reduce((s, nd) => s + nd.w, 0) / page.nodes.length : 160;
    const circumferenceNeed = ((avg + 30) * count) / (Math.PI * 2);
    return Math.max(depth * (avg * 0.9 + gap), circumferenceNeed);
}

/** Pack the given nodes into rows, ignoring the graph entirely. */
function layoutGrid(
    page: DiagramPage,
    ids: readonly string[],
    columns: number,
    gap: number
): Positions {
    const positions: Positions = new Map();
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is NonNullable<typeof nd> => nd !== undefined);
    if (nodes.length === 0) return positions;
    const origin = nodesBounds(nodes) ?? { x: 0, y: 0, w: 0, h: 0 };
    const cols = Math.max(1, columns || Math.ceil(Math.sqrt(nodes.length)));
    const colW = Math.max(...nodes.map(nd => nd.w)) + gap;
    const rowH = Math.max(...nodes.map(nd => nd.h)) + gap;
    nodes.forEach((nd, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.set(nd.id, {
            x: origin.x + col * colW + (colW - gap - nd.w) / 2,
            y: origin.y + row * rowH + (rowH - gap - nd.h) / 2,
        });
    });
    return positions;
}

function rootIds(page: DiagramPage): string[] {
    const idx = graphIndex(page);
    const roots = page.nodes.filter(nd => (idx.in.get(nd.id) ?? []).length === 0).map(nd => nd.id);
    if (roots.length > 0) return roots;
    // Fully cyclic graph: fall back to the first node so layout still runs.
    return page.nodes[0] ? [page.nodes[0].id] : [];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function computeLayout(
    page: DiagramPage,
    options: LayoutOptions,
    /** For `grid`, the nodes to pack; ignored by the tree layouts. */
    subset?: readonly string[]
): Positions {
    const opts = {
        ...options,
        mainGap: options.mainGap ?? DEFAULT_MAIN_GAP,
        crossGap: options.crossGap ?? DEFAULT_CROSS_GAP,
    };
    switch (options.kind) {
        case "mindmap":
            return layoutMindmap(page, opts);
        case "org":
            return layoutTree(page, { ...opts, direction: "down" });
        case "radial":
            return layoutRadial(page, opts);
        case "grid":
            return layoutGrid(
                page,
                subset && subset.length > 0 ? subset : page.nodes.map(nd => nd.id),
                options.columns ?? 0,
                opts.crossGap + 20
            );
        case "tree":
        default:
            return layoutTree(page, opts);
    }
}

/**
 * Where a new child of `parentId` should appear, so pressing Tab inserts the
 * topic somewhere sensible before the next full layout pass runs.
 */
export function suggestChildPosition(
    page: DiagramPage,
    parentId: string,
    childSize: { w: number; h: number },
    direction: LayoutDirection = "right"
): Point {
    const parent = nodeById(page, parentId);
    if (!parent) return { x: 0, y: 0 };
    const idx = graphIndex(page);
    const siblings = (idx.out.get(parentId) ?? [])
        .map(id => nodeById(page, id))
        .filter((nd): nd is NonNullable<typeof nd> => nd !== undefined);

    const gap = 60;
    if (direction === "right" || direction === "left") {
        const x = direction === "right" ? parent.x + parent.w + gap : parent.x - gap - childSize.w;
        if (siblings.length === 0) {
            return { x, y: parent.y + parent.h / 2 - childSize.h / 2 };
        }
        const lowest = Math.max(...siblings.map(s => s.y + s.h));
        return { x, y: lowest + 20 };
    }
    const y = direction === "down" ? parent.y + parent.h + gap : parent.y - gap - childSize.h;
    if (siblings.length === 0) return { x: parent.x + parent.w / 2 - childSize.w / 2, y };
    const rightmost = Math.max(...siblings.map(s => s.x + s.w));
    return { x: rightmost + 24, y };
}
