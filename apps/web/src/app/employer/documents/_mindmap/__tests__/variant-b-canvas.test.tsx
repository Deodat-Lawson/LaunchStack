/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createDoc, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import type { DiagramNode, MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { lookB } from "../variants/b-quick-add/look";
import { ARROW_OFFSET } from "../variants/b-quick-add/placement";
import { ShapePicker } from "../variants/b-quick-add/ShapePicker";
import { quickAddState } from "../variants/b-quick-add/state";

/**
 * Direction B's gestures on a mounted canvas, driven the way the canvas
 * tests drive it: jsdom does no hit-testing, so a press is dispatched on the
 * element grabbed and moves and releases on the <svg> (see
 * `canvas.render.test.tsx`). The canvas is 1000×700 at zoom 1 from (0, 0),
 * so screen and board coordinates are the same.
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
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => undefined;
});

function pointer(type: string, x: number, y: number, init: MouseEventInit = {}) {
    return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        ...init,
    }) as unknown as PointerEvent;
}

/** A box in B's look at (100, 100), 160×60: its right side's middle is (260, 130). */
function box(text = "Receive order"): DiagramNode {
    const look = lookB.boxLook("process", "light");
    return createNode({
        shape: "process",
        x: 100,
        y: 100,
        w: 160,
        h: 60,
        text,
        style: look.style,
        textStyle: look.text,
    });
}

function mount(nodes: DiagramNode[]) {
    const doc: MindmapDoc = createDoc("Flow", [{ ...createPage(), nodes, edges: [] }]);
    doc.settings = { ...doc.settings, kind: "flowchart", snapToGrid: false, snapToObjects: false };
    const store = new EditorStore(doc);
    store.setFlowVariant("b");
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    const onEditText = jest.fn();
    const view = render(
        <EditorProvider store={store}>
            <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText }} />
            <ShapePicker />
        </EditorProvider>
    );
    const svg = view.container.querySelector("svg")!;
    return { store, view, svg };
}

const page = (store: EditorStore) => store.getState().doc.pages[0]!;
const arrows = (root: ParentNode) => root.querySelectorAll("[data-quick-add-arrow]");
const arrow = (root: ParentNode, side: string) =>
    root.querySelector(`[data-quick-add-arrow="${side}"] circle`)!;

function press(el: Element, x: number, y: number) {
    act(() => {
        el.dispatchEvent(pointer("pointerdown", x, y, { button: 0, buttons: 1 }));
    });
}
function move(el: Element, x: number, y: number, buttons = 1) {
    act(() => {
        el.dispatchEvent(pointer("pointermove", x, y, { buttons }));
    });
}
function release(svg: Element, x: number, y: number) {
    act(() => {
        svg.dispatchEvent(pointer("pointerup", x, y, { buttons: 0 }));
    });
}

/** The right arrow's centre: 47px out from the middle of the right side. */
const RIGHT = { x: 260 + ARROW_OFFSET, y: 130 };
const BELOW = { x: 180, y: 160 + ARROW_OFFSET };

