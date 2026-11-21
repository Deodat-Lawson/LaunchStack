/**
 * Direction A's chart, as pure page edits: laying a chart out top to bottom,
 * the label a decision's next branch gets, taking a step out and joining the
 * line around it, and where the arrow keys go. No store, no React — the
 * look (`look.ts`) and the key handlers (`actions.ts`) both call these.
 */

import { graphIndex, insertEdgesBeside, nodeById, removeNodes } from "../../model/doc";
import { createEdge } from "../../model/factory";
import { layeredLayout } from "../../model/layered";
import { isContainer } from "../../model/shapes";
import type { DiagramEdge, DiagramNode, DiagramPage } from "../../model/types";

/** Every step's starting size. Taller only when its words wrap. */
export const STEP_SIZE = { w: 176, h: 56 } as const;
/** A decision's starting size. */
export const DECISION_SIZE = { w: 176, h: 96 } as const;
/** Space between one row of steps and the next. */
export const RANK_GAP = 64;
/** Space between steps side by side. */
export const NODE_GAP = 48;

/** A label that asks something: it ends in a question mark (full-width too). */
export function isQuestion(text: string): boolean {
    return /[?？]$/.test(text.trim());
}

function inChart(nd: DiagramNode | undefined): nd is DiagramNode {
    return nd !== undefined && !nd.hidden && !isContainer(nd.shape);
}

/** Whether an arrow joins two different boxes of a chart. */
function joins(page: DiagramPage, e: DiagramEdge): boolean {
    const a = e.from.nodeId;
    const b = e.to.nodeId;
    return (
        !!a &&
        !!b &&
        a !== b &&
        inChart(nodeById(page, a)) &&
        inChart(nodeById(page, b)) &&
        !e.hidden
    );
}

/**
 * The chart holding `seeds`: every box reached from them along arrows, either
 * way. In page order, so the layout's first guess follows how it was made.
 */
export function chartOf(page: DiagramPage, seeds: readonly string[]): string[] {
    const next = new Map<string, string[]>();
    const link = (a: string, b: string) => {
        const list = next.get(a);
        if (list) list.push(b);
        else next.set(a, [b]);
    };
    for (const e of page.edges) {
        if (!joins(page, e)) continue;
        link(e.from.nodeId!, e.to.nodeId!);
        link(e.to.nodeId!, e.from.nodeId!);
    }
    const seen = new Set<string>();
    const queue = seeds.filter(id => inChart(nodeById(page, id)));
    for (const id of queue) seen.add(id);
    while (queue.length > 0) {
        const id = queue.shift()!;
        for (const n of next.get(id) ?? []) {
            if (seen.has(n)) continue;
            seen.add(n);
            queue.push(n);
        }
    }
    return page.nodes.filter(nd => seen.has(nd.id)).map(nd => nd.id);
}

interface Box {
    id: string;
    w: number;
    h: number;
}

interface Link {
    from: string;
    to: string;
}

/**
 * A tidy tree, top down: each row as tall as its tallest box and every box
 * centred in its row, so steps line up across branches; each subtree as wide
 * as it needs; a box centred over its first and last child, so a chain runs
 * straight down and a decision sits between its Yes and its No. Children in
 * arrow order. Null when the chart is not a tree (a merge, a loop) — the
 * layered layout handles those.
 */
