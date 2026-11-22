import { polylineCrosses } from "../model/avoid";
import { createEdge, createNode } from "../model/factory";
import { nodeBounds } from "../model/geometry";
import {
    CORNER_RADIUS,
    MIN_LEG,
    dropStaleBends,
    forgetRouteSides,
    hasStaleBends,
    routeEdge,
    type FlowDirection,
    type RoutedEdge,
} from "../model/routing";
import type { DiagramEdge, DiagramNode, DiagramPage, Point, PortId, ShapeId } from "../model/types";

/**
 * Connectors re-route to where their boxes are and always read cleanly — the
 * request was "the arrow should also be auto adjusted for the nodes'
 * positions so it looks smooth". These pin the rules down as properties over
 * a grid of relative positions rather than a handful of examples; a grid test
 * collects every position that breaks a rule, so a failure names them.
 */

beforeEach(() => forgetRouteSides());

function box(x: number, y: number, w = 170, h = 84, shape: ShapeId = "process"): DiagramNode {
    return createNode({ shape, x, y, w, h });
}

function lookupOf(...nodes: DiagramNode[]) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    return (id: string) => byId.get(id);
}

function elbow(
    from: DiagramNode,
    to: DiagramNode,
    extra: { fromPort?: PortId; toPort?: PortId; strokeWidth?: number } = {}
): DiagramEdge {
    const e = createEdge({
        from: { nodeId: from.id, port: extra.fromPort ?? "auto" },
        to: { nodeId: to.id, port: extra.toPort ?? "auto" },
        kind: "elbow",
    });
    return extra.strokeWidth ? { ...e, style: { ...e.style, strokeWidth: extra.strokeWidth } } : e;
}

function route(
    e: DiagramEdge,
    a: DiagramNode,
    b: DiagramNode,
    flow: FlowDirection | null = null
): RoutedEdge {
    return routeEdge(e, lookupOf(a, b), undefined, [], { flow });
}

/** `b` moved to (x, y), keeping its id. */
const at = (b: DiagramNode, x: number, y: number): DiagramNode => ({ ...b, x, y });

const legsOf = (pts: readonly Point[]) =>
    pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i]!.x, q.y - pts[i]!.y));

/** Which side of `n` a route end sits on. */
function sideAt(p: Point, n: DiagramNode): "n" | "e" | "s" | "w" {
    if (Math.abs(p.y - n.y) < 0.5) return "n";
    if (Math.abs(p.y - (n.y + n.h)) < 0.5) return "s";
    if (Math.abs(p.x - n.x) < 0.5) return "w";
    return "e";
}

/** Sides of a route, plus its number of bends: "sn2" is bottom to top with two. */
const shapeOf = (r: RoutedEdge, a: DiagramNode, b: DiagramNode) =>
    `${sideAt(r.start, a)}${sideAt(r.end, b)}${r.points.length - 2}`;

/** How far any point of the route runs back behind the side an end sits on. */
function uTurn(r: RoutedEdge): number {
    const behind = (p: Point, n: Point) =>
        Math.max(0, ...r.points.map(q => -((q.x - p.x) * n.x + (q.y - p.y) * n.y)));
    return Math.max(behind(r.start, r.startNormal), behind(r.end, r.endNormal));
}

/** Gaps between two boxes on each axis (negative where they overlap). */
function gaps(a: DiagramNode, b: DiagramNode) {
    return {
        gx: Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
        gy: Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
    };
}

/** Relative positions of a second box around one at the origin. */
function* around(step: number): Generator<[number, number]> {
    for (let dx = -500; dx <= 500; dx += step) {
        for (let dy = -400; dy <= 400; dy += step) yield [dx, dy];
    }
}

const through = (pts: readonly Point[], ...boxes: DiagramNode[]) =>
    polylineCrosses(
        pts,
        boxes.map(nodeBounds).map(r => ({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }))
    );

const orthogonal = (pts: readonly Point[]) =>
    pts.every(
        (p, i) =>
            i === 0 || Math.abs(p.x - pts[i - 1]!.x) < 0.01 || Math.abs(p.y - pts[i - 1]!.y) < 0.01
    );

