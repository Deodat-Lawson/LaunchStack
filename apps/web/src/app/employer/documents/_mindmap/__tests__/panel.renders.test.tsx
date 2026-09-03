/** @jest-environment jsdom */

import React, { Profiler } from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { setActivePage } from "../model/commands";
import { createEdge, createNode, createPage, createDoc } from "../model/factory";
import { EditorStore } from "../model/store";
import type { DiagramEdge, DiagramNode, MindmapDoc } from "../model/types";
import { BottomBar } from "../ui/BottomBar";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { Inspector } from "../ui/Inspector";
import { OutlinePanel } from "../ui/OutlinePanel";
import { Toolbar } from "../ui/Toolbar";

/**
 * How many panels re-render during a drag?
 *
 * This is the measurement behind Fix 2, kept as a test so the number cannot
 * quietly regress. Only the canvas can possibly look different while a shape is
 * being dragged, so only the canvas should re-render. Everything else — the
 * outline tree, the inspector's forty controls, the page tabs and the minimap —
 * is reading a document whose *committed* state has not changed.
 *
 * `Profiler.onRender` fires once per committed render of the subtree it wraps,
 * which is exactly the unit of work being counted.
 */

const CANVAS = { width: 1000, height: 700 };

let raf: jest.SpyInstance;

beforeAll(() => {
    // Run each coalesced frame immediately: this file measures which panels
    // render per processed move, not how moves are batched into frames.
    raf = jest
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });
});

afterAll(() => {
    raf.mockRestore();
});