export function treePositions(
    boxes: readonly Box[],
    links: readonly Link[]
): Map<string, { x: number; y: number }> | null {
    const byId = new Map(boxes.map(b => [b.id, b]));
    const kids = new Map<string, string[]>();
    const parent = new Map<string, string>();
    for (const { from, to } of links) {
        if (!byId.has(from) || !byId.has(to) || from === to) continue;
        if (parent.get(to) === from) continue; // the same arrow twice
        if (parent.has(to)) return null; // a merge
        parent.set(to, from);
        const list = kids.get(from);
        if (list) list.push(to);
        else kids.set(from, [to]);
    }
    const roots = boxes.filter(b => !parent.has(b.id));
    if (roots.length !== 1) return null;
    const root = roots[0]!.id;

    // Depths, and every box reached exactly once (a loop is never reached).
    // Breadth first: the loop runs on over the boxes it appends.
    const depth = new Map<string, number>([[root, 0]]);
    const order = [root];
    for (const id of order) {
        for (const k of kids.get(id) ?? []) {
            if (depth.has(k)) return null;
            depth.set(k, depth.get(id)! + 1);
            order.push(k);
        }
    }
    if (order.length !== boxes.length) return null;

    const rowH: number[] = [];
    for (const id of order) {
        const d = depth.get(id)!;
        rowH[d] = Math.max(rowH[d] ?? 0, byId.get(id)!.h);
    }
    const rowY: number[] = [];
    rowH.forEach((h, d) => (rowY[d] = d === 0 ? 0 : rowY[d - 1]! + rowH[d - 1]! + RANK_GAP));

    const extent = new Map<string, number>();
    for (const id of [...order].reverse()) {
        const ks = kids.get(id) ?? [];
        const block =
            ks.reduce((sum, k) => sum + extent.get(k)!, 0) + NODE_GAP * Math.max(0, ks.length - 1);
        extent.set(id, Math.max(byId.get(id)!.w, block));
    }
    const centre = new Map<string, number>();
    const place = (id: string, left: number): void => {
        const ks = kids.get(id) ?? [];
        const own = extent.get(id)!;
        if (ks.length === 0) {
            centre.set(id, left + own / 2);
            return;
        }
        const block = ks.reduce((sum, k) => sum + extent.get(k)!, 0) + NODE_GAP * (ks.length - 1);
        let cursor = left + (own - block) / 2;
        for (const k of ks) {
            place(k, cursor);
            cursor += extent.get(k)! + NODE_GAP;
        }
        centre.set(id, (centre.get(ks[0]!)! + centre.get(ks[ks.length - 1]!)!) / 2);
    };
    place(root, 0);

    const out = new Map<string, { x: number; y: number }>();
    for (const id of order) {
        const b = byId.get(id)!;
        const d = depth.get(id)!;
        out.set(id, { x: centre.get(id)! - b.w / 2, y: rowY[d]! + (rowH[d]! - b.h) / 2 });
    }
    return out;
}

/**
 * The chart holding `seeds`, laid out top to bottom — a tidy tree when it is
 * one (everything the keys make is), else the layered layout for merges and
 * loops — with its first start kept where it was, so the chart grows from
 * the same spot. Hand-placed bends are dropped: they belonged to the old
 * positions. Returns `page` itself when nothing moves.
 */
export function tidyChart(page: DiagramPage, seeds: readonly string[]): DiagramPage {
    const ids = chartOf(page, seeds);
    if (ids.length < 2) return page;
    const members = new Set(ids);
    const nodes = page.nodes.filter(nd => members.has(nd.id));
    const edges = page.edges.filter(
        e => joins(page, e) && members.has(e.from.nodeId!) && members.has(e.to.nodeId!)
    );
    const boxes = nodes.map(nd => ({ id: nd.id, w: nd.w, h: nd.h }));
    const links = edges.map(e => ({ from: e.from.nodeId!, to: e.to.nodeId! }));
    const positions =
        treePositions(boxes, links) ??
        layeredLayout(boxes, links, { direction: "down", rankGap: RANK_GAP, nodeGap: NODE_GAP })
            .positions;
    const fed = new Set(links.map(l => l.to));
    const anchor = nodes.find(nd => !fed.has(nd.id)) ?? nodes[0]!;
    const laid = positions.get(anchor.id);
    if (!laid) return page;
    const dx = anchor.x - laid.x;
    const dy = anchor.y - laid.y;
    let moved = false;
    const placed = page.nodes.map(nd => {
        const at = positions.get(nd.id);
        if (!at) return nd;
        const x = Math.round(at.x + dx);
        const y = Math.round(at.y + dy);
        if (x === nd.x && y === nd.y) return nd;
        moved = true;
        return { ...nd, x, y };
    });
    const routed = new Set(edges.map(e => e.id));
    const bent = edges.some(e => e.waypoints.length > 0);
    if (!moved && !bent) return page;
    return {
        ...page,
        nodes: moved ? placed : page.nodes,
        edges: bent
            ? page.edges.map(e =>
                  routed.has(e.id) && e.waypoints.length > 0 ? { ...e, waypoints: [] } : e
              )
            : page.edges,
    };
}

/** The words a decision's branches are labelled with, in the reader's language. */
export interface BranchWords {
    yes: string;
    no: string;
}

/**
 * What the next arrow out of `sourceId` says: out of a decision, the first
 * of "Yes" and "No" not already taken; otherwise nothing.
 */
export function branchLabel(page: DiagramPage, sourceId: string, words: BranchWords): string {
    if (nodeById(page, sourceId)?.shape !== "decision") return "";
    const taken = new Set(
        page.edges
            .filter(e => e.from.nodeId === sourceId && e.to.nodeId !== sourceId)
            .flatMap(e => e.labels.map(l => l.text.trim()))
    );
    if (!taken.has(words.yes)) return words.yes;
    if (!taken.has(words.no)) return words.no;
    return "";
}

/** The first arrow from `from` to `to`. */
export function edgeBetween(page: DiagramPage, from: string, to: string): DiagramEdge | undefined {
    return page.edges.find(e => e.from.nodeId === from && e.to.nodeId === to);
}