describe("sides from where the boxes are", () => {
    const alpha = box(0, 0);

    it("joins a box below and to the right with one clean bend, not a cramped Z", () => {
        // The reported case: Beta below-right of Alpha, 60px apart across.
        // It left Alpha's right side, ran ~30px, dropped, ran ~30px in.
        const beta = box(230, 216);
        const r = route(elbow(alpha, beta), alpha, beta);
        expect(r.points).toHaveLength(3);
        for (const leg of legsOf(r.points)) expect(leg).toBeGreaterThanOrEqual(40);
    });

    it("runs bottom to top on a flowchart when the next step is below", () => {
        const beta = box(230, 216);
        const r = route(elbow(alpha, beta), alpha, beta, "down");
        expect(shapeOf(r, alpha, beta)).toBe("sn2");
        // A Z whose middle run sits halfway down the gap.
        expect(r.points[1]!.y).toBeCloseTo((alpha.y + alpha.h + beta.y) / 2);
    });

    it("goes side to side when mostly beside, end to end when mostly below", () => {
        const beside = box(460, 110);
        expect(shapeOf(route(elbow(alpha, beside), alpha, beside), alpha, beside)).toBe("ew2");
        const below = box(190, 600);
        expect(shapeOf(route(elbow(alpha, below), alpha, below), alpha, below)).toBe("sn2");
    });

    it("draws lined-up boxes with one straight line", () => {
        const under = box(30, 220);
        const r = route(elbow(alpha, under), alpha, under);
        expect(r.points).toHaveLength(2);
        expect(r.start.x).toBeCloseTo(r.end.x);
    });

    it.each([null, "down"] as const)(
        "never draws a stub, a squeezed head, a U-turn or more than two bends (flow %s)",
        flow => {
            const shapes: [number, number, ShapeId][] = [
                [170, 84, "process"],
                [100, 60, "process"],
                [220, 90, "rounded-rectangle"],
                [160, 100, "diamond"],
            ];
            const failures: string[] = [];
            let checked = 0;
            for (const [wa, ha, sa] of shapes) {
                for (const [wb, hb, sb] of shapes) {
                    // Two tips a few px out of line must jog: no orthogonal
                    // route between two points does otherwise.
                    if (sa === "diamond" && sb === "diamond") continue;
                    const a = box(0, 0, wa, ha, sa);
                    const b0 = box(0, 0, wb, hb, sb);
                    for (const strokeWidth of [1.5, 4]) {
                        const e = elbow(a, b0, { strokeWidth });
                        // Closer than a leg plus room for the head, there is
                        // no clean route to find.
                        const room = Math.max(50, MIN_LEG + 6 * strokeWidth + CORNER_RADIUS + 4);
                        for (const [dx, dy] of around(30)) {
                            const b = at(b0, dx, dy);
                            const { gx, gy } = gaps(a, b);
                            if (gx < room && gy < room) continue;
                            forgetRouteSides();
                            const r = route(e, a, b, flow);
                            const legs = legsOf(r.points);
                            const last = legs[legs.length - 1]!;
                            const broken = [
                                r.points.length - 2 > 2 && "bends",
                                Math.min(...legs) < MIN_LEG - 0.5 && "stub",
                                // The head and the corner before it fit on the last leg.
                                last < 6 * strokeWidth + CORNER_RADIUS - 0.5 && "head",
                                uTurn(r) > 0.5 && "u-turn",
                                through(r.points, a, b) && "through a box",
                                !orthogonal(r.points) && "slanted",
                            ].filter(Boolean);
                            checked++;
                            if (broken.length > 0) {
                                failures.push(
                                    `${sa}→${sb} at (${dx},${dy}) stroke ${strokeWidth}: ${broken.join(", ")}`
                                );
                            }
                        }
                    }
                }
            }
            expect(failures).toEqual([]);
            expect(checked).toBeGreaterThan(10000);
        }
    );

    it("joins every step clearly below bottom to top on a flowchart", () => {
        const a = box(0, 0);
        const b0 = box(0, 0);
        const e = elbow(a, b0);
        const failures: string[] = [];
        let checked = 0;
        for (const [dx, dy] of around(30)) {
            const b = at(b0, dx, dy);
            const { gy } = gaps(a, b);
            const angle = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
            // Below by two comfortable legs, and not mostly beside.
            if (gy < 80 || angle < 35) continue;
            forgetRouteSides();
            const got = shapeOf(route(e, a, b, "down"), a, b).slice(0, 2);
            checked++;
            if (got !== "sn") failures.push(`(${dx},${dy}): ${got}`);
        }
        expect(failures).toEqual([]);
        expect(checked).toBeGreaterThan(100);
    });

    it("lets a decision's Yes and No leave by its side tips on a flowchart", () => {
        const decision = box(0, 0, 160, 100, "diamond");
        const yes = box(-260, 220);
        const no = box(250, 220);
        const left = route(elbow(decision, yes), decision, yes, "down");
        const right = route(elbow(decision, no), decision, no, "down");
        expect(left.start).toEqual({ x: 0, y: 50 });
        expect(right.start).toEqual({ x: 160, y: 50 });
        expect(sideAt(left.end, yes)).toBe("n");
        expect(sideAt(right.end, no)).toBe("n");
    });
});

