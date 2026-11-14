/**
 * Layered layout for directed graphs — flowcharts, pipelines, state machines.
 *
 * The tidy-tree layouts in `layout.ts` place a node under one parent. A
 * flowchart has merges (two arrows into "Ship"), loops ("retry" back to
 * "Build") and more than one start, so it needs the classic layered method
 * (Sugiyama, Tagawa & Toda 1981) instead:
 *
 * 1. **Break cycles** — a depth-first pass reverses the edges that close a
 *    loop, for layout only; the drawn arrow still points back.
 * 2. **Assign layers** — longest path from the starts, then a start that
 *    only feeds a later step is pulled down next to it.
 * 3. **Order each layer** — edges that skip layers get invisible stand-ins
 *    so they reserve a lane, then barycentre sweeps reduce crossings and the
 *    best ordering seen wins.
 * 4. **Place** — each node moves toward the median of its neighbours while
 *    keeping its order and its spacing (an isotonic fit), sweeping down and
 *    up a few times, so chains run straight and branches fan out evenly.
 *
 * Subgraphs (Mermaid's `subgraph … end`) are clusters: their members are kept
 * side by side in every layer and spaced apart from other clusters, and the
 * result reports a rectangle for each one — the frame drawn around it.
 *
 * Pure geometry: no document types beyond `Point`/`Rect`, so it is tested on
 * plain graphs.
 */

import type { Point, Rect } from "./types";

export type LayeredDirection = "down" | "up" | "right" | "left";

export interface LayeredNode {
    id: string;
    w: number;
    h: number;
}

export interface LayeredEdge {
    from: string;
    to: string;
}

export interface LayeredOptions {
    direction?: LayeredDirection;
    /** Space between layers, along the flow. */
    rankGap?: number;
    /** Space between neighbours in a layer, across the flow. */
    nodeGap?: number;
    /**
     * Cluster membership: node id → the clusters it sits in, outermost first.
     * A node missing from the map belongs to none.
     */
    clusters?: ReadonlyMap<string, readonly string[]>;
    /** Space between a cluster's frame and what it holds. */
    clusterPadding?: number;
    /** Room for a cluster's title, above its frame. */
    clusterLabel?: number;
}

export interface LayeredResult {
    /** Top-left of every node. */
    positions: Map<string, Point>;
    /** The frame of every cluster that holds at least one node. */
    clusters: Map<string, Rect>;
}

const DEFAULTS = {
    rankGap: 64,
    nodeGap: 40,
    clusterPadding: 22,
    clusterLabel: 26,
};

/** How many ordering sweeps to run; more rarely helps on diagrams people draw. */
const ORDER_SWEEPS = 12;
/** How many placement sweeps (each one down and one up). */
const PLACE_SWEEPS = 6;
/** The size a lane stand-in reserves. */
const DUMMY_SIZE = 12;

interface Item {
    id: string;
    /** Along the layer (width when flowing down). */
    cross: number;
    /** Along the flow (height when flowing down). */
    main: number;
    dummy: boolean;
    clusters: readonly string[];
}

