/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FlowOverlay, StepsPanel } from "../flow";
import { menuOf } from "../flow/pick/menu";
import { commitNodeText, insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { createEdge } from "../model/factory";
import { swatchFor } from "../model/palette";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { SelectionToolbar } from "../ui/SelectionToolbar";
import { useKeyboard, type KeyboardActions } from "../ui/useKeyboard";

/**
 * Selecting several boxes and moving them together, on a flowchart, with its
 * own keys, menu and Steps panel all mounted — none of them may get in the
 * way: a drag on empty canvas is a marquee (not the "What goes here?" menu),
 * a drag that starts on a box moves it (not a new arrow), arrows nudge a
 * selection of several and walk only from one box, and the selection
 * toolbar's colours and + act on what is selected.
 *
 * jsdom does no layout or hit-testing: every element is the canvas's box,
 * and a pointer event is dispatched on the element being grabbed.
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
    Element.prototype.scrollIntoView = () => undefined;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
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

function KeyboardHost({ store }: { store: EditorStore }) {
    const actions: KeyboardActions = {
        isActive: () => true,
        onSave: () => undefined,
        onFind: () => undefined,
        onCommandPalette: () => undefined,
        onExport: () => undefined,
        onTogglePresent: () => undefined,
        onShowShortcuts: () => undefined,
        onEditSelection: () => undefined,
        getViewportSize: () => ({ w: CANVAS.width, h: CANVAS.height }),
    };
    useKeyboard(store, actions);
    return null;
}

/**
 * A blank flowchart that arranged itself — A, B, C in a column, joined — with
 * the canvas, the keys, the flowchart's overlay and the toolbar mounted.
 */
function mount() {
    const doc = buildTemplate("blank", "Flow", "light");
    const store = new EditorStore({
        ...doc,
        settings: { ...doc.settings, snapToGrid: false, snapToObjects: false },
    });
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    store.setChromeDepth("focus");
    const ids = ["A", "B", "C"].map((text, i) =>
        insertShape(store, "process", { x: 200, y: 100 + i * 150 }, { text })
    );
    store.updatePage(
        p => ({
            ...p,
            edges: [
                createEdge({ from: { nodeId: ids[0]! }, to: { nodeId: ids[1]! } }),
                {
                    ...createEdge({ from: { nodeId: ids[1]! }, to: { nodeId: ids[2]! } }),
                    waypoints: [{ x: 320, y: 330 }],
                },
            ],
        }),
        { transient: true }
    );
    store.setEditing(null);
    store.clearSelection();
    const view = render(
        <EditorProvider store={store}>
            <div data-mindmap-stage="">
                <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                <SelectionToolbar onMore={jest.fn()} />
                <FlowOverlay canvasSize={{ w: CANVAS.width, h: CANVAS.height }} />
                <KeyboardHost store={store} />
            </div>
        </EditorProvider>
    );
    const svg = view.container.querySelector("svg")!;
    return { store, view, svg, ids };
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string): DiagramNode => nodeById(page(store), id)!;
const at = (nd: DiagramNode) => ({ x: nd.x, y: nd.y });
const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.body, { key, ...init });

function drag(start: Element, svg: Element, from: [number, number], to: [number, number]) {
    act(() => {
        start.dispatchEvent(pointer("pointerdown", from[0], from[1], { button: 0, buttons: 1 }));
    });
    for (const k of [0.5, 1]) {
        act(() => {
            svg.dispatchEvent(
                pointer(
                    "pointermove",
                    from[0] + (to[0] - from[0]) * k,
                    from[1] + (to[1] - from[1]) * k,
                    { buttons: 1 }
                )
            );
        });
        runFrame();
    }
    act(() => {
        svg.dispatchEvent(pointer("pointerup", to[0], to[1], { buttons: 0 }));
    });
}