describe("variant B on the canvas: the + arrows", () => {
    it("shows four round a lone selected box, and none on a page without one", () => {
        const a = box();
        const { store, view } = mount([a]);
        expect(arrows(view.container)).toHaveLength(0);
        act(() => store.selectNodes([a.id]));
        expect(arrows(view.container)).toHaveLength(4);
    });

    it("shows them on the box under the pointer, and keeps them on the way out to them", () => {
        const a = box();
        const { view, svg } = mount([a]);
        const shape = view.container.querySelector(`g[data-node-id="${a.id}"]:not([data-port])`)!;
        move(shape, 180, 130, 0);
        expect(arrows(view.container)).toHaveLength(4);
        // Off the box, on the way to the right arrow: still up.
        move(svg, 285, 130, 0);
        expect(arrows(view.container)).toHaveLength(4);
        // Well away from it: gone.
        move(svg, 700, 500, 0);
        expect(arrows(view.container)).toHaveLength(0);
    });

    it("hides them with several boxes selected, while typing, and with another tool", () => {
        const a = box();
        const b = { ...box("Two"), id: "n_two", x: 500 };
        const { store, view } = mount([a, b]);
        act(() => store.selectNodes([a.id, b.id]));
        expect(arrows(view.container)).toHaveLength(0);
        act(() => {
            store.selectNodes([a.id]);
            store.setEditing({ kind: "node", id: a.id });
        });
        expect(arrows(view.container)).toHaveLength(0);
        act(() => {
            store.setEditing(null);
            store.setTool("connector");
        });
        expect(arrows(view.container)).toHaveLength(0);
    });

    it("a click on one adds the next box that way, joined, with its label open", () => {
        const a = box();
        const { store, view, svg } = mount([a]);
        act(() => store.selectNodes([a.id]));
        press(arrow(view.container, "e"), RIGHT.x, RIGHT.y);
        release(svg, RIGHT.x, RIGHT.y);

        const { nodes, edges } = page(store);
        expect(nodes).toHaveLength(2);
        const made = nodes[1]!;
        expect(made.x).toBe(260 + 64);
        expect(made.y).toBe(100);
        expect(edges).toHaveLength(1);
        expect(edges[0]!.from).toEqual({ nodeId: a.id, port: "e" });
        expect(edges[0]!.to).toEqual({ nodeId: made.id, port: "auto" });
        expect(store.getState().editing).toEqual({ kind: "node", id: made.id });
        // One step back takes both.
        act(() => store.undo());
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
    });

    it("a quick second click there is the same click, not a press on the new line", () => {
        const a = box();
        const { store, view, svg } = mount([a]);
        act(() => store.selectNodes([a.id]));
        press(arrow(view.container, "e"), RIGHT.x, RIGHT.y);
        release(svg, RIGHT.x, RIGHT.y);
        const made = page(store).nodes[1]!.id;
        const guard = view.container.querySelector("[data-quick-add-guard]")!;
        expect(guard).not.toBeNull();
        press(guard, RIGHT.x, RIGHT.y);
        release(svg, RIGHT.x, RIGHT.y);
        act(() => {
            guard.dispatchEvent(pointer("dblclick", RIGHT.x, RIGHT.y));
        });
        // Still typing into the new box; no connector label opened, no box made.
        expect(store.getState().editing).toEqual({ kind: "node", id: made });
        expect(page(store).nodes).toHaveLength(2);
        expect(page(store).edges[0]!.labels).toHaveLength(0);
    });
});

describe("variant B on the canvas: a click on a dot", () => {
    it("selects the box and adds nothing", () => {
        const a = box();
        const { store, view, svg } = mount([a]);
        act(() => store.selectNodes([a.id]));
        // The selected box's right dot, 16px out from the side.
        const dot = view.container.querySelector(
            `[data-node-id="${a.id}"][data-port="e"]:not([data-quick-add-arrow]) circle`
        )!;
        expect(dot).not.toBeNull();
        press(dot, 276, 130);
        release(svg, 276, 130);
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
        expect(store.selectedNodeIds()).toEqual([a.id]);
        expect(store.getState().canUndo).toBe(false);
    });

    it("adds nothing even after an arrow was dragged onto another box", () => {
        const a = box();
        const b = { ...box("Two"), id: "n_two", x: 500 };
        const { store, view, svg } = mount([a, b]);
        act(() => store.selectNodes([a.id]));
        // Drag the right arrow onto B: joined, as any dot drag would.
        press(arrow(view.container, "e"), RIGHT.x, RIGHT.y);
        const target = view.container.querySelector(`g[data-node-id="n_two"]:not([data-port])`)!;
        move(target, 580, 130);
        release(svg, 580, 130);
        expect(page(store).edges).toHaveLength(1);
        expect(page(store).edges[0]!.to.nodeId).toBe("n_two");
        // Then a plain click on A's dot is still only a click.
        act(() => store.selectNodes([a.id]));
        const dot = view.container.querySelector(
            `[data-node-id="${a.id}"][data-port="e"]:not([data-quick-add-arrow]) circle`
        )!;
        press(dot, 276, 130);
        release(svg, 276, 130);
        expect(page(store).nodes).toHaveLength(2);
        expect(page(store).edges).toHaveLength(1);
    });
});

