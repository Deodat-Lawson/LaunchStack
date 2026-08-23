import { setZoom, zoomByStep } from "../model/commands";
import { createDoc, createNode, createPage } from "../model/factory";
import { MAX_ZOOM, MIN_ZOOM } from "../model/geometry";
import { EditorStore } from "../model/store";

/**
 * Zoom anchoring.
 *
 * `setViewport({ zoom })` scales about the *world origin*, so a board zoomed
 * that way slides off the screen and at 400% the diagram is somewhere past the
 * corner. Every zoom that is not aimed at the pointer has to be aimed at the
 * middle of the canvas instead, and these tests are what keep it that way.
 */

const SIZE = { w: 1000, h: 700 };

function store(): EditorStore {
    const s = new EditorStore(
        createDoc("Test", [
            {
                ...createPage(),
                nodes: [createNode({ shape: "rectangle", x: 400, y: 300, w: 200, h: 100 })],
                edges: [],
            },
        ])
    );
    s.setViewport({ x: 0, y: 0, zoom: 1 });
    return s;
}

/** The world point currently under the middle of the canvas. */
function centre(s: EditorStore): { x: number; y: number } {
    const v = s.getState().viewport;
    return { x: v.x + SIZE.w / 2 / v.zoom, y: v.y + SIZE.h / 2 / v.zoom };
}

describe("zoomByStep", () => {
    it("holds the centre of the canvas while zooming in", () => {
        const s = store();
        const before = centre(s);
        zoomByStep(s, 1, SIZE);
        expect(s.getState().viewport.zoom).toBeGreaterThan(1);
        const after = centre(s);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it("holds the centre while zooming out", () => {
        const s = store();
        const before = centre(s);
        zoomByStep(s, -1, SIZE);
        expect(s.getState().viewport.zoom).toBeLessThan(1);
        const after = centre(s);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it("comes back to where it started after a round trip", () => {
        const s = store();
        const before = { ...s.getState().viewport };
        for (let i = 0; i < 4; i++) zoomByStep(s, 1, SIZE);
        for (let i = 0; i < 4; i++) zoomByStep(s, -1, SIZE);
        const after = s.getState().viewport;
        expect(after.zoom).toBeCloseTo(before.zoom, 6);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it("stops at the ends of the range instead of running away", () => {
        const s = store();
        for (let i = 0; i < 40; i++) zoomByStep(s, 1, SIZE);
        expect(s.getState().viewport.zoom).toBeCloseTo(MAX_ZOOM, 6);
        for (let i = 0; i < 80; i++) zoomByStep(s, -1, SIZE);
        expect(s.getState().viewport.zoom).toBeCloseTo(MIN_ZOOM, 6);
    });
});

describe("setZoom", () => {
    it("holds the centre when jumping to an exact percentage", () => {
        const s = store();
        s.setViewport({ x: 120, y: -80, zoom: 0.4 });
        const before = centre(s);
        setZoom(s, 2, SIZE);
        expect(s.getState().viewport.zoom).toBeCloseTo(2, 6);
        const after = centre(s);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });
});
