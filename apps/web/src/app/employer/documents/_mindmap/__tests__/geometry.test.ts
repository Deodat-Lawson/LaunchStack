import {
    autoPort,
    fitViewport,
    nextZoomStep,
    nodeBounds,
    nodeCorners,
    pointAlongPolyline,
    pointInPolygon,
    polylineLength,
    portPoint,
    projectOntoPolyline,
    rayRectIntersection,
    rotatePoint,
    screenToWorld,
    snap,
    unionRects,
    worldToLocal,
    worldToScreen,
    zoomAt,
} from "../model/geometry";
import { createNode } from "../model/factory";
import type { DiagramNode } from "../model/types";

function node(overrides: Partial<DiagramNode> = {}): DiagramNode {
    return { ...createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 60 }), ...overrides };
}

describe("scalars", () => {
    it("snaps to the nearest multiple", () => {
        expect(snap(13, 10)).toBe(10);
        expect(snap(16, 10)).toBe(20);
        expect(snap(-13, 10)).toBe(-10);
    });

    it("treats a zero step as no snapping", () => {
        expect(snap(13.7, 0)).toBe(13.7);
    });
});

describe("rotatePoint", () => {
    it("is the identity at zero degrees", () => {
        expect(rotatePoint({ x: 5, y: 7 }, { x: 0, y: 0 }, 0)).toEqual({ x: 5, y: 7 });
    });

    it("rotates clockwise in screen axes", () => {
        const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(10);
    });

    it("round-trips through the inverse angle", () => {
        const origin = { x: 3, y: -4 };
        const there = rotatePoint({ x: 11, y: 2 }, origin, 37);
        const back = rotatePoint(there, origin, -37);
        expect(back.x).toBeCloseTo(11);
        expect(back.y).toBeCloseTo(2);
    });
});

describe("node geometry", () => {
    it("returns the plain rect when unrotated", () => {
        expect(nodeBounds(node())).toEqual({ x: 0, y: 0, w: 100, h: 60 });
    });

    it("grows the bounding box when rotated", () => {
        const bounds = nodeBounds(node({ rotation: 45 }));
        expect(bounds.w).toBeGreaterThan(100);
        expect(bounds.h).toBeGreaterThan(60);
        // The centre is preserved by rotation.
        expect(bounds.x + bounds.w / 2).toBeCloseTo(50);
        expect(bounds.y + bounds.h / 2).toBeCloseTo(30);
    });

    it("keeps corners on the shape after rotation", () => {
        const corners = nodeCorners(node({ rotation: 90 }));
        expect(corners).toHaveLength(4);
        for (const corner of corners) {
            expect(Number.isFinite(corner.x)).toBe(true);
            expect(Number.isFinite(corner.y)).toBe(true);
        }
    });

    it("round-trips world → local → world", () => {
        const n = node({ x: 40, y: 25, rotation: 30 });
        const world = { x: 77, y: 12 };
        const local = worldToLocal(n, world);
        // localToWorld is exercised through portPoint below; here we assert the
        // inverse relationship directly by rotating back.
        const back = rotatePoint(
            { x: n.x + local.x, y: n.y + local.y },
            { x: n.x + n.w / 2, y: n.y + n.h / 2 },
            n.rotation
        );
        expect(back.x).toBeCloseTo(world.x);
        expect(back.y).toBeCloseTo(world.y);
    });
});

describe("ports", () => {
    it("places cardinal ports on the border", () => {
        const n = node();
        expect(portPoint(n, "n")).toEqual({ x: 50, y: 0 });
        expect(portPoint(n, "e")).toEqual({ x: 100, y: 30 });
        expect(portPoint(n, "s")).toEqual({ x: 50, y: 60 });
        expect(portPoint(n, "w")).toEqual({ x: 0, y: 30 });
    });

    it("picks the side facing the target", () => {
        const n = node();
        expect(autoPort(n, { x: 500, y: 30 })).toBe("e");
        expect(autoPort(n, { x: -500, y: 30 })).toBe("w");
        expect(autoPort(n, { x: 50, y: -500 })).toBe("n");
        expect(autoPort(n, { x: 50, y: 500 })).toBe("s");
    });

    it("accounts for rotation when picking a side", () => {
        // Rotated 90°, the shape's own "north" edge now faces east on screen,
        // so a target to the east should resolve to the north port.
        const n = node({ rotation: 90 });
        expect(autoPort(n, { x: 900, y: 30 })).toBe("n");
    });
});