beforeAll(() => {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
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

function scene(): MindmapDoc {
    const a: DiagramNode = createNode({
        shape: "mind-root",
        x: 100,
        y: 100,
        w: 200,
        h: 80,
        text: "Root",
    });
    const b: DiagramNode = createNode({
        shape: "mind-branch",
        x: 460,
        y: 140,
        w: 160,
        h: 56,
        text: "Branch",
    });
    const edge: DiagramEdge = createEdge({
        from: { nodeId: a.id, port: "auto" },
        to: { nodeId: b.id, port: "auto" },
    });
    return createDoc("Bench", [{ ...createPage(), nodes: [a, b], edges: [edge] }]);
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

type Renders = Record<string, number>;

/**
 * Drag a shape across `moves` pointer events with the five panels that are
 * always on screen mounted, and count each panel's committed renders.
 */
function measure(moves: number): { renders: Renders; store: EditorStore } {
    const doc = scene();
    const store = new EditorStore(doc);
    store.setViewport({ x: 0, y: 0, zoom: 1 });

    const renders: Renders = {};
    let counting = false;
    const count = (id: string) => {
        if (counting) renders[id] = (renders[id] ?? 0) + 1;
    };

    const cb = { onContextMenuAt: jest.fn(), onEditText: jest.fn() };
    const size = { w: CANVAS.width, h: CANVAS.height };

    const view = render(
        <EditorProvider store={store}>
            <Profiler id="Canvas" onRender={count}>
                <Canvas callbacks={cb} />
            </Profiler>
            <Profiler id="Toolbar" onRender={count}>
                <Toolbar onOpenShapes={jest.fn()} />
            </Profiler>
            <Profiler id="OutlinePanel" onRender={count}>
                <OutlinePanel canvasSize={size} />
            </Profiler>
            <Profiler id="Inspector" onRender={count}>
                <Inspector />
            </Profiler>
            <Profiler id="BottomBar" onRender={count}>
                <BottomBar canvasSize={size} />
            </Profiler>
        </EditorProvider>
    );

    const svg = view.container.querySelector("svg");
    if (!svg) throw new Error("canvas not rendered");
    const node = doc.pages[0]!.nodes[0]!;
    const target = view.container.querySelector(`[data-node-id="${node.id}"]`);
    if (!target) throw new Error("shape not rendered");

    // Press selects the shape, so the inspector has real content to render.
    act(() => {
        target.dispatchEvent(
            pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
        );
    });

    // Count only the moves — not the press, and not the release.
    counting = true;
    for (let i = 1; i <= moves; i++) {
        act(() => {
            svg.dispatchEvent(
                pointer("pointermove", node.x + 20 + i * 7, node.y + 20 + i * 3, { buttons: 1 })
            );
        });
    }
    counting = false;

    act(() => {
        svg.dispatchEvent(pointer("pointerup", node.x + 200, node.y + 100, { buttons: 0 }));
    });
    view.unmount();

    return { renders, store };
}

describe("panel re-renders during a drag", () => {
    it("re-renders the canvas once per pointer move", () => {
        const { renders } = measure(20);
        expect(renders.Canvas).toBe(20);
    });

    it("leaves every other panel asleep", () => {
        const { renders } = measure(20);

        // Nothing these panels display can change while a drag is mid-flight:
        // the outline tree, the inspector, the page tabs and the minimap all
        // read committed document state. Asserting on the whole map rather
        // than panel by panel means a newly-added panel that wakes on every
        // frame fails this test instead of slipping past it.
        expect(renders).toEqual({ Canvas: 20 });
    });

    it("scales with the drag, not with the number of panels", () => {
        const { renders } = measure(40);
        const total = Object.values(renders).reduce((a, b) => a + b, 0);

        // One panel × one render per move. Before Fix 2 this was four panels.
        expect(total).toBe(40);
    });
});

describe("panels catch up when the gesture commits", () => {
    it("wakes the sleeping panels on release, and shows where the shape landed", () => {
        const doc = scene();
        const store = new EditorStore(doc);
        store.setViewport({ x: 0, y: 0, zoom: 1 });

        const renders: Renders = {};
        let counting = false;
        const count = (id: string) => {
            if (counting) renders[id] = (renders[id] ?? 0) + 1;
        };

        const cb = { onContextMenuAt: jest.fn(), onEditText: jest.fn() };
        const size = { w: CANVAS.width, h: CANVAS.height };

        const view = render(
            <EditorProvider store={store}>
                <Profiler id="Canvas" onRender={count}>
                    <Canvas callbacks={cb} />
                </Profiler>
                <Profiler id="OutlinePanel" onRender={count}>
                    <OutlinePanel canvasSize={size} />
                </Profiler>
                <Profiler id="Inspector" onRender={count}>
                    <Inspector />
                </Profiler>
            </EditorProvider>
        );

        const svg = view.container.querySelector("svg")!;
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

        // Count only the release.
        counting = true;
        act(() => {
            svg.dispatchEvent(pointer("pointerup", node.x + 220, node.y + 20, { buttons: 0 }));
        });
        counting = false;

        // Sleeping through the drag is only correct if they wake at the end.
        expect(renders.OutlinePanel ?? 0).toBeGreaterThanOrEqual(1);
        expect(renders.Inspector ?? 0).toBeGreaterThanOrEqual(1);

        const moved = store.getState().doc.pages[0]!.nodes[0]!;
        expect(moved.x).toBeGreaterThan(node.x);
        view.unmount();
    });

    it("wakes the page tabs when the page changes, though that write is transient", () => {
        // `setActivePage` is transient — it takes no undo entry — but it is not
        // a gesture preview. If the commit counter keyed off `transient` alone
        // this panel would keep highlighting the old tab forever.
        const first = { ...createPage(), nodes: [], edges: [] };
        const second = { ...createPage(), name: "Detail", nodes: [], edges: [] };
        const store = new EditorStore(createDoc("Two pages", [first, second]));

        let renders = 0;
        const view = render(
            <EditorProvider store={store}>
                <Profiler id="BottomBar" onRender={() => (renders += 1)}>
                    <BottomBar canvasSize={{ w: CANVAS.width, h: CANVAS.height }} />
                </Profiler>
            </EditorProvider>
        );

        const mounted = renders;
        act(() => {
            setActivePage(store, second.id);
        });

        expect(renders).toBeGreaterThan(mounted);
        expect(store.getState().doc.activePageId).toBe(second.id);
        view.unmount();
    });
});
