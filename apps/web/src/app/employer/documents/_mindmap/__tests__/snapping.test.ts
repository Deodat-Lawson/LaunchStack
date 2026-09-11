import { computeSnap, snapResize, type SnapInput } from "../model/snapping";
import type { Rect } from "../model/types";

function input(overrides: Partial<SnapInput> = {}): SnapInput {
    return {
        moving: { x: 0, y: 0, w: 100, h: 50 },
        others: [],
        gridSize: 10,
        snapToGrid: false,
        snapToObjects: true,
        threshold: 6,
        ...overrides,
    };
}

const neighbour: Rect = { x: 200, y: 0, w: 100, h: 50 };

describe("object snapping", () => {
    it("snaps a near-aligned top edge into line", () => {
        const result = computeSnap(
            input({ moving: { x: 0, y: 3, w: 100, h: 50 }, others: [neighbour] })
        );
        expect(result.dy).toBe(-3);
        expect(result.guides.some(g => g.axis === "h" && g.kind === "align")).toBe(true);
    });

    it("ignores edges outside the threshold", () => {
        const result = computeSnap(
            input({ moving: { x: 0, y: 40, w: 100, h: 50 }, others: [neighbour] })
        );
        expect(result.dy).toBe(0);
        expect(result.guides).toEqual([]);
    });

    it("snaps centres, not just edges", () => {
        // Neighbour centre y = 25; move the shape so its centre is 3px off.
        const result = computeSnap(
            input({
                moving: { x: 0, y: 100, w: 100, h: 50 },
                others: [{ x: 200, y: 103, w: 20, h: 50 }],
            })
        );
        expect(result.dy).toBe(3);
    });

    it("picks the closest candidate when several are in range", () => {
        // Two flat guides either side of the moving shape's top edge (y = 10):
        // one 3px above, one 2px below. The nearer one wins.
        const result = computeSnap(
            input({
                moving: { x: 0, y: 10, w: 100, h: 40 },
                others: [
                    { x: 200, y: 7, w: 10, h: 0 },
                    { x: 200, y: 12, w: 10, h: 0 },
                ],
            })
        );
        expect(result.dy).toBe(2);
    });

    it("emits a guide spanning both shapes", () => {
        const result = computeSnap(
            input({ moving: { x: 0, y: 2, w: 100, h: 50 }, others: [neighbour] })
        );
        const guide = result.guides.find(g => g.axis === "h");
        expect(guide).toBeDefined();
        expect(guide!.from).toBeLessThanOrEqual(0);
        expect(guide!.to).toBeGreaterThanOrEqual(300);
    });

    it("does nothing when object snapping is off", () => {
        const result = computeSnap(
            input({
                moving: { x: 0, y: 3, w: 100, h: 50 },
                others: [neighbour],
                snapToObjects: false,
            })
        );
        expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
    });
});

describe("equal spacing", () => {
    it("evens out the two gaps when they are nearly equal", () => {
        // A at 0–50, moving at 100–150, B at 202–252: gaps of 50 and 52.
        const result = computeSnap(
            input({
                moving: { x: 100, y: 0, w: 50, h: 50 },
                others: [
                    { x: 0, y: 0, w: 50, h: 50 },
                    { x: 202, y: 0, w: 50, h: 50 },
                ],
                threshold: 6,
            })
        );
        expect(result.dx).toBeCloseTo(1);
        expect(result.guides.some(g => g.kind === "spacing")).toBe(true);
    });

    it("only considers shapes that overlap on the other axis", () => {
        const result = computeSnap(
            input({
                moving: { x: 100, y: 0, w: 50, h: 50 },
                others: [
                    { x: 0, y: 900, w: 50, h: 50 },
                    { x: 202, y: 900, w: 50, h: 50 },
                ],
            })
        );
        expect(result.dx).toBe(0);
    });

    it("defers to edge alignment on the same axis", () => {
        // Aligned left edges *and* an equal-gap opportunity: alignment wins.
        const result = computeSnap(
            input({
                moving: { x: 100, y: 0, w: 50, h: 50 },
                others: [
                    { x: 0, y: 0, w: 50, h: 50 },
                    { x: 202, y: 0, w: 50, h: 50 },
                    { x: 98, y: 200, w: 50, h: 50 },
                ],
            })
        );
        expect(result.dx).toBe(-2);
        expect(result.guides.some(g => g.kind === "align")).toBe(true);
    });
});

describe("grid snapping", () => {
    it("quantises the position when no object claimed the axis", () => {
        const result = computeSnap(
            input({ moving: { x: 13, y: 27, w: 100, h: 50 }, snapToGrid: true })
        );
        expect(result.dx).toBe(-3);
        expect(result.dy).toBe(3);
    });

    it("yields to object snapping", () => {
        const result = computeSnap(
            input({
                moving: { x: 13, y: 3, w: 100, h: 50 },
                others: [neighbour],
                snapToGrid: true,
            })
        );
        // y aligned to the neighbour, x fell through to the grid.
        expect(result.dy).toBe(-3);
        expect(result.dx).toBe(-3);
    });

    it("does nothing with a zero grid size", () => {
        const result = computeSnap(
            input({ moving: { x: 13, y: 27, w: 10, h: 10 }, snapToGrid: true, gridSize: 0 })
        );
        expect(result.dx).toBe(0);
    });
});

describe("snapResize", () => {
    it("prefers a matching neighbour dimension", () => {
        expect(snapResize(98, 10, true, [100], 6)).toBe(100);
    });

    it("falls back to the grid", () => {
        expect(snapResize(98, 10, true, [400], 6)).toBe(100);
    });

    it("returns the raw value when snapping is off", () => {
        expect(snapResize(98.5, 10, false)).toBe(98.5);
    });

    it("picks the nearest candidate", () => {
        expect(snapResize(100, 10, false, [104, 102], 6)).toBe(102);
    });
});
