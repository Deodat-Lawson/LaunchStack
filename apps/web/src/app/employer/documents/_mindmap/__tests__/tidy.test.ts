import { createEdge, createNode } from "../model/factory";
import { labelAnchor, routeEdge, type RoutedEdge } from "../model/routing";
import { nudgeRoutes, placeLabels } from "../model/tidy";
import type { DiagramEdge, DiagramNode, Point } from "../model/types";

/**
 * Connectors as a set: two elbows that took the same channel are pulled
 * apart, and labels that would print over each other are moved along their
 * own lines (the System architecture template showed both: "e SQL e").
 */

function lookupOf(nodes: DiagramNode[]) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    return (id: string) => byId.get(id);
}

function routesFor(nodes: DiagramNode[], edges: DiagramEdge[]): Map<string, RoutedEdge> {
    return new Map(edges.map(e => [e.id, routeEdge(e, lookupOf(nodes), nodes, edges)]));
}

/** The x of every vertical segment between two bends. */
function middleVerticals(points: readonly Point[]): number[] {
    const out: number[] = [];
    for (let i = 1; i + 2 < points.length; i++) {
        if (Math.abs(points[i]!.x - points[i + 1]!.x) < 0.5) out.push(points[i]!.x);
    }
    return out;
}

// Two boxes on the left, two on the right, crossed: A→D and C→B both take the
// channel halfway between the columns.
const A = createNode({ shape: "process", x: 0, y: 0, w: 120, h: 60 });
const C = createNode({ shape: "process", x: 0, y: 200, w: 120, h: 60 });
const B = createNode({ shape: "process", x: 560, y: 0, w: 120, h: 60 });
const D = createNode({ shape: "process", x: 560, y: 200, w: 120, h: 60 });
const nodes = [A, B, C, D];
const ad: DiagramEdge = {
    ...createEdge({ from: { nodeId: A.id }, to: { nodeId: D.id } }),
    kind: "elbow",
    labels: [{ text: "SQL", t: 0.5, offset: 0 }],
};
const cb: DiagramEdge = {
    ...createEdge({ from: { nodeId: C.id }, to: { nodeId: B.id } }),
    kind: "elbow",
    labels: [{ text: "enqueue", t: 0.5, offset: 0 }],
};

describe("nudgeRoutes", () => {
    it("pulls apart elbows that share a channel", () => {
        const edges = [ad, cb];
        const raw = routesFor(nodes, edges);
        const x1 = middleVerticals(raw.get(ad.id)!.points);
        const x2 = middleVerticals(raw.get(cb.id)!.points);
        expect(x1).toHaveLength(1);
        expect(x1[0]).toBeCloseTo(x2[0]!);

        const tidy = nudgeRoutes(raw, edges);
        const y1 = middleVerticals(tidy.get(ad.id)!.points)[0]!;
        const y2 = middleVerticals(tidy.get(cb.id)!.points)[0]!;
        expect(Math.abs(y1 - y2)).toBeGreaterThanOrEqual(15.5);
        // Still orthogonal, still attached where it was.
        for (const id of [ad.id, cb.id]) {
            const before = raw.get(id)!;
            const after = tidy.get(id)!;
            expect(after.start).toEqual(before.start);
            expect(after.end).toEqual(before.end);
            const pts = after.points;
            for (let i = 0; i < pts.length - 1; i++) {
                const flat = Math.abs(pts[i]!.y - pts[i + 1]!.y) < 0.01;
                const upright = Math.abs(pts[i]!.x - pts[i + 1]!.x) < 0.01;
                expect(flat || upright).toBe(true);
            }
        }
    });

    it("leaves connectors that do not overlap as the same objects", () => {
        const solo = [ad];
        const raw = routesFor(nodes, solo);
        expect(nudgeRoutes(raw, solo).get(ad.id)).toBe(raw.get(ad.id));
    });
});

describe("placeLabels", () => {
    it("moves a label off another one, along its own line", () => {
        const edges = [ad, cb];
        const routes = routesFor(nodes, edges);
        // Untidied, both labels sit in the shared channel at mid-height.
        const ts = placeLabels(edges, routes);
        const moved = [ts.get(ad.id)![0], ts.get(cb.id)![0]];
        expect(moved.some(t => t !== 0.5)).toBe(true);
    });

    it("leaves a label alone when nothing is in its way", () => {
        const ts = placeLabels([ad], routesFor(nodes, [ad]));
        expect(ts.get(ad.id)).toEqual([0.5]);
    });

    it("moves a label off a bend in its own line, where the bend's handle would cover it", () => {
        // A line bent at its middle: the label's spot at t = 0.5 is the corner.
        const bend = { x: 340, y: 160 };
        const bent: DiagramEdge = {
            ...createEdge({ from: { nodeId: A.id }, to: { nodeId: B.id } }),
            kind: "straight",
            waypoints: [bend],
            labels: [{ text: "No", t: 0.5, offset: 0 }],
        };
        const routes = routesFor(nodes, [bent]);
        const at = labelAnchor(routes.get(bent.id)!, 0.5, 0);
        expect(Math.hypot(at.x - bend.x, at.y - bend.y)).toBeLessThan(1);

        const t = placeLabels([bent], routes).get(bent.id)![0]!;
        expect(t).not.toBe(0.5);
        const moved = labelAnchor(routes.get(bent.id)!, t, 0);
        expect(Math.hypot(moved.x - bend.x, moved.y - bend.y)).toBeGreaterThan(20);
    });
});

describe("nudgeRoutes and fan-outs", () => {
    it("nests the corners of lines fanning out the same way instead of crossing them", () => {
        // P upper left, T1 and T2 below right, both reached by going right
        // then down: the line from the upper slot must take the outer channel.
        const P = createNode({ shape: "process", x: 0, y: 0, w: 170, h: 84 });
        const T1 = createNode({ shape: "process", x: 450, y: 180, w: 170, h: 84 });
        const T2 = createNode({ shape: "process", x: 450, y: 400, w: 170, h: 84 });
        const ns = [P, T1, T2];
        const e1: DiagramEdge = {
            ...createEdge({ from: { nodeId: P.id }, to: { nodeId: T1.id } }),
            kind: "elbow",
        };
        const e2: DiagramEdge = {
            ...createEdge({ from: { nodeId: P.id }, to: { nodeId: T2.id } }),
            kind: "elbow",
        };
        const es = [e1, e2];
        const tidy = nudgeRoutes(routesFor(ns, es), es);
        const a = tidy.get(e1.id)!.points;
        const b = tidy.get(e2.id)!.points;
        // No segment of one crosses a segment of the other.
        const cross = (p: Point, q: Point, r: Point, s: Point) => {
            const d = (u: Point, v: Point, w: Point) =>
                (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
            return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
        };
        for (let i = 0; i < a.length - 1; i++) {
            for (let j = 0; j < b.length - 1; j++) {
                expect(cross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)).toBe(false);
            }
        }
    });
});
