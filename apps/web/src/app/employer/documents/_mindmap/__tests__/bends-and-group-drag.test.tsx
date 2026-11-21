/** @jest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import type { DiagramEdge, DiagramNode, MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";

/**
 * Connector bends and dragging a selection.
 *
 * Reported from a cycle diagram: bends appeared on connectors "without
 * knowing" and could not be deleted, and a selection of boxes and connectors
 * could not be dragged the way one box can. The causes: pressing an
 * already-selected connector inserted a bend on pointerdown — so the second
 * click of every double-click left one — there was no way to remove a single
 * bend, and a press on a selected connector bent that connector instead of
 * moving the selection (whose bends stayed behind when it did move).
 */

const CANVAS = { width: 1000, height: 700 };
let queued: FrameRequestCallback[] = [];
let raf: jest.SpyInstance;

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
});

afterAll(() => raf.mockRestore());
beforeEach(() => {
    queued = [];
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

/** Two boxes in a row and a third below, joined A → B. */
function scene(edgeOverrides: Partial<DiagramEdge> = {}) {
    const a: DiagramNode = createNode({ shape: "rectangle", x: 0, y: 0, w: 100, h: 60, text: "A" });
    const b: DiagramNode = createNode({
        shape: "rectangle",
        x: 300,
        y: 0,
        w: 100,
        h: 60,
        text: "B",
    });
    const c: DiagramNode = createNode({
        shape: "rectangle",
        x: 0,
        y: 300,
        w: 100,
        h: 60,
        text: "C",
    });
    const edge: DiagramEdge = {
        ...createEdge({ from: { nodeId: a.id, port: "e" }, to: { nodeId: b.id, port: "w" } }),
        kind: "straight",
        ...edgeOverrides,
    };
    const doc: MindmapDoc = createDoc("Bends", [
        { ...createPage(), nodes: [a, b, c], edges: [edge] },
    ]);
    // A clean grid so drags land where the pointer is.
    doc.settings = { ...doc.settings, snapToGrid: false, snapToObjects: false };
    return { doc, a, b, c, edge };
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

const page = (store: EditorStore) => store.getState().doc.pages[0]!;
const edgeOf = (store: EditorStore, id: string) => page(store).edges.find(e => e.id === id)!;
const nodeOf = (store: EditorStore, id: string) => page(store).nodes.find(n => n.id === id)!;

function press(el: Element, x: number, y: number, init: MouseEventInit = {}) {
    act(() => {
        el.dispatchEvent(pointer("pointerdown", x, y, { button: 0, buttons: 1, ...init }));
    });
}
function drag(svg: Element, x: number, y: number) {
    act(() => {
        svg.dispatchEvent(pointer("pointermove", x, y, { buttons: 1 }));
    });
    runFrame();
}
function release(svg: Element, x: number, y: number) {
    act(() => {
        svg.dispatchEvent(pointer("pointerup", x, y, { buttons: 0 }));
    });
}
function click(el: Element, svg: Element, x: number, y: number) {
    press(el, x, y);
    release(svg, x, y);
}

const edgeEl = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-edge-id="${id}"]`)!;

describe("bends on a connector", () => {
    it("clicking a selected connector adds none", () => {
        const { doc, edge } = scene();
        const { store, view, svg } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));

        click(edgeEl(view.container, edge.id), svg, 200, 30);
        click(edgeEl(view.container, edge.id), svg, 200, 30);

        expect(edgeOf(store, edge.id).waypoints).toEqual([]);
        // Nothing happened, so nothing is on the undo stack either.
        expect(store.getState().canUndo).toBe(false);
        view.unmount();
    });

    it("double-clicking a selected connector to label it adds none", () => {
        const { doc, edge } = scene();
        const { store, view, svg } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));
        const el = edgeEl(view.container, edge.id);
        click(el, svg, 200, 30);
        click(el, svg, 200, 30);
        act(() => {
            el.dispatchEvent(pointer("dblclick", 200, 30));
        });
        expect(edgeOf(store, edge.id).waypoints).toEqual([]);
        view.unmount();
    });

    it("dragging a selected connector bends it where it was dragged to", () => {
        const { doc, edge } = scene();
        const { store, view, svg } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));
        press(edgeEl(view.container, edge.id), 200, 30);
        drag(svg, 200, 120);
        release(svg, 200, 120);
        expect(edgeOf(store, edge.id).waypoints).toEqual([{ x: 200, y: 120 }]);
        view.unmount();
    });

    it("double-clicking a bend's handle removes that bend only", () => {
        const { doc, edge } = scene({
            waypoints: [
                { x: 150, y: 120 },
                { x: 250, y: 120 },
            ],
        });
        const { store, view, svg } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));
        const handle = view.container.querySelector(`[data-waypoint="0"]`)!;
        expect(handle).not.toBeNull();
        click(handle, svg, 150, 120);
        press(handle, 150, 120);
        release(svg, 150, 120);
        act(() => {
            handle.dispatchEvent(pointer("dblclick", 150, 120));
        });
        expect(edgeOf(store, edge.id).waypoints).toEqual([{ x: 250, y: 120 }]);
        view.unmount();
    });

    it("a bend dragged back into line with its neighbours is taken out", () => {
        const { doc, edge } = scene({ waypoints: [{ x: 200, y: 120 }] });
        const { store, view, svg } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));
        const handle = view.container.querySelector(`[data-waypoint="0"]`)!;
        press(handle, 200, 120);
        drag(svg, 200, 60);
        drag(svg, 200, 32); // within a few px of the straight line at y = 30
        release(svg, 200, 32);
        expect(edgeOf(store, edge.id).waypoints).toEqual([]);
        view.unmount();
    });

    it("explains its handle on hover", () => {
        const { doc, edge } = scene({ waypoints: [{ x: 200, y: 120 }] });
        const { store, view } = mount(doc);
        act(() => store.setSelection([{ kind: "edge", id: edge.id }]));
        const handle = view.container.querySelector(`[data-waypoint="0"]`)!;
        expect(handle.querySelector("title")?.textContent).toMatch(/double-click to remove/i);
        view.unmount();
    });
});

describe("dragging a selection of boxes and connectors", () => {
    it("moves everything, bends included, when the press lands on a selected connector", () => {
        const { doc, a, b, edge } = scene({ waypoints: [{ x: 200, y: 120 }] });
        const { store, view, svg } = mount(doc);
        act(() =>
            store.setSelection([
                { kind: "node", id: a.id },
                { kind: "node", id: b.id },
                { kind: "edge", id: edge.id },
            ])
        );
        // On the connector's first segment, between A and the bend.
        press(edgeEl(view.container, edge.id), 150, 75);
        drag(svg, 190, 115);
        release(svg, 190, 115);

        expect(nodeOf(store, a.id)).toMatchObject({ x: 40, y: 40 });
        expect(nodeOf(store, b.id)).toMatchObject({ x: 340, y: 40 });
        expect(edgeOf(store, edge.id).waypoints).toEqual([{ x: 240, y: 160 }]);
        view.unmount();
    });

    it("moves everything when the press lands on empty space inside the selection", () => {
        const { doc, a, b, c } = scene();
        const { store, view, svg } = mount(doc);
        act(() => store.selectNodes([a.id, b.id]));
        // Between A and B: no shape there, but inside the selection's frame.
        press(svg, 200, 50);
        drag(svg, 220, 70);
        release(svg, 220, 70);
        expect(nodeOf(store, a.id)).toMatchObject({ x: 20, y: 20 });
        expect(nodeOf(store, b.id)).toMatchObject({ x: 320, y: 20 });
        expect(nodeOf(store, c.id)).toMatchObject({ x: 0, y: 300 });
        expect(store.selectedNodeIds().sort()).toEqual([a.id, b.id].sort());
        view.unmount();
    });

    it("carries the bends of connectors between moved boxes", () => {
        const { doc, a, b, edge } = scene({ waypoints: [{ x: 200, y: 120 }] });
        const { store, view, svg } = mount(doc);
        act(() => store.selectNodes([a.id, b.id]));
        const boxA = view.container.querySelector(`[data-node-id="${a.id}"]`)!;
        press(boxA, 50, 30);
        drag(svg, 60, 30);
        release(svg, 60, 30);
        expect(edgeOf(store, edge.id).waypoints).toEqual([{ x: 210, y: 120 }]);
        view.unmount();
    });

    it("lassoes the connectors running between the boxes it catches", () => {
        const { doc, a, b, edge } = scene();
        const { store, view, svg } = mount(doc);
        press(svg, -20, -20);
        drag(svg, 420, 80);
        release(svg, 420, 80);
        const sel = store
            .getState()
            .selection.map(s => `${s.kind}:${s.id}`)
            .sort();
        expect(sel).toEqual([`node:${a.id}`, `node:${b.id}`, `edge:${edge.id}`].sort());
        view.unmount();
    });
});

describe("fold buttons", () => {
    function tree(kind: "mindmap" | "flowchart") {
        const root = createNode({ shape: "mind-root", x: 0, y: 0, w: 200, h: 70, text: "Root" });
        const kid = createNode({ shape: "mind-branch", x: 300, y: 0, w: 160, h: 50, text: "Kid" });
        const doc = createDoc("Fold", [
            {
                ...createPage(),
                nodes: [root, kid],
                edges: [createEdge({ from: { nodeId: root.id }, to: { nodeId: kid.id } })],
            },
        ]);
        return { doc: { ...doc, settings: { ...doc.settings, kind } }, root };
    }
    const folds = (c: HTMLElement) => c.querySelectorAll("[data-fold]").length;

    it("on a mindmap, show only while their topic is hovered or selected, or once folded", () => {
        const { doc, root } = tree("mindmap");
        const { store, view } = mount(doc);
        // Not sitting on every line out of every topic.
        expect(folds(view.container)).toBe(0);
        act(() => store.setHover(root.id, null));
        expect(folds(view.container)).toBe(1);
        act(() => store.setHover(null, null));
        act(() => store.selectNodes([root.id]));
        expect(folds(view.container)).toBe(1);
        act(() => store.clearSelection());
        act(() =>
            store.updatePage(p => ({
                ...p,
                nodes: p.nodes.map(n => (n.id === root.id ? { ...n, collapsed: true } : n)),
            }))
        );
        expect(folds(view.container)).toBe(1);
        view.unmount();
    });

    it("never show on a flowchart, hovered or not", () => {
        const { doc, root } = tree("flowchart");
        const { store, view } = mount(doc);
        act(() => store.setHover(root.id, null));
        act(() => store.selectNodes([root.id]));
        expect(folds(view.container)).toBe(0);
        view.unmount();
    });
});

describe("connector gestures", () => {
    it("Escape mid-drag abandons a connector being drawn", () => {
        const { doc, a } = scene();
        const { store, view, svg } = mount(doc);
        act(() => store.selectNodes([a.id]));
        const port = view.container.querySelector(
            `[data-node-id="${a.id}"][data-port="s"] circle`
        )!;
        expect(port).not.toBeNull();
        const before = page(store).edges.length;
        press(port, 50, 60);
        drag(svg, 70, 180);
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        release(svg, 70, 180);
        expect(page(store).edges).toHaveLength(before);
        expect(store.getState().drag.kind).toBe("none");
        view.unmount();
    });

    it("a label slides along its line when dragged, and nothing bends", () => {
        const { doc, edge } = scene({ labels: [{ text: "go", t: 0.5, offset: 0 }] });
        const { store, view, svg } = mount(doc);
        const label = view.container.querySelector(
            `[data-edge-id="${edge.id}"] [data-edge-label="0"] rect`
        )!;
        expect(label).not.toBeNull();
        press(label, 200, 30);
        drag(svg, 250, 40);
        release(svg, 250, 40);
        const after = edgeOf(store, edge.id);
        expect(after.labels[0]!.t).toBeGreaterThan(0.5);
        expect(after.waypoints).toEqual([]);
        // One undo puts it back.
        act(() => store.undo());
        expect(edgeOf(store, edge.id).labels[0]!.t).toBe(0.5);
        view.unmount();
    });
});

describe("drawing a connector: what lights up", () => {
    it("outlines only the shape a release would attach to", () => {
        const { doc, a, b } = scene();
        // Start from an empty page so only the drag decides what shows.
        const { store, view, svg } = mount({ ...doc, pages: [{ ...doc.pages[0]!, edges: [] }] });
        act(() => store.selectNodes([a.id]));
        const port = view.container.querySelector(
            `[data-node-id="${a.id}"][data-port="e"] circle`
        )!;
        press(port, 100, 30);
        // jsdom has no elementFromPoint: the move is dispatched on B, as the
        // pointer being over B.
        act(() => {
            view.container
                .querySelector(`[data-node-id="${b.id}"]`)!
                .dispatchEvent(pointer("pointermove", 350, 30, { buttons: 1 }));
        });
        runFrame();
        expect(view.container.querySelectorAll("[data-connect-target]")).toHaveLength(1);
        const owners = new Set(
            [...view.container.querySelectorAll("[data-port]")].map(p =>
                p.getAttribute("data-node-id")
            )
        );
        expect([...owners]).toEqual([b.id]);
        release(svg, 350, 30);
        view.unmount();
    });
});

describe("connector odds and ends", () => {
    it("draws labels above every connector, not inside their own", () => {
        const { doc, edge } = scene({ labels: [{ text: "enqueue", t: 0.5, offset: 0 }] });
        const { view } = mount(doc);
        const label = view.container.querySelector("[data-edge-label]")!;
        const lastStroke = [...view.container.querySelectorAll("svg g[data-edge-id] path")].pop()!;
        // The label comes after every connector's stroke in paint order.
        expect(
            label.compareDocumentPosition(lastStroke) & Node.DOCUMENT_POSITION_PRECEDING
        ).toBeTruthy();
        expect(label.closest("[data-edge-id]")?.getAttribute("data-edge-id")).toBe(edge.id);
        view.unmount();
    });

    it("creates nothing when a drag out of a box is released back on it", () => {
        const { doc, a } = scene();
        const { store, view, svg } = mount({ ...doc, pages: [{ ...doc.pages[0]!, edges: [] }] });
        act(() => store.selectNodes([a.id]));
        const port = view.container.querySelector(
            `[data-node-id="${a.id}"][data-port="e"] circle`
        )!;
        press(port, 100, 30);
        drag(svg, 170, 40);
        drag(svg, 50, 30);
        release(svg, 50, 30);
        expect(page(store).edges).toHaveLength(0);
        expect(store.selectedNodeIds()).toEqual([a.id]);
        view.unmount();
    });

    it("leaves the rotate handle clear: no dot above a selected box", () => {
        const { doc, a } = scene();
        const { store, view } = mount(doc);
        act(() => store.selectNodes([a.id]));
        const sides = [
            ...view.container.querySelectorAll(`[data-node-id="${a.id}"][data-port]`),
        ].map(p => p.getAttribute("data-port"));
        expect(sides.sort()).toEqual(["e", "s", "w"]);
        view.unmount();
    });
});
