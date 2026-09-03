/** @jest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createNode, createPage, createDoc } from "../model/factory";
import { EditorStore } from "../model/store";
import type { DiagramNode, MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";

/**
 * Fix 4: one frame of work per frame, and one layout read per gesture.
 *
 * A 120 Hz trackpad delivers two or three pointer moves per screen refresh.
 * Doing the full round of hit testing, snapping and routing for each of them
 * paints pictures nobody ever sees. And each `getBoundingClientRect` forces a
 * synchronous layout, interleaved with React renders that dirty layout again —
 * the textbook thrash pattern.
 *
 * Frames are driven by hand here so the two can be told apart.
 */

const CANVAS = { width: 1000, height: 700 };

let queued: FrameRequestCallback[] = [];
let raf: jest.SpyInstance;
/** Layout reads against the canvas element specifically. */
let rectReads = 0;

/** Run every frame callback queued so far. */
function runFrame(): void {
    const batch = queued;
    queued = [];
    act(() => {
        for (const cb of batch) cb(0);
    });
}

beforeAll(() => {
    raf = jest
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
            queued.push(cb);
            return queued.length;
        });

    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        if (this instanceof SVGSVGElement) rectReads += 1;
        return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            width: CANVAS.width,
            height: CANVAS.height,
            right: CANVAS.width,
            bottom: CANVAS.height,
            toJSON: () => ({}),
        } as DOMRect;
    };
    global.ResizeObserver = class {
        observe() {
            /* jsdom never resizes */
        }
        unobserve() {
            /* no-op */
        }
        disconnect() {
            /* no-op */
        }
    } as unknown as typeof ResizeObserver;
    Element.prototype.setPointerCapture = function setPointerCapture() {
        /* no-op */
    };
    Element.prototype.releasePointerCapture = function releasePointerCapture() {
        /* no-op */
    };
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
        return false;
    };
});

afterAll(() => {
    raf.mockRestore();
});

beforeEach(() => {
    queued = [];
    rectReads = 0;
});

function scene(): MindmapDoc {
    const a: DiagramNode = createNode({
        shape: "rectangle",
        x: 100,
        y: 100,
        w: 200,
        h: 80,
        text: "Box",
    });
    return createDoc("Bench", [{ ...createPage(), nodes: [a], edges: [] }]);
}

function pointer(type: string, x: number, y: number, init: MouseEventInit = {}) {
    return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        ...init,
    }) as unknown as PointerEvent;
}

function mount(doc: MindmapDoc) {
    const store = new EditorStore(doc);
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    const view = render(
        <EditorProvider store={store}>
            <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
        </EditorProvider>
    );
    const svg = view.container.querySelector("svg");
    if (!svg) throw new Error("canvas not rendered");
    return { store, view, svg };
}

describe("pointer coalescing", () => {
    it("does one frame of work however many moves arrive in it", () => {
        const doc = scene();
        const { store, view, svg } = mount(doc);
        const node = doc.pages[0]!.nodes[0]!;
        const target = view.container.querySelector(`[data-node-id="${node.id}"]`)!;

        act(() => {
            target.dispatchEvent(
                pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
            );
        });

        let notifications = 0;
        const stop = store.subscribe(() => {
            notifications += 1;
        });

        // Twenty events, no frame yet: a burst between two refreshes.
        for (let i = 1; i <= 20; i++) {
            act(() => {
                svg.dispatchEvent(
                    pointer("pointermove", node.x + 20 + i * 5, node.y + 20, { buttons: 1 })
                );
            });
        }
        expect(notifications).toBe(0);

        runFrame();

        // One frame, one notification — not twenty.
        expect(notifications).toBe(1);

        // And it landed on the *last* sample, not the first.
        const moved = store.getState().doc.pages[0]!.nodes[0]!;
        expect(moved.x).toBe(node.x + 100);

        stop();
        view.unmount();
    });

    it("does not lose the last move when the pointer goes up before a frame runs", () => {
        const doc = scene();
        const { store, view, svg } = mount(doc);
        const node = doc.pages[0]!.nodes[0]!;
        const target = view.container.querySelector(`[data-node-id="${node.id}"]`)!;

        act(() => {
            target.dispatchEvent(
                pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
            );
        });
        act(() => {
            svg.dispatchEvent(pointer("pointermove", node.x + 220, node.y + 20, { buttons: 1 }));
        });

        // Release with the frame still queued: the shape must settle where the
        // pointer actually was, not one frame behind it.
        act(() => {
            svg.dispatchEvent(pointer("pointerup", node.x + 220, node.y + 20, { buttons: 0 }));
        });

        const moved = store.getState().doc.pages[0]!.nodes[0]!;
        expect(moved.x).toBe(node.x + 200);
        view.unmount();
    });

    it("keeps every sample for the ink tool", () => {
        const doc = createDoc("Ink", [{ ...createPage(), nodes: [], edges: [] }]);
        const { store, view, svg } = mount(doc);
        store.setTool("ink");

        act(() => {
            svg.dispatchEvent(pointer("pointerdown", 100, 100, { button: 0, buttons: 1 }));
        });

        // Six samples inside a single frame. A stroke built from one point per
        // frame would be visibly polygonal, so ink must replay all of them.
        for (let i = 1; i <= 6; i++) {
            act(() => {
                svg.dispatchEvent(
                    pointer("pointermove", 100 + i * 20, 100 + i * 9, { buttons: 1 })
                );
            });
        }
        runFrame();

        const ink = store.getState().doc.pages[0]!.nodes[0];
        expect(ink).toBeDefined();
        const points = (ink!.data as { points?: unknown[] }).points ?? [];
        expect(points.length).toBeGreaterThanOrEqual(6);

        view.unmount();
    });
});

describe("layout reads", () => {
    it("measures the canvas once for a whole gesture", () => {
        const doc = scene();
        const { view, svg } = mount(doc);
        const node = doc.pages[0]!.nodes[0]!;
        const target = view.container.querySelector(`[data-node-id="${node.id}"]`)!;

        act(() => {
            target.dispatchEvent(
                pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
            );
        });

        // Count only what the moves cost.
        rectReads = 0;
        for (let i = 1; i <= 30; i++) {
            act(() => {
                svg.dispatchEvent(
                    pointer("pointermove", node.x + 20 + i * 5, node.y + 20, { buttons: 1 })
                );
            });
            runFrame();
        }

        // The rect was read at pointer-down and cached. Nothing during the drag
        // can move the canvas without firing resize, scroll or ResizeObserver,
        // each of which invalidates it — so thirty frames cost zero reads.
        expect(rectReads).toBe(0);
        view.unmount();
    });

    it("re-measures after the window resizes", () => {
        const doc = scene();
        const { view, svg } = mount(doc);
        const node = doc.pages[0]!.nodes[0]!;
        const target = view.container.querySelector(`[data-node-id="${node.id}"]`)!;

        act(() => {
            target.dispatchEvent(
                pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
            );
        });

        rectReads = 0;
        act(() => {
            window.dispatchEvent(new Event("resize"));
        });
        act(() => {
            svg.dispatchEvent(pointer("pointermove", node.x + 60, node.y + 20, { buttons: 1 }));
        });
        runFrame();

        // Caching is only safe because invalidation works.
        expect(rectReads).toBeGreaterThan(0);
        view.unmount();
    });
});