/** The first box with an arrow into `nodeId` — the step it comes after. */
export function parentOf(page: DiagramPage, nodeId: string): string | null {
    return (graphIndex(page).in.get(nodeId) ?? []).find(id => id !== nodeId) ?? null;
}

/**
 * `page` with the arrow `edgeId` moved to sit right after `anchorId` in the
 * page's arrow order — which is the order the layout puts children in, so a
 * branch lands beside the step it was made from instead of at the end.
 */
export function moveEdgeAfter(page: DiagramPage, edgeId: string, anchorId: string): DiagramPage {
    const edge = page.edges.find(e => e.id === edgeId);
    if (!edge || edgeId === anchorId) return page;
    const without = { ...page, edges: page.edges.filter(e => e.id !== edgeId) };
    return insertEdgesBeside(without, [edge], anchorId, "after");
}

/**
 * `page` without the step `nodeId`, every box that led into it joined to
 * every box it led to, in its place in their order. A joining arrow keeps
 * the label of the arrow that came in (a decision's "Yes" still means yes),
 * else the one that went out; a join that already exists is not doubled.
 */
export function removeStepJoining(
    page: DiagramPage,
    nodeId: string
): { page: DiagramPage; parents: string[]; children: string[] } {
    const into = page.edges.filter(
        e => e.to.nodeId === nodeId && e.from.nodeId && e.from.nodeId !== nodeId
    );
    const outOf = page.edges.filter(
        e => e.from.nodeId === nodeId && e.to.nodeId && e.to.nodeId !== nodeId
    );
    const parents = [...new Set(into.map(e => e.from.nodeId!))];
    const children = [...new Set(outOf.map(e => e.to.nodeId!))];
    const existing = new Set(page.edges.map(e => `${e.from.nodeId}\u0000${e.to.nodeId}`));
    let next = page;
    for (const inEdge of into) {
        const p = inEdge.from.nodeId!;
        const bridges: DiagramEdge[] = [];
        for (const outEdge of outOf) {
            const c = outEdge.to.nodeId!;
            const key = `${p}\u0000${c}`;
            if (c === p || existing.has(key)) continue;
            existing.add(key);
            const inText = inEdge.labels.find(l => l.text.trim())?.text ?? "";
            const outText = outEdge.labels.find(l => l.text.trim())?.text ?? "";
            const label = inText || outText;
            const made = createEdge({
                from: { nodeId: p, port: "auto" },
                to: { nodeId: c, port: "auto" },
                kind: inEdge.kind,
                style: { ...inEdge.style },
                startArrow: inEdge.startArrow,
                endArrow: inEdge.endArrow,
                ...(label ? { label } : {}),
            });
            bridges.push({
                ...made,
                textStyle: { ...(inText || !outText ? inEdge.textStyle : outEdge.textStyle) },
            });
        }
        next = insertEdgesBeside(next, bridges, inEdge.id, "after");
    }
    return { page: removeNodes(next, [nodeId]), parents, children };
}

export type Walk = "up" | "down" | "left" | "right";

/**
 * Where an arrow key goes from `nodeId`: down to its first next step, up to
 * the first step before it, left and right to the steps beside it that share
 * its parent, by where they sit. Null when there is nowhere to go.
 */
export function walkFrom(page: DiagramPage, nodeId: string, dir: Walk): string | null {
    const idx = graphIndex(page);
    const visible = (id: string) => inChart(nodeById(page, id));
    if (dir === "down") {
        return (idx.out.get(nodeId) ?? []).find(id => id !== nodeId && visible(id)) ?? null;
    }
    if (dir === "up") {
        return (idx.in.get(nodeId) ?? []).find(id => id !== nodeId && visible(id)) ?? null;
    }
    const parent = (idx.in.get(nodeId) ?? []).find(id => id !== nodeId && visible(id));
    if (!parent) return null;
    const row = [...new Set(idx.out.get(parent) ?? [])]
        .filter(id => id !== parent && visible(id))
        .map(id => nodeById(page, id)!)
        .sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2) || a.y - b.y);
    const at = row.findIndex(nd => nd.id === nodeId);
    if (at < 0) return null;
    return row[dir === "left" ? at - 1 : at + 1]?.id ?? null;
}

/** The first start of the first chart on the page: where the arrow keys begin. */
export function firstStep(page: DiagramPage): string | null {
    const steps = page.nodes.filter(inChart);
    const fed = new Set(page.edges.filter(e => joins(page, e)).map(e => e.to.nodeId!));
    const connected = new Set(
        page.edges.filter(e => joins(page, e)).flatMap(e => [e.from.nodeId!, e.to.nodeId!])
    );
    const start =
        steps.find(nd => connected.has(nd.id) && !fed.has(nd.id)) ??
        steps.find(nd => !fed.has(nd.id)) ??
        steps[0];
    return start?.id ?? null;
}