describe("variant B on the canvas: dragging an arrow into empty space", () => {
    function dropBelow() {
        const a = box();
        const m = mount([a]);
        act(() => m.store.selectNodes([a.id]));
        press(arrow(m.view.container, "s"), BELOW.x, BELOW.y);
        move(m.svg, 190, 300);
        move(m.svg, 200, 400);
        release(m.svg, 200, 400);
        return { ...m, a };
    }

    it("leaves the page alone and asks what goes at the end", () => {
        const { store, view } = dropBelow();
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
        expect(store.getState().canUndo).toBe(false);
        expect(screen.getByRole("menu", { name: /shape for the end of the arrow/i })).toBeVisible();
        expect(screen.getAllByRole("menuitem").map(el => el.textContent)).toEqual([
            "Process",
            "Decision",
            "Start/End",
            "Data",
            "Document",
            "Database",
        ]);
        // The arrow's loose end is drawn as a ghost, not added.
        expect(view.container.querySelector("[data-quick-add-pending]")).not.toBeNull();
    });

    it("picking a shape makes it at the drop, joined from the box, in one undo step", () => {
        const { store, a } = dropBelow();
        fireEvent.click(screen.getByRole("menuitem", { name: "Decision" }));
        const { nodes, edges } = page(store);
        expect(nodes).toHaveLength(2);
        const made = nodes[1]!;
        expect(made.shape).toBe("decision");
        expect(made.x + made.w / 2).toBe(200);
        expect(made.y + made.h / 2).toBe(400);
        expect(edges).toHaveLength(1);
        expect(edges[0]!.from.nodeId).toBe(a.id);
        expect(edges[0]!.to.nodeId).toBe(made.id);
        expect(store.getState().editing).toEqual({ kind: "node", id: made.id });
        expect(screen.queryByRole("menu")).toBeNull();
        act(() => store.undo());
        expect(page(store).nodes).toHaveLength(1);
        expect(page(store).edges).toHaveLength(0);
    });

    it("the arrow keys and Enter pick too", () => {
        const { store } = dropBelow();
        const menu = screen.getByRole("menu");
        expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Process" }));
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Data" }));
        fireEvent.keyDown(menu, { key: "ArrowRight" });
        fireEvent.keyDown(menu, { key: "Enter" });
        expect(page(store).nodes[1]!.shape).toBe("document");
    });

    it("Escape leaves nothing on the page: no box, no dangling arrow", () => {
        const { store, view } = dropBelow();
        const before = store.getState().doc;
        fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(quickAddState(store).getPick()).toBeNull();
        expect(store.getState().doc).toBe(before);
        expect(page(store).edges).toHaveLength(0);
        expect(view.container.querySelector("[data-quick-add-pending]")).toBeNull();
        expect(store.getState().canUndo).toBe(false);
    });

    it("a click elsewhere leaves nothing either", async () => {
        const { store } = dropBelow();
        const before = store.getState().doc;
        // The picker starts listening for outside presses a tick after it opens.
        await act(() => new Promise(resolve => setTimeout(resolve, 0)));
        // A press and its click (the picker closes on the click that follows).
        act(() => {
            document.body.dispatchEvent(
                new MouseEvent("pointerdown", { bubbles: true, button: 0 }) as PointerEvent
            );
            document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(store.getState().doc).toBe(before);
        expect(store.getState().canUndo).toBe(false);
    });
});
