import { createEdge, createNode } from "../model/factory";
import { distanceToPolyline } from "../model/geometry";
import {
    labelAnchor,
    renderPath,
    routeEdge,
    trimPolyline,
    waypointInsertIndex,
} from "../model/routing";
import type { DiagramEdge, DiagramNode } from "../model/types";

function lookupOf(...nodes: DiagramNode[]) {
    const map = new Map(nodes.map(n => [n.id, n]));
    return (id: string) => map.get(id);
}

const a = createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 60 });
const b = createNode({ shape: "rectangle", x: 300, y: 200, w: 100, h: 60 });

function edgeBetween(overrides: Partial<DiagramEdge> = {}): DiagramEdge {
    return {
        ...createEdge({
            from: { nodeId: a.id, port: "auto" },
            to: { nodeId: b.id, port: "auto" },
        }),
        ...overrides,
    };
}

describe("routeEdge", () => {
    it("starts and ends on the shapes' borders", () => {
        const routed = routeEdge(edgeBetween({ kind: "straight" }), lookupOf(a, b));
        // "auto" picks the facing sides: east of A, west of B.
        expect(routed.start).toEqual({ x: 100, y: 30 });
        expect(routed.end).toEqual({ x: 300, y: 230 });
    });

    it("always yields at least two points", () => {
        for (const kind of ["straight", "elbow", "curved"] as const) {
            const routed = routeEdge(edgeBetween({ kind }), lookupOf(a, b));
            expect(routed.points.length).toBeGreaterThanOrEqual(2);
        }
    });

    it("routes elbows with axis-aligned segments only", () => {
        const routed = routeEdge(edgeBetween({ kind: "elbow" }), lookupOf(a, b));
        for (let i = 0; i < routed.points.length - 1; i++) {
            const p = routed.points[i]!;
            const q = routed.points[i + 1]!;
            const horizontal = Math.abs(p.y - q.y) < 0.01;
            const vertical = Math.abs(p.x - q.x) < 0.01;
            expect(horizontal || vertical).toBe(true);
        }
    });

    it("threads user waypoints in order", () => {
        const waypoint = { x: 150, y: -80 };
        const routed = routeEdge(
            edgeBetween({ kind: "straight", waypoints: [waypoint] }),
            lookupOf(a, b)
        );
        expect(routed.points).toContainEqual(waypoint);
        expect(distanceToPolyline(waypoint, routed.points)).toBeLessThan(0.01);
    });

    it("falls back to free points when a node is missing", () => {
        const edge = edgeBetween({
            from: { point: { x: 5, y: 5 } },
            to: { nodeId: "gone", point: { x: 60, y: 60 } },
            kind: "straight",
        });
        const routed = routeEdge(edge, lookupOf(a));
        expect(routed.start).toEqual({ x: 5, y: 5 });
        expect(routed.end).toEqual({ x: 60, y: 60 });
    });

    it("draws a visible loop when both ends are the same node", () => {
        const edge = edgeBetween({ from: { nodeId: a.id }, to: { nodeId: a.id } });
        const routed = routeEdge(edge, lookupOf(a));
        expect(routed.points.length).toBeGreaterThan(2);
        const xs = routed.points.map(p => p.x);
        const ys = routed.points.map(p => p.y);
        // The loop must occupy real area, not collapse onto the border.
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
    });

    it("points both arrowheads away from their own shape", () => {
        const routed = routeEdge(edgeBetween({ kind: "straight" }), lookupOf(a, b));
        // B sits east of A, so the connector leaves A's east side and arrives at
        // B's west side. An arrowhead's barbs follow these vectors, so the head
        // at A opens eastward (along the line) and the head at B opens westward
        // (back along it) — never into the shape it is touching.
        expect(routed.startNormal.x).toBeGreaterThan(0);
        expect(routed.endNormal.x).toBeLessThan(0);
    });

    it("keeps arrowhead direction stable when the connector is reversed", () => {
        const forward = routeEdge(edgeBetween({ kind: "straight" }), lookupOf(a, b));
        const backward = routeEdge(
            edgeBetween({
                kind: "straight",
                from: { nodeId: b.id, port: "auto" },
                to: { nodeId: a.id, port: "auto" },
            }),
            lookupOf(a, b)
        );
        // Reversing swaps which end is which, so the outward directions swap sign.
        expect(Math.sign(backward.startNormal.x)).toBe(-Math.sign(forward.startNormal.x));
        expect(Math.sign(backward.endNormal.x)).toBe(-Math.sign(forward.endNormal.x));
    });

    it("produces unit-length normals", () => {
        const routed = routeEdge(edgeBetween(), lookupOf(a, b));
        expect(Math.hypot(routed.startNormal.x, routed.startNormal.y)).toBeCloseTo(1);
        expect(Math.hypot(routed.endNormal.x, routed.endNormal.y)).toBeCloseTo(1);
    });

    it("emits path data free of NaN for every kind", () => {
        for (const kind of ["straight", "elbow", "curved"] as const) {
            const routed = routeEdge(edgeBetween({ kind }), lookupOf(a, b));
            expect(routed.path).not.toMatch(/NaN|undefined/);
            expect(routed.path.startsWith("M")).toBe(true);
        }
    });
});

