import { createNode } from "../model/factory";
import { localToWorld } from "../model/geometry";
import {
    HANDLE_ANCHORS,
    angleFromCentre,
    handlePosition,
    oppositeHandle,
    resizeBounds,
    resizeNode,
    rotatedCursor,
    rotationGripPosition,
    type ResizeHandle,
} from "../model/resize";
import type { DiagramNode, Rect } from "../model/types";

function node(overrides: Partial<DiagramNode> = {}): DiagramNode {
    return {
        ...createNode({ shape: "rectangle", x: 100, y: 100, w: 200, h: 100 }),
        ...overrides,
    };
}

const OPTIONS = { keepAspect: false, fromCentre: false };

/** World position of the handle opposite the one being dragged. */
function anchorWorld(n: DiagramNode, handle: ResizeHandle) {
    const u = HANDLE_ANCHORS[oppositeHandle(handle)];
    return localToWorld(n, { x: u.x * n.w, y: u.y * n.h });
}

describe("oppositeHandle", () => {
    it("pairs each handle with its diagonal", () => {
        expect(oppositeHandle("nw")).toBe("se");
        expect(oppositeHandle("n")).toBe("s");
        expect(oppositeHandle("e")).toBe("w");
    });
});

describe("resizeNode", () => {
    it("resizes from the dragged corner", () => {
        const n = node();
        const next = resizeNode(n, "se", { x: 400, y: 300 }, OPTIONS);
        expect(next.x).toBe(100);
        expect(next.y).toBe(100);
        expect(next.w).toBe(300);
        expect(next.h).toBe(200);
    });

    it("moves the origin when dragging the north-west corner", () => {
        const n = node();
        const next = resizeNode(n, "nw", { x: 50, y: 50 }, OPTIONS);
        expect(next.x).toBe(50);
        expect(next.y).toBe(50);
        expect(next.w).toBe(250);
        expect(next.h).toBe(150);
    });

    it("only changes one dimension for an edge handle", () => {
        const n = node();
        const next = resizeNode(n, "e", { x: 500, y: 999 }, OPTIONS);
        expect(next.h).toBe(100);
        expect(next.w).toBe(400);
    });

    it("never shrinks below the shape's minimum", () => {
        const n = node();
        const next = resizeNode(n, "se", { x: 100, y: 100 }, OPTIONS);
        expect(next.w).toBeGreaterThanOrEqual(12);
        expect(next.h).toBeGreaterThanOrEqual(12);
    });

    it("keeps the opposite corner pinned on an unrotated shape", () => {
        const n = node();
        const before = anchorWorld(n, "se");
        const next = resizeNode(n, "se", { x: 480, y: 260 }, OPTIONS);
        const after = anchorWorld(next, "se");
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });

    it("keeps the opposite corner pinned on a rotated shape", () => {
        for (const rotation of [30, 90, 145, -60]) {
            const n = node({ rotation });
            const before = anchorWorld(n, "se");
            const next = resizeNode(n, "se", { x: 500, y: 400 }, OPTIONS);
            const after = anchorWorld(next, "se");
            expect(after.x).toBeCloseTo(before.x, 4);
            expect(after.y).toBeCloseTo(before.y, 4);
        }
    });

    it("preserves rotation", () => {
        const next = resizeNode(node({ rotation: 37 }), "se", { x: 500, y: 400 }, OPTIONS);
        expect(next.rotation).toBe(37);
    });

    it("resizes along the shape's own axes when rotated", () => {
        // Rotated 90°, dragging the east handle should still change the
        // shape's own width, not its on-screen width.
        const n = node({ rotation: 90 });
        const next = resizeNode(n, "e", { x: 150, y: 400 }, OPTIONS);
        expect(next.h).toBe(100);
        expect(next.w).not.toBe(200);
    });

    it("holds the aspect ratio when asked", () => {
        const n = node(); // 2:1
        const next = resizeNode(n, "se", { x: 500, y: 130 }, { ...OPTIONS, keepAspect: true });
        expect(next.w / next.h).toBeCloseTo(2);
    });

    it("grows about the centre with fromCentre", () => {
        const n = node();
        const next = resizeNode(n, "e", { x: 400, y: 150 }, { ...OPTIONS, fromCentre: true });
        expect(next.x + next.w / 2).toBeCloseTo(200);
        expect(next.w).toBeCloseTo(400);
    });

    it("quantises through the snap callback", () => {
        const n = node();
        const next = resizeNode(
            n,
            "se",
            { x: 403, y: 300 },
            {
                ...OPTIONS,
                snap: v => Math.round(v / 50) * 50,
            }
        );
        expect(next.w).toBe(300);
    });
});

describe("resizeBounds", () => {
    const start: Rect = { x: 0, y: 0, w: 100, h: 100 };

    it("expands from the anchored corner", () => {
        expect(resizeBounds(start, "se", { x: 200, y: 150 }, OPTIONS)).toEqual({
            x: 0,
            y: 0,
            w: 200,
            h: 150,
        });
    });

    it("moves the origin for a north-west drag", () => {
        expect(resizeBounds(start, "nw", { x: -50, y: -50 }, OPTIONS)).toEqual({
            x: -50,
            y: -50,
            w: 150,
            h: 150,
        });
    });

    it("locks the aspect ratio when asked", () => {
        const next = resizeBounds(
            start,
            "se",
            { x: 300, y: 110 },
            { ...OPTIONS, keepAspect: true }
        );
        expect(next.w).toBeCloseTo(next.h);
    });

    it("keeps a minimum size", () => {
        const next = resizeBounds(start, "se", { x: 0, y: 0 }, OPTIONS);
        expect(next.w).toBeGreaterThanOrEqual(8);
        expect(next.h).toBeGreaterThanOrEqual(8);
    });
});

describe("handles and grips", () => {
    it("puts handles on the shape's corners and edge midpoints", () => {
        const n = node();
        expect(handlePosition(n, "nw")).toEqual({ x: 100, y: 100 });
        expect(handlePosition(n, "se")).toEqual({ x: 300, y: 200 });
        expect(handlePosition(n, "n")).toEqual({ x: 200, y: 100 });
    });

    it("rotates handle positions with the shape", () => {
        const n = node({ rotation: 180 });
        const nw = handlePosition(n, "nw");
        expect(nw.x).toBeCloseTo(300);
        expect(nw.y).toBeCloseTo(200);
    });

    it("floats the rotation grip above the shape", () => {
        const grip = rotationGripPosition(node(), 24);
        expect(grip.y).toBeLessThan(100);
        expect(grip.x).toBeCloseTo(200);
    });

    it("measures angles with zero pointing up", () => {
        const centre = { x: 0, y: 0 };
        expect(angleFromCentre(centre, { x: 0, y: -10 })).toBeCloseTo(0);
        expect(angleFromCentre(centre, { x: 10, y: 0 })).toBeCloseTo(90);
    });

    it("rotates the cursor with the shape", () => {
        expect(rotatedCursor("e", 0)).toBe("ew-resize");
        expect(rotatedCursor("e", 90)).toBe("ns-resize");
        expect(rotatedCursor("n", 0)).toBe("ns-resize");
    });
});
