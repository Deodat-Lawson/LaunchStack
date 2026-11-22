import { orthogonalDetour, polylineCrosses, segmentCrossesRect } from "../model/avoid";
import { createEdge, createNode } from "../model/factory";
import { nodeBounds } from "../model/geometry";
import { isRedundantBend, routeEdge, routeEdgeCached } from "../model/routing";
import { projectOntoPolyline } from "../model/geometry";
import type { DiagramEdge, DiagramNode, EdgeKind } from "../model/types";

/**
 * Connectors go around the boxes between their ends instead of under or over
 * them — the request that came with a cycle diagram whose loop-back line ran
 * across the steps in its row.
 */

const A = createNode({ shape: "process", x: 0, y: 0, w: 100, h: 60 });
const B = createNode({ shape: "process", x: 220, y: -10, w: 120, h: 80 });
const C = createNode({ shape: "process", x: 500, y: 0, w: 100, h: 60 });

function lookupOf(nodes: DiagramNode[]) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    return (id: string) => byId.get(id);
}
function edge(
    from: DiagramNode,
    to: DiagramNode,
    kind: EdgeKind,
    extra: Partial<DiagramEdge> = {}
) {
    return { ...createEdge({ from: { nodeId: from.id }, to: { nodeId: to.id }, kind }), ...extra };
}
/** Strictly through the box — touching its outline does not count. */
const through = (points: { x: number; y: number }[], box: DiagramNode) => {
    const r = nodeBounds(box);
    return polylineCrosses(points, [{ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }]);
};

describe("going around a box in the way", () => {
    it.each(["elbow", "straight", "curved"] as const)("a %s connector goes around it", kind => {
        const nodes = [A, B, C];
        const e = edge(A, C, kind);
        const plain = routeEdge(e, lookupOf(nodes));
        expect(through(plain.points, B)).toBe(true);

        const routed = routeEdge(e, lookupOf(nodes), nodes);
        expect(through(routed.points, B)).toBe(false);
        // Still joins the same two boxes, from their outlines.
        const ra = nodeBounds(A);
        const rc = nodeBounds(C);
        const onOutline = (p: { x: number; y: number }, r: typeof ra) =>
            p.x >= r.x - 0.5 &&
            p.x <= r.x + r.w + 0.5 &&
            p.y >= r.y - 0.5 &&
            p.y <= r.y + r.h + 0.5;
        expect(onOutline(routed.start, ra)).toBe(true);
        expect(onOutline(routed.end, rc)).toBe(true);
        expect(routed.path.length).toBeGreaterThan(0);
    });

    it("keeps elbow detours orthogonal", () => {
        const nodes = [A, B, C];
        const pts = routeEdge(edge(A, C, "elbow"), lookupOf(nodes), nodes).points;
        for (let i = 0; i < pts.length - 1; i++) {
            const horizontal = Math.abs(pts[i]!.y - pts[i + 1]!.y) < 0.01;
            const vertical = Math.abs(pts[i]!.x - pts[i + 1]!.x) < 0.01;
            expect(horizontal || vertical).toBe(true);
        }
    });

    it("loops back over the row rather than through it", () => {
        // Write → Leader → Follower, and Follower's answer back to Write.
        const nodes = [A, B, C];
        const back = routeEdge(edge(C, A, "curved"), lookupOf(nodes), nodes);
        expect(through(back.points, B)).toBe(false);
    });

    it("keeps a loop-back off the sides the forward arrows use", () => {
        const nodes = [A, B, C];
        const forward = [edge(A, B, "elbow"), edge(B, C, "elbow")];
        const back = edge(C, A, "elbow");
        const routed = routeEdge(back, lookupOf(nodes), nodes, [...forward, back]);
        expect(through(routed.points, B)).toBe(false);
        // A→B leaves A's east side and B→C arrives on C's west side; the loop
        // goes over the top instead of running along them.
        const ra = nodeBounds(A);
        const rc = nodeBounds(C);
        expect(routed.start.x).toBeGreaterThan(rc.x + 1);
        expect(routed.end.x).toBeLessThan(ra.x + ra.w - 1);
    });

    it("leaves a clear line exactly as it was", () => {
        const aside = { ...B, y: 300 };
        const nodes = [A, aside, C];
        const e = edge(A, C, "elbow");
        expect(routeEdge(e, lookupOf(nodes), nodes).points).toEqual(
            routeEdge(e, lookupOf(nodes)).points
        );
    });

    it("leaves a hand-routed line alone", () => {
        const nodes = [A, B, C];
        const e = edge(A, C, "straight", { waypoints: [{ x: 280, y: 30 }] });
        expect(routeEdge(e, lookupOf(nodes), nodes).points).toEqual(
            routeEdge(e, lookupOf(nodes)).points
        );
    });

    it("does not go around the frame or lane it runs inside", () => {
        const lane = createNode({ shape: "frame", x: -50, y: -50, w: 800, h: 200 });
        const nodes = [lane, A, C];
        const e = edge(A, C, "elbow");
        expect(routeEdge(e, lookupOf(nodes), nodes).points).toEqual(
            routeEdge(e, lookupOf(nodes)).points
        );
    });
});