describe("rayRectIntersection", () => {
    it("lands on the border, not the centre", () => {
        const hit = rayRectIntersection({ x: 0, y: 0, w: 100, h: 60 }, { x: 500, y: 30 });
        expect(hit.x).toBeCloseTo(100);
        expect(hit.y).toBeCloseTo(30);
    });

    it("returns the centre for a degenerate ray", () => {
        const hit = rayRectIntersection({ x: 0, y: 0, w: 100, h: 60 }, { x: 50, y: 30 });
        expect(hit).toEqual({ x: 50, y: 30 });
    });
});

describe("polylines", () => {
    const line = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];

    it("measures total length", () => {
        expect(polylineLength(line)).toBe(20);
    });

    it("finds the midpoint by arc length, not by index", () => {
        expect(pointAlongPolyline(line, 0.5)).toEqual({ x: 10, y: 0 });
    });

    it("clamps t outside 0–1", () => {
        expect(pointAlongPolyline(line, -3)).toEqual({ x: 0, y: 0 });
        expect(pointAlongPolyline(line, 9)).toEqual({ x: 10, y: 10 });
    });
});

describe("projectOntoPolyline", () => {
    const line = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
    ];

    it("finds the foot of the perpendicular", () => {
        const hit = projectOntoPolyline(line, { x: 40, y: 25 });
        expect(hit.point).toEqual({ x: 40, y: 0 });
        expect(hit.distance).toBeCloseTo(25);
    });

    it("reports position as a fraction of total length", () => {
        expect(projectOntoPolyline(line, { x: 100, y: 0 }).t).toBeCloseTo(0.5);
        expect(projectOntoPolyline(line, { x: 100, y: 100 }).t).toBeCloseTo(1);
    });

    it("clamps to the ends for points beyond the line", () => {
        expect(projectOntoPolyline(line, { x: -50, y: 0 }).point).toEqual({ x: 0, y: 0 });
    });

    it("picks the nearer segment when the line doubles back", () => {
        const doubled = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: 10 },
        ];
        const hit = projectOntoPolyline(doubled, { x: 50, y: 9 });
        expect(hit.point.y).toBeGreaterThan(3);
    });

    it("handles a degenerate input", () => {
        expect(projectOntoPolyline([], { x: 0, y: 0 }).distance).toBe(Infinity);
        expect(projectOntoPolyline([{ x: 3, y: 4 }], { x: 0, y: 0 }).distance).toBeCloseTo(5);
    });
});

describe("pointInPolygon", () => {
    const square = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];

    it("detects inside and outside", () => {
        expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
        expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    });
});

describe("viewport", () => {
    const viewport = { x: 100, y: 50, zoom: 2 };

    it("round-trips world ↔ screen", () => {
        const world = { x: 180, y: 90 };
        const back = screenToWorld(viewport, worldToScreen(viewport, world));
        expect(back.x).toBeCloseTo(world.x);
        expect(back.y).toBeCloseTo(world.y);
    });

    it("keeps the anchor point fixed while zooming", () => {
        const anchor = { x: 300, y: 200 };
        const before = screenToWorld(viewport, anchor);
        const next = zoomAt(viewport, 4, anchor);
        const after = screenToWorld(next, anchor);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });

    it("fits content inside the canvas with padding", () => {
        const fitted = fitViewport({ x: 0, y: 0, w: 1000, h: 500 }, { w: 600, h: 400 }, 50);
        expect(fitted.zoom).toBeLessThan(1);
        // Content centre should sit at the canvas centre.
        const centreScreen = worldToScreen(fitted, { x: 500, y: 250 });
        expect(centreScreen.x).toBeCloseTo(300);
        expect(centreScreen.y).toBeCloseTo(200);
    });

    it("steps through the zoom presets", () => {
        expect(nextZoomStep(1, 1)).toBe(1.25);
        expect(nextZoomStep(1, -1)).toBe(0.75);
        expect(nextZoomStep(8, 1)).toBe(8);
    });
});

describe("unionRects", () => {
    it("returns null for an empty list", () => {
        expect(unionRects([])).toBeNull();
    });

    it("covers every input", () => {
        const union = unionRects([
            { x: 0, y: 0, w: 10, h: 10 },
            { x: 20, y: -5, w: 5, h: 5 },
        ]);
        expect(union).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    });
});
