/** @jest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createEdge, createNode, createPage, createDoc } from "../model/factory";
import { EditorStore } from "../model/store";
import type { DiagramEdge, DiagramNode, MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { Inspector } from "../ui/Inspector";
import { OutlinePanel } from "../ui/OutlinePanel";

/**
 * How many times does the store wake its listeners during a drag?
 *
 * This is the measurement behind Fix 1, kept as a test so the number cannot
 * quietly regress. It counts *store notifications*, not React renders — React
 * 18 already merges renders inside an event handler, so the render count would
 * hide the duplicated wake-and-check work this fix removes.
 *
 * Every subscribed component pays for each notification: `useSyncExternalStore`
 * re-runs its `getSnapshot`, which re-runs the selector and its equality check.
 * With sixteen subscribed components, one redundant notification per pointer
 * move is sixteen redundant selector runs per move.
 */

const CANVAS = { width: 1000, height: 700 };

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

/** Two shapes joined by a connector, laid out at known coordinates. */
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

interface DragMeasurement {
    moves: number;
    notifications: number;
    /** Store notifications per pointer move — the number Fix 1 halves. */
    perMove: number;
}

/**
 * Drag the first shape across `moves` pointer events and count how many times
 * the store woke its listeners while the pointer was moving.
 */
function measureDrag(moves: number): DragMeasurement {
    const doc = scene();
    const store = new EditorStore(doc);
    store.setViewport({ x: 0, y: 0, zoom: 1 });

    const view = render(
        <EditorProvider store={store}>
            <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
        </EditorProvider>
    );

    const svg = view.container.querySelector("svg");
    if (!svg) throw new Error("canvas not rendered");
    const node = doc.pages[0]!.nodes[0]!;
    const target = view.container.querySelector(`[data-node-id="${node.id}"]`);
    if (!target) throw new Error("shape not rendered");

    // Press on the shape itself: jsdom does no hit testing, so the gesture has
    // to start on the element the interaction layer reads from `event.target`.
    act(() => {
        target.dispatchEvent(
            pointer("pointerdown", node.x + 20, node.y + 20, { button: 0, buttons: 1 })
        );
    });

    // Only count what happens during the moves — not the press or the release.
    let notifications = 0;
    const stop = store.subscribe(() => {
        notifications += 1;
    });

    for (let i = 1; i <= moves; i++) {
        act(() => {
            svg.dispatchEvent(
                pointer("pointermove", node.x + 20 + i * 7, node.y + 20 + i * 3, { buttons: 1 })
            );
        });
    }

    stop();
    act(() => {
        svg.dispatchEvent(pointer("pointerup", node.x + 200, node.y + 100, { buttons: 0 }));
    });
    view.unmount();

    return { moves, notifications, perMove: notifications / moves };
}

describe("what one notification costs", () => {
    it("wakes every subscriber in the editor, so the count is a multiplier", () => {
        const store = new EditorStore(scene());

        const view = render(
            <EditorProvider store={store}>
                <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                <Inspector />
                <OutlinePanel canvasSize={{ w: 1000, h: 700 }} />
            </EditorProvider>
        );

        // Each `useSyncExternalStore` in the tree is one listener, and each
        // listener re-runs its selector and equality check per notification.
        // Three panels already cost several; the full editor mounts far more.
        // Halving the notifications halves all of that work.
        expect(store.listenerCount()).toBeGreaterThanOrEqual(3);

        view.unmount();
        expect(store.listenerCount()).toBe(0);
    });
});

describe("store notifications during a drag", () => {
    it("wakes listeners exactly once per pointer move", () => {
        const result = measureDrag(20);

        // Every frame of a drag is one logical change — guides and positions
        // move together — so it must cost one notification, not two.
        expect(result.perMove).toBe(1);
    });

    it("scales linearly with the number of moves", () => {
        const short = measureDrag(5);
        const long = measureDrag(40);

        expect(short.notifications).toBe(5);
        expect(long.notifications).toBe(40);
    });

    it("still moves the shape while notifying once per move", () => {
        // Guards against the degenerate way to pass the test above: dropping a
        // write entirely rather than batching the two together.
        const doc = scene();
        const store = new EditorStore(doc);
        store.setViewport({ x: 0, y: 0, zoom: 1 });

        const view = render(
            <EditorProvider store={store}>
                <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
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
        act(() => {
            svg.dispatchEvent(pointer("pointerup", node.x + 220, node.y + 20, { buttons: 0 }));
        });

        const moved = store.getState().doc.pages[0]!.nodes[0]!;
        expect(moved.x).toBeGreaterThan(node.x);
        view.unmount();
    });
});