describe("routeEdgeCached with obstacles", () => {
    it("reuses a route until something near it changes", () => {
        const far = createNode({ shape: "process", x: 3000, y: 3000 });
        const e = edge(A, C, "elbow");
        const clear = [A, C, far];
        const first = routeEdgeCached(e, lookupOf(clear), clear);
        const movedFar = [A, C, { ...far, x: 3100 }];
        expect(routeEdgeCached(e, lookupOf(movedFar), movedFar)).toBe(first);

        const blocked = [A, C, B];
        const detoured = routeEdgeCached(e, lookupOf(blocked), blocked);
        expect(detoured).not.toBe(first);
        expect(through(detoured.points, B)).toBe(false);
    });
});

describe("orthogonalDetour", () => {
    it("returns null when walled in", () => {
        const wall = { x: -1000, y: -1000, w: 2000, h: 2000 };
        expect(
            orthogonalDetour({
                starts: [{ point: { x: 0, y: 0 }, normal: { x: 1, y: 0 }, penalty: 0 }],
                ends: [{ point: { x: 100, y: 0 }, normal: { x: -1, y: 0 }, penalty: 0 }],
                blocked: [wall],
                bounds: { x: -50, y: -50, w: 200, h: 100 },
                stub: 18,
            })
        ).toBeNull();
    });

    it("segmentCrossesRect ignores lines that only touch an edge", () => {
        const r = { x: 0, y: 0, w: 10, h: 10 };
        expect(segmentCrossesRect({ x: -5, y: 0 }, { x: 15, y: 0 }, r)).toBe(false);
        expect(segmentCrossesRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(true);
    });
});

describe("bends on an elbow connector", () => {
    // Two boxes side by side, a bend dragged down off the straight run.
    const L = createNode({ shape: "process", x: 0, y: 0, w: 100, h: 60 });
    const R = createNode({ shape: "process", x: 140, y: 0, w: 100, h: 60 });
    const nodes = [L, R];
    const bent = edge(L, R, "elbow", { waypoints: [{ x: 120, y: 120 }] });

    it("the line goes through a bend dragged off it, instead of folding it away", () => {
        const routed = routeEdge(bent, lookupOf(nodes));
        expect(projectOntoPolyline(routed.points, { x: 120, y: 120 }).distance).toBeLessThan(0.5);
    });

    it("a bend the line passes through is kept; one on the straight run is not", () => {
        expect(isRedundantBend(bent, 0, lookupOf(nodes), 6)).toBe(false);
        const onTheLine = edge(L, R, "elbow", { waypoints: [{ x: 120, y: 30 }] });
        expect(isRedundantBend(onTheLine, 0, lookupOf(nodes), 6)).toBe(true);
    });
});

describe("tidy connectors between boxes", () => {
    const lookup = (nodes: DiagramNode[]) => lookupOf(nodes);

    it("draws a straight line between boxes a few pixels off-centre", () => {
        // Ports sit mid-side; two steps 6px apart used to get a tiny zig-zag.
        const top = createNode({ shape: "process", x: 0, y: 0, w: 160, h: 70 });
        const below = createNode({ shape: "process", x: 6, y: 160, w: 160, h: 70 });
        const pts = routeEdge(edge(top, below, "elbow"), lookup([top, below])).points;
        expect(pts).toHaveLength(2);
        expect(pts[0]!.x).toBeCloseTo(pts[1]!.x);
    });

    it("never runs back through its own box when pinned to a side facing away", () => {
        const left = createNode({ shape: "process", x: 0, y: 0, w: 100, h: 60 });
        const right = createNode({ shape: "process", x: 300, y: 0, w: 100, h: 60 });
        // Pinned to the right-hand dot of the box on the right, aimed left.
        const e = {
            ...createEdge({ from: { nodeId: right.id, port: "e" }, to: { nodeId: left.id } }),
            kind: "elbow" as const,
        };
        const nodes = [left, right];
        const routed = routeEdge(e, lookup(nodes), nodes, [e]);
        expect(through(routed.points, right)).toBe(false);
        expect(through(routed.points, left)).toBe(false);
    });

    it("draws two connectors between the same boxes apart, both straight", () => {
        const a = createNode({ shape: "process", x: 0, y: 0, w: 120, h: 80 });
        const b = createNode({ shape: "process", x: 300, y: 0, w: 120, h: 80 });
        const there = edge(a, b, "elbow");
        const back = edge(b, a, "elbow");
        const all = [there, back];
        const p1 = routeEdge(there, lookup([a, b]), [a, b], all).points;
        const p2 = routeEdge(back, lookup([a, b]), [a, b], all).points;
        expect(p1).toHaveLength(2);
        expect(p2).toHaveLength(2);
        expect(Math.abs(p1[0]!.y - p2[0]!.y)).toBeGreaterThanOrEqual(20);
    });

    it("spreads connectors sharing a side, ordered so they do not cross", () => {
        const hub = createNode({ shape: "process", x: 0, y: 0, w: 120, h: 120 });
        const up = createNode({ shape: "process", x: 300, y: -150, w: 100, h: 60 });
        const down = createNode({ shape: "process", x: 300, y: 210, w: 100, h: 60 });
        const toUp = edge(hub, up, "elbow");
        const toDown = edge(hub, down, "elbow");
        const all = [toUp, toDown];
        const nodes = [hub, up, down];
        const yUp = routeEdge(toUp, lookup(nodes), nodes, all).start.y;
        const yDown = routeEdge(toDown, lookup(nodes), nodes, all).start.y;
        expect(yUp).toBeLessThan(yDown);
    });

    it("does not count a neighbour that goes round the other way", () => {
        // A row with a loop back: the loop leaves by the bottom, so the row's
        // arrows keep the middle of their sides.
        const nodes = [A, B, C];
        const ab = edge(A, B, "elbow");
        const bc = edge(B, C, "elbow");
        const loop = edge(C, A, "elbow");
        const all = [ab, bc, loop];
        const r = routeEdge(bc, lookupOf(nodes), nodes, all);
        expect(r.end.y).toBeCloseTo(C.y + C.h / 2);
    });
});

describe("ends on shapes that are not flat", () => {
    it("keeps a diamond's line on its tip, straight down to a box below", () => {
        const d = createNode({ shape: "diamond", x: 0, y: 0, w: 160, h: 100 });
        const box = createNode({ shape: "process", x: 20, y: 200, w: 160, h: 70 });
        const e = edge(d, box, "elbow");
        const r = routeEdge(e, lookupOf([d, box]), [d, box], [e]);
        // Leaves from the bottom tip (80, 100) and runs straight down.
        expect(r.start).toEqual({ x: 80, y: 100 });
        expect(r.points).toHaveLength(2);
        expect(r.end.x).toBeCloseTo(80);
    });

    it("never spreads ends along a diamond's side (they would float off it)", () => {
        const d = createNode({ shape: "diamond", x: 0, y: 0, w: 160, h: 100 });
        const p = createNode({ shape: "process", x: 400, y: -60, w: 120, h: 60 });
        const q = createNode({ shape: "process", x: 400, y: 100, w: 120, h: 60 });
        const e1 = edge(d, p, "elbow");
        const e2 = edge(d, q, "elbow");
        const all = [e1, e2];
        const tips = [
            { x: 80, y: 0 },
            { x: 160, y: 50 },
            { x: 80, y: 100 },
            { x: 0, y: 50 },
        ];
        const starts = all.map(e => routeEdge(e, lookupOf([d, p, q]), [d, p, q], all).start);
        // A tip is the only point of a diamond's "side": every end sits on one…
        for (const start of starts) expect(tips).toContainEqual(start);
        // …and two lines do not share one (they used to run on top of each
        // other out of the east tip until they forked).
        expect(starts[0]).not.toEqual(starts[1]);
    });
});

describe("a pair and a third line on one side", () => {
    it("keeps all three apart", () => {
        const P = createNode({ shape: "process", x: 0, y: 0, w: 170, h: 84 });
        const Q = createNode({ shape: "process", x: 400, y: 0, w: 170, h: 84 });
        const S = createNode({ shape: "process", x: 400, y: 220, w: 170, h: 84 });
        const pq = edge(P, Q, "elbow");
        const qp = edge(Q, P, "elbow");
        const ps = edge(P, S, "elbow");
        const all = [pq, qp, ps];
        const nodes = [P, Q, S];
        const ys = all
            .map(e => routeEdge(e, lookupOf(nodes), nodes, all))
            .map((r, i) => (all[i]!.from.nodeId === P.id ? r.start : r.end))
            .filter(p => Math.abs(p.x - (P.x + P.w)) < 0.5)
            .map(p => p.y)
            .sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(14);
    });
});

describe("aiming at a bend", () => {
    const box = createNode({ shape: "process", x: 0, y: 0, w: 170, h: 84 });
    const far = createNode({ shape: "process", x: 400, y: 300, w: 170, h: 84 });

    it("takes the side a bend sits straight beside", () => {
        // Below the box, inside its width: the bottom, though the angle says right.
        const below = edge(far, box, "elbow", { waypoints: [{ x: 160, y: 120 }] });
        expect(routeEdge(below, lookupOf([box, far])).end).toEqual({ x: 85, y: 84 });
    });

    it("reads a bend off a corner by angle, so a small bend does not flip the side", () => {
        // Down-right of the box, wider than tall: still the right side.
        const off = edge(far, box, "elbow", { waypoints: [{ x: 430, y: 200 }] });
        expect(routeEdge(off, lookupOf([box, far])).end.x).toBe(170);
    });
});

describe("curved detours", () => {
    it("are drawn with the same rounded corners wherever they are redrawn", () => {
        const nodes = [A, B, C];
        const r = routeEdge(edge(A, C, "curved"), lookupOf(nodes), nodes);
        expect(r.cornerRadius).toBeGreaterThan(0);
        // No cubic spline segments: rounded corners are quadratic fillets.
        expect(r.path).not.toMatch(/C /);
    });
});