describe("tips", () => {
    it("keeps a line coming into a decision off the tip its own branch leaves by", () => {
        // A step up and to the right of the decision, the No branch out to
        // the right: both used the right-hand tip and ran on top of each other.
        const decision = box(0, 0, 160, 100, "diamond");
        const fix = box(560, -40);
        const step = box(250, -125);
        const no = elbow(decision, fix);
        const into = elbow(step, decision);
        const lookup = lookupOf(decision, fix, step);
        const alone = routeEdge(into, lookup, undefined, []);
        expect(alone.end).toEqual({ x: 160, y: 50 });

        forgetRouteSides();
        const all = [no, into];
        const branch = routeEdge(no, lookup, undefined, all);
        const coming = routeEdge(into, lookup, undefined, all);
        expect(branch.start).toEqual({ x: 160, y: 50 });
        // Into the top tip instead, with one clean bend.
        expect(coming.end).toEqual({ x: 80, y: 0 });
        expect(coming.points).toHaveLength(3);
    });
});

describe("ends pinned to a dot", () => {
    const a = box(0, 0);

    it("keeps the pin while its side faces the other box", () => {
        const b = box(240, 260);
        const r = route(elbow(a, b, { toPort: "w" }), a, b);
        expect(sideAt(r.end, b)).toBe("w");
        expect(r.end.y).toBeCloseTo(b.y + b.h / 2);
    });

    it("routes the end automatically once its box moves round behind the pin", () => {
        // Dropped on the top dot of a box below; then the box moves above.
        const below = box(20, 260);
        const e = elbow(a, below, { toPort: "n" });
        expect(sideAt(route(e, a, below).end, below)).toBe("n");
        const above = at(below, 20, -300);
        const moved = route(e, a, above);
        expect(sideAt(moved.end, above)).toBe("s");
        expect(uTurn(moved)).toBeLessThanOrEqual(0.5);
    });

    it("never makes a U-turn, whichever dots either end is pinned to", () => {
        const ports: PortId[] = ["auto", "n", "e", "s", "w"];
        const b0 = box(0, 0);
        const failures: string[] = [];
        for (const fromPort of ports) {
            for (const toPort of ports) {
                const e = elbow(a, b0, { fromPort, toPort });
                for (const [dx, dy] of around(50)) {
                    const b = at(b0, dx, dy);
                    const { gx, gy } = gaps(a, b);
                    if (gx < 50 && gy < 50) continue;
                    forgetRouteSides();
                    const r = route(e, a, b);
                    if (uTurn(r) > 0.5 || through(r.points, a, b)) {
                        failures.push(`${fromPort}→${toPort} at (${dx},${dy})`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });
});

describe("dragging a box", () => {
    it("does not flip back and forth when the pointer trembles", () => {
        const failures: string[] = [];
        for (const [shapeA, wa, ha] of [
            ["process", 170, 84],
            ["diamond", 160, 100],
        ] as const) {
            const a = box(0, 0, wa, ha, shapeA);
            const b0 = box(0, 0);
            const e = elbow(a, b0);
            const apart = (x: number, y: number) =>
                Math.max(x - wa, -x - b0.w, y - ha, -y - b0.h) >= 50;
            for (const flow of [null, "down"] as const) {
                for (let x = -500; x <= 500; x += 37) {
                    for (let y = -400; y <= 400; y += 37) {
                        for (const [ddx, ddy] of [
                            [3, 0],
                            [0, 3],
                            [-2, 3],
                        ] as const) {
                            if (!apart(x, y) || !apart(x + ddx, y + ddy)) continue;
                            forgetRouteSides();
                            const seen = new Set<string>();
                            for (let k = 0; k < 6; k++) {
                                const b = at(b0, x + (k % 2) * ddx, y + (k % 2) * ddy);
                                const s = shapeOf(route(e, a, b, flow), a, b);
                                // Whatever the first move settled on stays.
                                if (k > 0) seen.add(s);
                            }
                            if (seen.size > 1) {
                                failures.push(`${shapeA} ${flow} (${x},${y})+(${ddx},${ddy})`);
                            }
                        }
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("changes sides at most once per crossing, dragged across and back", () => {
        const a = box(0, 0);
        const b0 = box(0, 0);
        const e = elbow(a, b0);
        const failures: string[] = [];
        const path = [
            ...Array.from({ length: 1001 }, (_, i) => -500 + i),
            ...Array.from({ length: 1001 }, (_, i) => 500 - i),
        ];
        for (const flow of [null, "down"] as const) {
            for (let y = -400; y <= 400; y += 70) {
                forgetRouteSides();
                let prev = "";
                let lastChange = -Infinity;
                path.forEach((x, i) => {
                    const b = at(b0, x, y);
                    const { gx, gy } = gaps(a, b);
                    if (gx < 20 && gy < 20) {
                        prev = "";
                        return;
                    }
                    const now = shapeOf(route(e, a, b, flow), a, b).slice(0, 2);
                    if (prev && now !== prev) {
                        // Two changes within a few px of each other is a flicker.
                        if (i - lastChange <= 6) failures.push(`${flow} y=${y} x=${x}`);
                        lastChange = i;
                    }
                    prev = now;
                });
            }
        }
        expect(failures).toEqual([]);
    });

    it("keeps its sides near a tie until another pair is clearly better", () => {
        const a = box(0, 0);
        const b0 = box(500, 200);
        const e = elbow(a, b0);
        const drawn = (x: number) => {
            const b = at(b0, x, 200);
            return shapeOf(route(e, a, b), a, b);
        };
        // Fresh, this spot is joined with an L into Beta's top…
        expect(drawn(336)).toBe("en1");
        // …but dragged in from the right, Beta keeps the side-to-side Z it
        // had, the L being only a little better here.
        forgetRouteSides();
        for (let x = 500; x > 336; x -= 2) expect(drawn(x)).toBe("ew2");
        expect(drawn(336)).toBe("ew2");
        // Further on the L is clearly better and it changes, once…
        let x = 336;
        while (drawn(x) === "ew2" && x > 200) x -= 2;
        expect(drawn(x)).toBe("en1");
        // …and dragging a little back does not undo it.
        for (let back = x; back <= x + 16; back += 2) expect(drawn(back)).toBe("en1");
    });
});

describe("bends that no longer make a clean path", () => {
    const a = box(0, 0);
    const b = box(400, 0);
    // A bend dropping the line under the gap between two boxes in a row.
    const bent = (): DiagramEdge => ({
        ...elbow(a, b),
        waypoints: [{ x: 285, y: 160 }],
    });

    it("are followed while they still make sense", () => {
        const e = bent();
        expect(hasStaleBends(e, lookupOf(a, b))).toBe(false);
        const r = routeEdge(e, lookupOf(a, b));
        expect(r.points.some(p => Math.abs(p.x - 285) < 0.5 && Math.abs(p.y - 160) < 0.5)).toBe(
            true
        );
    });

    it("are ignored, and dropped, once a box moves over them", () => {
        const e = bent();
        const moved = at(b, 200, 120);
        const lookup = lookupOf(a, moved);
        expect(hasStaleBends(e, lookup)).toBe(true);
        // Drawn exactly as if it had no bends.
        expect(routeEdge(e, lookup).points).toEqual(
            routeEdge({ ...e, waypoints: [] }, lookup).points
        );
        const page = {
            id: "p",
            name: "Page",
            nodes: [a, moved],
            edges: [e],
        } as unknown as DiagramPage;
        expect(dropStaleBends(page, [moved.id]).edges[0]!.waypoints).toEqual([]);
        // Nothing moved there: the page is returned as it was.
        expect(dropStaleBends(page, [])).toBe(page);
        expect(dropStaleBends(page, ["elsewhere"])).toBe(page);
    });

    it("move with both boxes and stay", () => {
        const e = bent();
        const shift = { x: 300, y: 250 };
        const moved: DiagramEdge = {
            ...e,
            waypoints: e.waypoints.map(p => ({ x: p.x + shift.x, y: p.y + shift.y })),
        };
        const a2 = at(a, a.x + shift.x, a.y + shift.y);
        const b2 = at(b, b.x + shift.x, b.y + shift.y);
        expect(hasStaleBends(moved, lookupOf(a2, b2))).toBe(false);
    });
});
