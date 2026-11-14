import { layeredLayout, type LayeredEdge, type LayeredNode } from "../model/layered";

/**
 * The layered layout is judged by properties, like the tree layouts: every
 * node placed once, arrows running the way the chart flows, nothing on top
 * of anything else, and every subgraph's frame around its members and clear
 * of everyone else's.
 */

const box = (id: string, w = 120, h = 50): LayeredNode => ({ id, w, h });
const edge = (from: string, to: string): LayeredEdge => ({ from, to });

function overlap(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function rects(nodes: LayeredNode[], positions: Map<string, { x: number; y: number }>) {
    return nodes.map(n => ({ id: n.id, ...positions.get(n.id)!, w: n.w, h: n.h }));
}

describe("layered layout", () => {
    const nodes = ["start", "check", "yes", "no", "end"].map(id => box(id));
    const edges = [
        edge("start", "check"),
        edge("check", "yes"),
        edge("check", "no"),
        edge("yes", "end"),
        edge("no", "end"),
    ];

    test("places every node once, at or right of and below the origin", () => {
        const { positions } = layeredLayout(nodes, edges);
        expect([...positions.keys()].sort()).toEqual(nodes.map(n => n.id).sort());
        for (const p of positions.values()) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
        }
    });

    test("flowing down, every arrow points down a layer and nothing overlaps", () => {
        const { positions } = layeredLayout(nodes, edges, { direction: "down" });
        for (const e of edges) {
            expect(positions.get(e.to)!.y).toBeGreaterThan(positions.get(e.from)!.y);
        }
        const placed = rects(nodes, positions);
        for (let i = 0; i < placed.length; i += 1) {
            for (let j = i + 1; j < placed.length; j += 1) {
                expect(overlap(placed[i]!, placed[j]!)).toBe(false);
            }
        }
        // A merge sits between the branches that feed it.
        const end = positions.get("end")!.x;
        expect(end).toBeGreaterThan(Math.min(positions.get("yes")!.x, positions.get("no")!.x) - 1);
        expect(end).toBeLessThan(Math.max(positions.get("yes")!.x, positions.get("no")!.x) + 1);
    });

    test("flowing right, arrows run left to right", () => {
        const { positions } = layeredLayout(nodes, edges, { direction: "right" });
        for (const e of edges) {
            expect(positions.get(e.to)!.x).toBeGreaterThan(positions.get(e.from)!.x);
        }
    });

    test("a loop back does not stop the layout or flip the chart", () => {
        const looped = [...edges, edge("no", "check")];
        const { positions } = layeredLayout(nodes, looped, { direction: "down" });
        expect(positions.size).toBe(nodes.length);
        expect(positions.get("start")!.y).toBeLessThan(positions.get("end")!.y);
    });

    test("an arrow that skips layers reserves a lane, so no box sits on its straight path", () => {
        const skip = [box("a"), box("b"), box("c"), box("d")];
        const { positions } = layeredLayout(skip, [
            edge("a", "b"),
            edge("b", "c"),
            edge("a", "d"),
            edge("c", "d"),
        ]);
        // a → d passes c's layer: c and the lane sit side by side, not on top.
        expect(positions.get("d")!.y).toBeGreaterThan(positions.get("c")!.y);
    });

    test("keeps a subgraph's members together inside its frame, clear of other boxes", () => {
        const all = ["a", "b", "c", "d", "e"].map(id => box(id));
        const clusters = new Map([
            ["b", ["team"]],
            ["c", ["team"]],
        ]);
        const { positions, clusters: frames } = layeredLayout(
            all,
            [edge("a", "b"), edge("a", "d"), edge("b", "c"), edge("d", "e"), edge("c", "e")],
            { clusters, clusterPadding: 20 }
        );
        const frame = frames.get("team")!;
        expect(frame).toBeDefined();
        for (const id of ["b", "c"]) {
            const r = { ...positions.get(id)!, w: 120, h: 50 };
            expect(r.x).toBeGreaterThanOrEqual(frame.x);
            expect(r.y).toBeGreaterThanOrEqual(frame.y);
            expect(r.x + r.w).toBeLessThanOrEqual(frame.x + frame.w);
            expect(r.y + r.h).toBeLessThanOrEqual(frame.y + frame.h);
        }
        for (const id of ["a", "d", "e"]) {
            expect(overlap({ ...positions.get(id)!, w: 120, h: 50 }, frame)).toBe(false);
        }
    });

    test("nests a frame inside its parent's", () => {
        const all = [box("a"), box("b"), box("c")];
        const clusters = new Map([
            ["a", ["outer"]],
            ["b", ["outer", "inner"]],
            ["c", ["outer", "inner"]],
        ]);
        const { clusters: frames } = layeredLayout(all, [edge("a", "b"), edge("b", "c")], {
            clusters,
        });
        const outer = frames.get("outer")!;
        const inner = frames.get("inner")!;
        expect(inner.x).toBeGreaterThanOrEqual(outer.x);
        expect(inner.y).toBeGreaterThan(outer.y);
        expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w);
        expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h);
    });

    test("an empty graph is empty", () => {
        expect(layeredLayout([], []).positions.size).toBe(0);
    });
});