export function layeredLayout(
    nodes: readonly LayeredNode[],
    edges: readonly LayeredEdge[],
    options: LayeredOptions = {}
): LayeredResult {
    const direction = options.direction ?? "down";
    const horizontal = direction === "right" || direction === "left";
    const rankGap = options.rankGap ?? DEFAULTS.rankGap;
    const nodeGap = options.nodeGap ?? DEFAULTS.nodeGap;
    const pad = options.clusterPadding ?? DEFAULTS.clusterPadding;
    const label = options.clusterLabel ?? DEFAULTS.clusterLabel;
    const membership = options.clusters ?? new Map<string, readonly string[]>();

    if (nodes.length === 0) return { positions: new Map(), clusters: new Map() };

    // -- graph ----------------------------------------------------------------
    const ids = nodes.map(n => n.id);
    const known = new Set(ids);
    const items = new Map<string, Item>();
    for (const n of nodes) {
        items.set(n.id, {
            id: n.id,
            cross: horizontal ? n.h : n.w,
            main: horizontal ? n.w : n.h,
            dummy: false,
            clusters: membership.get(n.id) ?? [],
        });
    }
    const seenPairs = new Set<string>();
    const pairs: Array<[string, string]> = [];
    for (const e of edges) {
        if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
        const key = `${e.from}\u0000${e.to}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        pairs.push([e.from, e.to]);
    }

    const dag = breakCycles(ids, pairs);
    const rank = assignRanks(ids, dag);

    // -- lanes for long edges -------------------------------------------------
    const succ = new Map<string, string[]>(ids.map(id => [id, []]));
    const pred = new Map<string, string[]>(ids.map(id => [id, []]));
    const link = (a: string, b: string) => {
        succ.get(a)!.push(b);
        pred.get(b)!.push(a);
    };
    let dummyCount = 0;
    for (const [from, to] of dag) {
        const span = rank.get(to)! - rank.get(from)!;
        if (span <= 1) {
            link(from, to);
            continue;
        }
        const shared = commonPrefix(items.get(from)!.clusters, items.get(to)!.clusters);
        let prev = from;
        for (let r = rank.get(from)! + 1; r < rank.get(to)!; r += 1) {
            const id = `\u0000lane${dummyCount++}`;
            items.set(id, {
                id,
                cross: DUMMY_SIZE,
                main: DUMMY_SIZE,
                dummy: true,
                clusters: shared,
            });
            rank.set(id, r);
            succ.set(id, []);
            pred.set(id, []);
            link(prev, id);
            prev = id;
        }
        link(prev, to);
    }

    // -- order ----------------------------------------------------------------
    const maxRank = Math.max(...[...rank.values()]);
    const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (const id of initialOrder(ids, succ, rank)) layers[rank.get(id)!]!.push(id);
    for (const [id, r] of rank) if (items.get(id)!.dummy) layers[r]!.push(id);

    let best = layers.map(l => [...l]);
    let bestCrossings = countCrossings(best, succ);
    for (let sweep = 0; sweep < ORDER_SWEEPS && bestCrossings > 0; sweep += 1) {
        const down = sweep % 2 === 0;
        const range = down
            ? Array.from({ length: maxRank }, (_, i) => i + 1)
            : Array.from({ length: maxRank }, (_, i) => maxRank - 1 - i);
        for (const r of range) {
            const fixed = layers[down ? r - 1 : r + 1]!;
            const neighbours = down ? pred : succ;
            layers[r] = orderLayer(layers[r]!, fixed, neighbours, items);
        }
        const crossings = countCrossings(layers, succ);
        if (crossings < bestCrossings) {
            bestCrossings = crossings;
            best = layers.map(l => [...l]);
        }
    }

    // -- place across the flow ------------------------------------------------
    const clusterDepthGap = (a: Item, b: Item): number => {
        // Neighbours in different clusters need room for both frames' sides.
        const shared = commonPrefix(a.clusters, b.clusters).length;
        const levels = a.clusters.length - shared + (b.clusters.length - shared);
        if (levels === 0) return 0;
        // Flowing right, a frame's title sits across the flow, above it.
        return levels * pad + (horizontal ? (b.clusters.length - shared) * label : 0);
    };
    const separation = (a: Item, b: Item): number =>
        a.cross / 2 +
        b.cross / 2 +
        (a.dummy || b.dummy ? nodeGap / 2 : nodeGap) +
        clusterDepthGap(a, b);

    const centre = new Map<string, number>();
    for (const layer of best) {
        let at = 0;
        layer.forEach((id, i) => {
            if (i > 0) at += separation(items.get(layer[i - 1]!)!, items.get(id)!);
            centre.set(id, at);
        });
    }
    for (let sweep = 0; sweep < PLACE_SWEEPS; sweep += 1) {
        for (let r = 1; r <= maxRank; r += 1) placeLayer(best[r]!, pred, centre, items, separation);
        for (let r = maxRank - 1; r >= 0; r -= 1)
            placeLayer(best[r]!, succ, centre, items, separation);
    }
    // Last, settle each node between what feeds it and what it feeds, so a
    // decision under a chain sits between the chain and its branches rather
    // than wherever the final one-sided sweep left it.
    const both = new Map<string, string[]>();
    for (const id of items.keys()) both.set(id, [...(pred.get(id) ?? []), ...(succ.get(id) ?? [])]);
    for (let sweep = 0; sweep < 2; sweep += 1) {
        for (let r = 0; r <= maxRank; r += 1) placeLayer(best[r]!, both, centre, items, separation);
    }

    // -- place along the flow -------------------------------------------------
    const layerMain = best.map(layer => Math.max(0, ...layer.map(id => items.get(id)!.main)));
    const mainAt: number[] = [];
    let cursor = 0;
    for (let r = 0; r <= maxRank; r += 1) {
        if (r > 0) {
            // A cluster that opens at this layer needs its top padding (and,
            // flowing down, its title); one that closed above needs its bottom.
            const opening = clustersOpening(best, r, items);
            const closing = clustersClosing(best, r - 1, items);
            cursor += rankGap + opening * (pad + (horizontal ? 0 : label)) + closing * pad;
        } else {
            cursor += clustersOpening(best, 0, items) * (pad + (horizontal ? 0 : label));
        }
        mainAt[r] = cursor;
        cursor += layerMain[r]!;
    }

    // -- out ------------------------------------------------------------------
    const flip = direction === "up" || direction === "left";
    const total = cursor;
    const positions = new Map<string, Point>();
    const boxes = new Map<string, Rect>();
    for (let r = 0; r <= maxRank; r += 1) {
        for (const id of best[r]!) {
            const item = items.get(id)!;
            const c = centre.get(id)! - item.cross / 2;
            // Centred in its layer's band, so mixed heights line up on their middles.
            let m = mainAt[r]! + (layerMain[r]! - item.main) / 2;
            if (flip) m = total - m - item.main;
            const rect = horizontal
                ? { x: m, y: c, w: item.main, h: item.cross }
                : { x: c, y: m, w: item.cross, h: item.main };
            if (!item.dummy) {
                positions.set(id, { x: rect.x, y: rect.y });
                boxes.set(id, rect);
            }
        }
    }

    const clusters = clusterFrames(boxes, membership, pad, label);
    normalise(positions, clusters, label);
    return { positions, clusters };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * The edges with every loop opened: a depth-first walk in input order, and
 * an edge back to a node still on the walk's stack is turned round.
 */
function breakCycles(
    ids: readonly string[],
    pairs: ReadonlyArray<[string, string]>
): Array<[string, string]> {
    const out = new Map<string, string[]>(ids.map(id => [id, []]));
    for (const [a, b] of pairs) out.get(a)!.push(b);
    const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
    const reversed = new Set<string>();
    for (const root of ids) {
        if (state.has(root)) continue;
        // Iterative DFS: deep flowcharts must not overflow the stack.
        const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
        state.set(root, 1);
        while (stack.length > 0) {
            const top = stack[stack.length - 1]!;
            const children = out.get(top.id)!;
            if (top.next >= children.length) {
                state.set(top.id, 2);
                stack.pop();
                continue;
            }
            const child = children[top.next++]!;
            const s = state.get(child);
            if (s === 1) reversed.add(`${top.id}\u0000${child}`);
            else if (s === undefined) {
                state.set(child, 1);
                stack.push({ id: child, next: 0 });
            }
        }
    }
    return pairs.map(([a, b]) => (reversed.has(`${a}\u0000${b}`) ? [b, a] : [a, b]));
}

/** Longest path from the starts, then starts pulled down beside what they feed. */
function assignRanks(
    ids: readonly string[],
    dag: ReadonlyArray<[string, string]>
): Map<string, number> {
    const succ = new Map<string, string[]>(ids.map(id => [id, []]));
    const indegree = new Map<string, number>(ids.map(id => [id, 0]));
    for (const [a, b] of dag) {
        succ.get(a)!.push(b);
        indegree.set(b, indegree.get(b)! + 1);
    }
    const rank = new Map<string, number>(ids.map(id => [id, 0]));
    const queue = ids.filter(id => indegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(id);
        for (const next of succ.get(id)!) {
            rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
            indegree.set(next, indegree.get(next)! - 1);
            if (indegree.get(next) === 0) queue.push(next);
        }
    }
    const hasPred = new Set(dag.map(([, b]) => b));
    for (const id of [...order].reverse()) {
        if (hasPred.has(id)) continue;
        const next = succ.get(id)!;
        if (next.length === 0) continue;
        rank.set(id, Math.min(...next.map(n => rank.get(n)!)) - 1);
    }
    return rank;
}

/** Breadth-first from the starts, in input order: a readable first guess. */
function initialOrder(
    ids: readonly string[],
    succ: ReadonlyMap<string, readonly string[]>,
    rank: ReadonlyMap<string, number>
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const starts = [...ids].sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (const start of starts) {
        if (seen.has(start)) continue;
        const queue = [start];
        seen.add(start);
        while (queue.length > 0) {
            const id = queue.shift()!;
            if (!id.startsWith("\u0000")) out.push(id);
            for (const next of succ.get(id) ?? []) {
                if (seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return out;
}

/**
 * One layer re-ordered by the barycentre of its neighbours in `fixed`,
 * keeping every cluster's members together: nodes compare by their outermost
 * cluster's mean barycentre first, then the next cluster in, then their own.
 */
function orderLayer(
    layer: readonly string[],
    fixed: readonly string[],
    neighbours: ReadonlyMap<string, readonly string[]>,
    items: ReadonlyMap<string, Item>
): string[] {
    const index = new Map(fixed.map((id, i) => [id, i]));
    const bary = new Map<string, number>();
    layer.forEach((id, i) => {
        const ns = (neighbours.get(id) ?? []).filter(n => index.has(n));
        bary.set(
            id,
            ns.length > 0
                ? ns.reduce((sum, n) => sum + index.get(n)!, 0) / ns.length
                : i * (fixed.length / Math.max(layer.length, 1))
        );
    });

    // Mean barycentre of each cluster prefix present in this layer.
    const groupSum = new Map<string, { sum: number; n: number }>();
    for (const id of layer) {
        const path = items.get(id)!.clusters;
        for (let depth = 1; depth <= path.length; depth += 1) {
            const key = path.slice(0, depth).join("\u0001");
            const g = groupSum.get(key) ?? { sum: 0, n: 0 };
            g.sum += bary.get(id)!;
            g.n += 1;
            groupSum.set(key, g);
        }
    }
    const keyOf = (id: string): Array<number | string> => {
        const path = items.get(id)!.clusters;
        const key: Array<number | string> = [];
        for (let depth = 1; depth <= path.length; depth += 1) {
            const g = groupSum.get(path.slice(0, depth).join("\u0001"))!;
            key.push(g.sum / g.n, path[depth - 1]!);
        }
        key.push(bary.get(id)!, "");
        return key;
    };
    const keys = new Map(layer.map(id => [id, keyOf(id)]));
    const position = new Map(layer.map((id, i) => [id, i]));
    return [...layer].sort((a, b) => {
        const ka = keys.get(a)!;
        const kb = keys.get(b)!;
        // A node outside a cluster compares its own barycentre against the
        // cluster's, at the cluster's level.
        for (let i = 0; i < Math.min(ka.length, kb.length); i += 1) {
            const x = ka[i]!;
            const y = kb[i]!;
            if (x === y) continue;
            if (typeof x === "number" && typeof y === "number") return x - y;
            if (typeof x === "string" && typeof y === "string") return x < y ? -1 : 1;
            return typeof x === "number" ? -1 : 1;
        }
        return position.get(a)! - position.get(b)!;
    });
}

function countCrossings(
    layers: readonly string[][],
    succ: ReadonlyMap<string, readonly string[]>
): number {
    let total = 0;
    for (let r = 0; r + 1 < layers.length; r += 1) {
        const below = new Map(layers[r + 1]!.map((id, i) => [id, i]));
        const segments: Array<[number, number]> = [];
        layers[r]!.forEach((id, i) => {
            for (const n of succ.get(id) ?? []) {
                const j = below.get(n);
                if (j !== undefined) segments.push([i, j]);
            }
        });
        for (let a = 0; a < segments.length; a += 1) {
            for (let b = a + 1; b < segments.length; b += 1) {
                const [a1, a2] = segments[a]!;
                const [b1, b2] = segments[b]!;
                if ((a1 - b1) * (a2 - b2) < 0) total += 1;
            }
        }
    }
    return total;
}

/**
 * Move a layer's nodes toward the median centre of their neighbours, keeping
 * their order and their spacing: the least-squares fit under "each node at
 * least `separation` right of the last" — pool-adjacent-violators on the
 * targets shifted by the cumulative spacing.
 */
function placeLayer(
    layer: readonly string[],
    neighbours: ReadonlyMap<string, readonly string[]>,
    centre: Map<string, number>,
    items: ReadonlyMap<string, Item>,
    separation: (a: Item, b: Item) => number
): void {
    if (layer.length === 0) return;
    const offsets: number[] = [0];
    for (let i = 1; i < layer.length; i += 1) {
        offsets[i] = offsets[i - 1]! + separation(items.get(layer[i - 1]!)!, items.get(layer[i]!)!);
    }
    const targets = layer.map((id, i) => {
        const ns = (neighbours.get(id) ?? [])
            .map(n => centre.get(n))
            .filter((v): v is number => v !== undefined);
        const want = ns.length > 0 ? median(ns) : centre.get(id)!;
        return want - offsets[i]!;
    });
    // Pool adjacent violators: blocks of equal value, non-decreasing.
    const blocks: Array<{ value: number; weight: number; count: number }> = [];
    for (const t of targets) {
        blocks.push({ value: t, weight: 1, count: 1 });
        while (
            blocks.length > 1 &&
            blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value
        ) {
            const b = blocks.pop()!;
            const a = blocks.pop()!;
            const weight = a.weight + b.weight;
            blocks.push({
                value: (a.value * a.weight + b.value * b.weight) / weight,
                weight,
                count: a.count + b.count,
            });
        }
    }
    let i = 0;
    for (const block of blocks) {
        for (let k = 0; k < block.count; k += 1, i += 1)
            centre.set(layer[i]!, block.value + offsets[i]!);
    }
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function commonPrefix(a: readonly string[], b: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i += 1) out.push(a[i]!);
    return out;
}

/** How many cluster levels begin at layer `r` (a cluster with no member above it). */
function clustersOpening(
    layers: readonly string[][],
    r: number,
    items: ReadonlyMap<string, Item>
): number {
    const above = new Set<string>();
    for (let k = 0; k < r; k += 1) {
        for (const id of layers[k]!) for (const c of items.get(id)!.clusters) above.add(c);
    }
    let most = 0;
    for (const id of layers[r]!) {
        const path = items.get(id)!.clusters;
        const fresh = path.filter(c => !above.has(c)).length;
        most = Math.max(most, fresh);
    }
    return most;
}

/** How many cluster levels end at layer `r` (a cluster with no member below it). */
function clustersClosing(
    layers: readonly string[][],
    r: number,
    items: ReadonlyMap<string, Item>
): number {
    const below = new Set<string>();
    for (let k = r + 1; k < layers.length; k += 1) {
        for (const id of layers[k]!) for (const c of items.get(id)!.clusters) below.add(c);
    }
    let most = 0;
    for (const id of layers[r]!) {
        const path = items.get(id)!.clusters;
        most = Math.max(most, path.filter(c => !below.has(c)).length);
    }
    return most;
}

/** Each cluster's frame: its members' bounds, inner frames included, padded. */
function clusterFrames(
    boxes: ReadonlyMap<string, Rect>,
    membership: ReadonlyMap<string, readonly string[]>,
    pad: number,
    label: number
): Map<string, Rect> {
    const deepest = new Map<string, number>();
    const parentOf = new Map<string, string | null>();
    for (const path of membership.values()) {
        path.forEach((c, depth) => {
            deepest.set(c, Math.max(deepest.get(c) ?? 0, depth));
            if (!parentOf.has(c)) parentOf.set(c, depth > 0 ? path[depth - 1]! : null);
        });
    }
    const bounds = new Map<string, Rect>();
    const grow = (c: string, r: Rect) => {
        const b = bounds.get(c);
        if (!b) {
            bounds.set(c, { ...r });
            return;
        }
        const x = Math.min(b.x, r.x);
        const y = Math.min(b.y, r.y);
        bounds.set(c, {
            x,
            y,
            w: Math.max(b.x + b.w, r.x + r.w) - x,
            h: Math.max(b.y + b.h, r.y + r.h) - y,
        });
    };
    for (const [id, path] of membership) {
        const box = boxes.get(id);
        if (!box || path.length === 0) continue;
        grow(path[path.length - 1]!, box);
    }
    // Innermost first, so a parent's bounds include its children's frames.
    const order = [...bounds.keys(), ...[...parentOf.keys()].filter(c => !bounds.has(c))].sort(
        (a, b) => (deepest.get(b) ?? 0) - (deepest.get(a) ?? 0)
    );
    const frames = new Map<string, Rect>();
    for (const c of order) {
        const b = bounds.get(c);
        if (!b) continue;
        const frame = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        frames.set(c, frame);
        const parent = parentOf.get(c);
        // The parent must clear this frame's title as well.
        if (parent) grow(parent, { ...frame, y: frame.y - label, h: frame.h + label });
    }
    return frames;
}

/** Shift everything so the drawing, frame titles included, starts at the origin. */
function normalise(
    positions: Map<string, Point>,
    clusters: Map<string, Rect>,
    label: number
): void {
    let minX = Infinity;
    let minY = Infinity;
    for (const p of positions.values()) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
    }
    for (const r of clusters.values()) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y - label);
    }
    if (!Number.isFinite(minX)) return;
    for (const [id, p] of positions) positions.set(id, { x: p.x - minX, y: p.y - minY });
    for (const [id, r] of clusters) clusters.set(id, { ...r, x: r.x - minX, y: r.y - minY });
}