const boxEl = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-node-id="${id}"]:not([data-port])`)!;

describe("selecting several boxes", () => {
    it("a drag on empty canvas selects every box it touches and the arrows between them", () => {
        const m = mount();
        // From the empty top-left, across A and B but not C.
        drag(m.svg, m.svg, [20, 20], [400, 300]);
        expect(m.store.selectedNodeIds().sort()).toEqual([m.ids[0], m.ids[1]].sort());
        const a2b = page(m.store).edges[0]!.id;
        expect(m.store.selectedEdgeIds()).toEqual([a2b]);
        // A marquee is a selection, never the "What goes here?" menu.
        expect(menuOf(m.store)).toBeNull();
        m.view.unmount();
    });

    it("⇧-click and ⌘-click add and remove; ⌘A selects all", () => {
        const m = mount();
        const [a, b] = m.ids;
        act(() => {
            boxEl(m.view.container, a!).dispatchEvent(
                pointer("pointerdown", 284, 132, { button: 0, buttons: 1 })
            );
            m.svg.dispatchEvent(pointer("pointerup", 284, 132));
        });
        act(() => {
            boxEl(m.view.container, b!).dispatchEvent(
                pointer("pointerdown", 284, 282, { button: 0, buttons: 1, shiftKey: true })
            );
            m.svg.dispatchEvent(pointer("pointerup", 284, 282));
        });
        expect(m.store.selectedNodeIds()).toEqual([a, b]);
        act(() => {
            boxEl(m.view.container, a!).dispatchEvent(
                pointer("pointerdown", 284, 132, { button: 0, buttons: 1, metaKey: true })
            );
            m.svg.dispatchEvent(pointer("pointerup", 284, 132));
        });
        expect(m.store.selectedNodeIds()).toEqual([b]);
        act(() => {
            press("a", { metaKey: true });
        });
        expect(m.store.selectedNodeIds()).toHaveLength(3);
        expect(m.store.selectedEdgeIds()).toHaveLength(2);
        m.view.unmount();
    });
});

describe("moving several boxes together", () => {
    it("dragging one selected box moves the group, its arrows' bends too, and holds the chart", () => {
        const m = mount();
        const [a, b, c] = m.ids;
        act(() => m.store.selectNodes([b!, c!]));
        const before = {
            b: at(node(m.store, b!)),
            c: at(node(m.store, c!)),
            a: at(node(m.store, a!)),
        };
        expect(m.store.getState().doc.settings.flowLayout).toBe("auto");
        drag(boxEl(m.view.container, b!), m.svg, [284, 282], [384, 312]);
        expect(at(node(m.store, b!))).toEqual({ x: before.b.x + 100, y: before.b.y + 30 });
        expect(at(node(m.store, c!))).toEqual({ x: before.c.x + 100, y: before.c.y + 30 });
        expect(at(node(m.store, a!))).toEqual(before.a);
        // The bend on B → C travels with them.
        expect(page(m.store).edges[1]!.waypoints).toEqual([{ x: 420, y: 360 }]);
        // No arrow was drawn by a drag that started on a box.
        expect(page(m.store).edges).toHaveLength(2);
        // Moved by hand: held in place, in the same undo step as the move.
        expect(m.store.getState().doc.settings.flowLayout).toBe("manual");
        act(() => m.store.undo());
        expect(at(node(m.store, b!))).toEqual(before.b);
        expect(m.store.getState().doc.settings.flowLayout).toBe("auto");
        m.view.unmount();
    });

    it("arrow keys nudge a selection of several (1px, ⇧ 10px) and walk from one box", () => {
        const m = mount();
        const [a, b, c] = m.ids;
        act(() => m.store.selectNodes([a!, b!]));
        const was = { a: at(node(m.store, a!)), b: at(node(m.store, b!)) };
        act(() => {
            press("ArrowRight");
        });
        expect(at(node(m.store, a!))).toEqual({ x: was.a.x + 1, y: was.a.y });
        expect(at(node(m.store, b!))).toEqual({ x: was.b.x + 1, y: was.b.y });
        act(() => {
            press("ArrowDown", { shiftKey: true });
        });
        expect(at(node(m.store, a!))).toEqual({ x: was.a.x + 1, y: was.a.y + 10 });
        expect(at(node(m.store, c!)).y).toBe(node(m.store, c!).y);

        act(() => m.store.selectNodes([b!]));
        const still = at(node(m.store, b!));
        act(() => {
            press("ArrowDown");
        });
        expect(m.store.selectedNodeIds()).toEqual([c]);
        expect(at(node(m.store, b!))).toEqual(still);
        m.view.unmount();
    });
});

describe("the selection toolbar on several boxes", () => {
    it("a colour applies to every selected box, and only to them", () => {
        const m = mount();
        const [a, b, c] = m.ids;
        act(() => m.store.selectNodes([a!, b!]));
        const untouched = node(m.store, c!).style.fill;
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Green" }));
        });
        const green = swatchFor("green", "light");
        expect(node(m.store, a!).style.fill).toBe(green.fill);
        expect(node(m.store, b!).style.fill).toBe(green.fill);
        expect(node(m.store, c!).style.fill).toBe(untouched);
        // A flowchart box wears its colour as its fill, and the toolbar says so.
        expect(screen.getByRole("button", { name: "Green" })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
        m.view.unmount();
    });

    it("+ on a decision adds its Yes branch, then its No", () => {
        const m = mount();
        const [, b] = m.ids;
        act(() => commitNodeText(m.store, node(m.store, b!), "In stock?"));
        expect(node(m.store, b!).shape).toBe("decision");
        for (let i = 0; i < 2; i++) {
            act(() => m.store.setEditing(null));
            act(() => m.store.selectNodes([b!]));
            act(() => {
                fireEvent.click(screen.getByRole("button", { name: "Add next step" }));
            });
        }
        const labels = page(m.store)
            .edges.filter(e => e.from.nodeId === b)
            .map(e => e.labels[0]?.text ?? "");
        expect(labels).toEqual(["", "Yes", "No"]);
        m.view.unmount();
    });
});

describe("the Steps panel with several boxes selected", () => {
    it("highlights every selected box's line", () => {
        const doc = buildTemplate("blank", "Flow", "light");
        const store = new EditorStore(doc);
        const ids = ["Start", "Pack", "Ship"].map((text, i) =>
            insertShape(store, "process", { x: 0, y: i * 120 }, { text })
        );
        store.updatePage(
            p => ({
                ...p,
                edges: [
                    createEdge({ from: { nodeId: ids[0]! }, to: { nodeId: ids[1]! } }),
                    createEdge({ from: { nodeId: ids[1]! }, to: { nodeId: ids[2]! } }),
                ],
            }),
            { transient: true }
        );
        store.setEditing(null);
        const view = render(
            <EditorProvider store={store}>
                <div data-steps-panel-host="">
                    <StepsPanel canvasSize={{ w: CANVAS.width, h: CANVAS.height }} />
                </div>
            </EditorProvider>
        );
        act(() => store.selectNodes([ids[0]!, ids[2]!]));
        const lines = Array.from(view.container.querySelectorAll("[data-line]"));
        const lit = lines.filter(l => l.hasAttribute("data-selected")).map(l => l.textContent);
        expect(lit).toEqual(["Start", "Ship"]);
        view.unmount();
    });
});