describe("trimPolyline", () => {
    const line = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ];

    it("shortens both ends", () => {
        const trimmed = trimPolyline(line, 10, 20);
        expect(trimmed[0]).toEqual({ x: 10, y: 0 });
        expect(trimmed[trimmed.length - 1]).toEqual({ x: 80, y: 0 });
    });

    it("is a no-op for zero trims", () => {
        expect(trimPolyline(line, 0, 0)).toEqual(line);
    });

    it("refuses to collapse the line", () => {
        const trimmed = trimPolyline(line, 200, 200);
        expect(trimmed.length).toBeGreaterThanOrEqual(2);
    });

    it("consumes whole segments when the trim is longer than one", () => {
        const bent = [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 100, y: 0 },
        ];
        const trimmed = trimPolyline(bent, 20, 0);
        expect(trimmed[0]!.x).toBeCloseTo(20);
    });
});

describe("renderPath", () => {
    const points = [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
    ];

    it("uses quadratic fillets for elbows", () => {
        expect(renderPath("elbow", points)).toContain("Q");
    });

    it("uses cubics for curves", () => {
        expect(renderPath("curved", points)).toContain("C");
    });

    it("uses straight lines otherwise", () => {
        const d = renderPath("straight", points);
        expect(d).not.toContain("Q");
        expect(d).not.toContain("C");
    });
});

describe("waypointInsertIndex", () => {
    const routedFor = (waypoints: { x: number; y: number }[]) => {
        const edge = edgeBetween({ kind: "straight", waypoints });
        return { edge, routed: routeEdge(edge, lookupOf(a, b)) };
    };

    it("appends when the connector has no bends yet", () => {
        const { edge, routed } = routedFor([]);
        expect(waypointInsertIndex(routed, edge.waypoints, { x: 200, y: 120 })).toBe(0);
    });

    it("inserts before a bend further along the line", () => {
        const { edge, routed } = routedFor([{ x: 260, y: 200 }]);
        // A click near the start belongs before the existing bend.
        expect(waypointInsertIndex(routed, edge.waypoints, { x: 130, y: 60 })).toBe(0);
    });

    it("appends after the last bend", () => {
        const { edge, routed } = routedFor([{ x: 130, y: 60 }]);
        expect(waypointInsertIndex(routed, edge.waypoints, { x: 280, y: 215 })).toBe(1);
    });

    it("places a bend between two existing ones", () => {
        const { edge, routed } = routedFor([
            { x: 130, y: 60 },
            { x: 280, y: 215 },
        ]);
        expect(waypointInsertIndex(routed, edge.waypoints, { x: 200, y: 140 })).toBe(1);
    });
});

describe("labelAnchor", () => {
    it("sits on the path with no offset", () => {
        const routed = routeEdge(edgeBetween({ kind: "straight" }), lookupOf(a, b));
        const at = labelAnchor(routed, 0.5, 0);
        expect(distanceToPolyline(at, routed.points)).toBeLessThan(0.01);
    });

    it("moves perpendicular to the path when offset", () => {
        const routed = routeEdge(edgeBetween({ kind: "straight" }), lookupOf(a, b));
        const at = labelAnchor(routed, 0.5, 20);
        expect(distanceToPolyline(at, routed.points)).toBeGreaterThan(10);
    });
});
