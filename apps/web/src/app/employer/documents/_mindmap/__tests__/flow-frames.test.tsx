/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { FlowOverlay } from "../flow";
import { menuOf } from "../flow/pick/menu";
import { BURST_IDLE, PREVIEW_MAX_WAIT, StepsSync } from "../flow/steps/sync";
import {
    addConnected,
    addNextStep,
    applySwatch,
    commitNodeText,
    groupSelection,
    setBranchWords,
    styleTextSelection,
} from "../model/commands";
import { swatchFor } from "../model/palette";
import { fitContainers } from "../model/containers";
import { activePage, childrenOf, nodeById } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { tidyChart } from "../model/flowchart/arrange";
import { nodeBounds, rectContainsRect } from "../model/geometry";
import { EditorStore } from "../model/store";
import type { DiagramKind, DiagramNode, FlowLayout } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { SelectionToolbar } from "../ui/SelectionToolbar";

/**
 * Groups and frames holding their boxes (P13).
 *
 * 1. A box in a group is selected, dragged and outlined as its group;
 *    double-click goes inside; the group always wraps its members.
 * 2. A double-click inside a frame adds a box there, in the frame; its title
 *    is renamed by double-clicking the title.
 * 3. Tab never clones a frame or a group (an empty frame gets a first step).
 * 4. A drag on a frame's empty inside is a marquee; the frame moves by its
 *    title or edge, or once selected.
 * 5. New and moved children stay in their frame, which grows to hold them.
 * 6. Arranging keeps boxes inside their frames.
 */

const CANVAS = { width: 1200, height: 900 };
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

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string): DiagramNode => nodeById(page(store), id)!;
const at = (nd: DiagramNode) => ({ x: nd.x, y: nd.y });
const holds = (frame: DiagramNode, nd: DiagramNode) =>
    rectContainsRect(nodeBounds(frame), nodeBounds(nd));

/**
 * A board with a frame at (300, 200) 400 × 300 holding one step, two grouped
 * boxes on the right, and one loose box on the left.
 */
function scene(kind: DiagramKind = "flowchart", flowLayout: FlowLayout = "manual") {
    const frame = createNode({ shape: "frame", x: 300, y: 200, w: 400, h: 300, text: "Team" });
    const inside = createNode({
        shape: "process",
        x: 420,
        y: 240,
        w: 160,
        h: 60,
        text: "Inside",
        parentId: frame.id,
    });
    const g1 = createNode({ shape: "process", x: 820, y: 220, w: 120, h: 60, text: "G1" });
    const g2 = createNode({ shape: "process", x: 820, y: 360, w: 120, h: 60, text: "G2" });
    const loose = createNode({ shape: "process", x: 40, y: 600, w: 120, h: 60, text: "Loose" });
    const edge = {
        ...createEdge({ from: { nodeId: g1.id }, to: { nodeId: g2.id } }),
        waypoints: [{ x: 990, y: 320 }],
    };
    const doc = createDoc("Frames", [
        { ...createPage(), nodes: [frame, inside, g1, g2, loose], edges: [edge] },
    ]);
    doc.settings = {
        ...doc.settings,
        kind,
        flowLayout,
        snapToGrid: false,
        snapToObjects: false,
    };
    const store = new EditorStore(doc);
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    setBranchWords(store, { yes: "Yes", no: "No" });
    store.selectNodes([g1.id, g2.id]);
    groupSelection(store);
    const group = store.selectedNodeIds()[0]!;
    store.clearSelection();
    return { store, frame: frame.id, inside: inside.id, g1: g1.id, g2: g2.id, group, edge };
}

function mount(s: ReturnType<typeof scene>) {
    const onEditText = jest.fn();
    const view = render(
        <EditorProvider store={s.store}>
            <div data-mindmap-stage="">
                <Canvas
                    callbacks={{ onContextMenuAt: jest.fn(), onEditText, frameTitle: "Frame" }}
                />
                <SelectionToolbar onMore={jest.fn()} />
                <FlowOverlay canvasSize={{ w: CANVAS.width, h: CANVAS.height }} />
            </div>
        </EditorProvider>
    );
    const svg = view.container.querySelector("svg")!;
    return { ...s, view, svg, onEditText };
}

const hitOf = (container: HTMLElement, id: string) =>
    container.querySelector(`g[data-node-id="${id}"]`)!;

function press(el: Element, x: number, y: number, init: MouseEventInit = {}) {
    act(() => {
        el.dispatchEvent(pointer("pointerdown", x, y, { button: 0, buttons: 1, ...init }));
    });
}
function dragTo(svg: Element, from: [number, number], to: [number, number]) {
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
function click(el: Element, svg: Element, x: number, y: number) {
    press(el, x, y);
    act(() => {
        svg.dispatchEvent(pointer("pointerup", x, y, { buttons: 0 }));
    });
}
function dblclick(el: Element, svg: Element, x: number, y: number) {
    click(el, svg, x, y);
    act(() => {
        el.dispatchEvent(pointer("dblclick", x, y));
    });
}

describe("1 · a group holds together", () => {
    it("clicking a grouped box selects its group; dragging moves the group, arrows and all", () => {
        const m = mount(scene());
        click(hitOf(m.view.container, m.g1), m.svg, 880, 250);
        expect(m.store.selectedNodeIds()).toEqual([m.group]);

        const before = { g1: at(node(m.store, m.g1)), g2: at(node(m.store, m.g2)) };
        press(hitOf(m.view.container, m.g1), 880, 250);
        dragTo(m.svg, [880, 250], [880, 330]);
        expect(at(node(m.store, m.g1))).toEqual({ x: before.g1.x, y: before.g1.y + 80 });
        expect(at(node(m.store, m.g2))).toEqual({ x: before.g2.x, y: before.g2.y + 80 });
        expect(page(m.store).edges[0]!.waypoints).toEqual([{ x: 990, y: 400 }]);
        // The outline wraps its members where they are now.
        const g = node(m.store, m.group);
        expect(g.y).toBe(node(m.store, m.g1).y);
        m.view.unmount();
    });

    it("double-click goes inside: selects the box; the next one opens its label", () => {
        const m = mount(scene());
        dblclick(hitOf(m.view.container, m.g2), m.svg, 880, 390);
        expect(m.store.selectedNodeIds()).toEqual([m.g2]);
        expect(m.onEditText).not.toHaveBeenCalled();
        // Inside now: a click on the other member picks it, not the group.
        click(hitOf(m.view.container, m.g1), m.svg, 880, 250);
        expect(m.store.selectedNodeIds()).toEqual([m.g1]);
        dblclick(hitOf(m.view.container, m.g1), m.svg, 880, 250);
        expect(m.onEditText).toHaveBeenCalledWith({ kind: "node", id: m.g1 });
        m.view.unmount();
    });

    it("the outline follows a member that moves or grows, and an empty group goes", () => {
        const s = scene();
        act(() => s.store.selectNodes([s.g2]));
        s.store.updatePage(
            p => ({
                ...p,
                nodes: p.nodes.map(n => (n.id === s.g2 ? { ...n, x: n.x + 200, h: 120 } : n)),
            }),
            { label: "Move" }
        );
        const g = node(s.store, s.group);
        const g2 = node(s.store, s.g2);
        expect(g.x + g.w).toBe(g2.x + g2.w);
        expect(g.y + g.h).toBe(g2.y + g2.h);
        s.store.updatePage(
            p => ({ ...p, nodes: p.nodes.filter(n => n.id !== s.g1 && n.id !== s.g2) }),
            { label: "Delete" }
        );
        expect(nodeById(page(s.store), s.group)).toBeUndefined();
        expect(s.store.getState().selection).toEqual([]);
    });

    it("a colour or a type size picked with the group selected changes its boxes", () => {
        const s = scene();
        s.store.selectNodes([s.group]);
        applySwatch(s.store, "green");
        styleTextSelection(s.store, { size: 18 });
        const green = swatchFor("green", "light");
        for (const id of [s.g1, s.g2]) {
            expect(node(s.store, id).style.fill).toBe(green.fill);
            expect(node(s.store, id).textStyle.size).toBe(18);
        }
        expect(node(s.store, s.inside).style.fill).not.toBe(green.fill);
    });

    it("a marquee over a grouped box selects the group", () => {
        const m = mount(scene());
        press(m.svg, 790, 200);
        dragTo(m.svg, [790, 200], [900, 260]);
        expect(m.store.selectedNodeIds()).toEqual([m.group]);
        m.view.unmount();
    });
});

describe("2 · a double-click inside a frame", () => {
    it("on a flowchart, opens the menu there, and the pick joins the frame", () => {
        const m = mount(scene());
        dblclick(hitOf(m.view.container, m.frame), m.svg, 500, 420);
        expect(menuOf(m.store)!.at).toEqual({ x: 500, y: 420 });
        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "1" });
        });
        const made = page(m.store).nodes.at(-1)!;
        expect(made.parentId).toBe(m.frame);
        expect(m.onEditText).not.toHaveBeenCalledWith({ kind: "node", id: m.frame });
        m.view.unmount();
    });

    it("on a mindmap, puts a box there, in the frame", () => {
        const m = mount(scene("freeform"));
        dblclick(hitOf(m.view.container, m.frame), m.svg, 500, 420);
        const made = page(m.store).nodes.at(-1)!;
        expect(made.parentId).toBe(m.frame);
        expect(m.onEditText).toHaveBeenCalledWith({ kind: "node", id: made.id });
        m.view.unmount();
    });

    it("on its title, renames the frame", () => {
        const m = mount(scene());
        dblclick(hitOf(m.view.container, m.frame), m.svg, 340, 186);
        expect(m.onEditText).toHaveBeenCalledWith({ kind: "node", id: m.frame });
        expect(menuOf(m.store)).toBeNull();
        m.view.unmount();
    });

    it("selected, the frame's toolbar sits above its title, never over it", () => {
        const m = mount(scene());
        act(() => m.store.setChromeDepth("focus"));
        click(hitOf(m.view.container, m.frame), m.svg, 340, 186);
        expect(m.store.selectedNodeIds()).toEqual([m.frame]);
        const bar = screen.getByRole("toolbar");
        // The title band runs from 26px above the frame (y 174) to its top.
        const frame = node(m.store, m.frame);
        const titleTop = frame.y - 26;
        expect(parseFloat(bar.style.top) + 36).toBeLessThanOrEqual(titleTop);
        // The second click of a double-click on the title lands on the title.
        dblclick(hitOf(m.view.container, m.frame), m.svg, 340, 186);
        expect(m.onEditText).toHaveBeenCalledWith({ kind: "node", id: m.frame });
        m.view.unmount();
    });

    it("a frame drawn with the Frame tool starts with a title, open for typing", () => {
        const m = mount(scene());
        act(() => m.store.setTool("frame"));
        press(m.svg, 100, 560);
        dragTo(m.svg, [100, 560], [300, 760]);
        const made = page(m.store).nodes.find(n => n.shape === "frame" && n.id !== m.frame)!;
        expect(made.text).toBe("Frame");
        expect(m.onEditText).toHaveBeenCalledWith({ kind: "node", id: made.id });
        m.view.unmount();
    });
});

describe("3 · Tab never clones a frame or a group", () => {
    it("on a frame that holds something, does nothing; on a group, nothing", () => {
        const s = scene();
        const count = page(s.store).nodes.length;
        expect(addNextStep(s.store, s.frame)).toBeNull();
        expect(addConnected(s.store, s.group)).toBeNull();
        expect(page(s.store).nodes).toHaveLength(count);
        expect(page(s.store).edges).toHaveLength(1);
    });

    it("on an empty frame, adds its first step inside it", () => {
        const s = scene();
        s.store.updatePage(p => ({ ...p, nodes: p.nodes.filter(n => n.id !== s.inside) }), {
            label: "Delete",
        });
        const id = addConnected(s.store, s.frame)!;
        const step = node(s.store, id);
        expect(step.parentId).toBe(s.frame);
        expect(step.shape).toBe("process");
        expect(holds(node(s.store, s.frame), step)).toBe(true);
        expect(page(s.store).edges).toHaveLength(1);
        expect(s.store.getState().editing).toEqual({ kind: "node", id });
    });
});

describe("4 · a drag inside a frame", () => {
    it("on its empty inside is a marquee over what it holds; the frame stays", () => {
        const m = mount(scene());
        const frameAt = at(node(m.store, m.frame));
        press(hitOf(m.view.container, m.frame), 330, 230);
        dragTo(m.svg, [330, 230], [600, 320]);
        expect(m.store.selectedNodeIds()).toEqual([m.inside]);
        expect(at(node(m.store, m.frame))).toEqual(frameAt);
        m.view.unmount();
    });

    it("by its title moves the frame with what it holds", () => {
        const m = mount(scene());
        const inside = at(node(m.store, m.inside));
        press(hitOf(m.view.container, m.frame), 340, 186);
        dragTo(m.svg, [340, 186], [400, 226]);
        expect(m.store.selectedNodeIds()).toEqual([m.frame]);
        expect(at(node(m.store, m.frame))).toEqual({ x: 360, y: 240 });
        expect(at(node(m.store, m.inside))).toEqual({ x: inside.x + 60, y: inside.y + 40 });
        m.view.unmount();
    });

    it("once the frame is selected, from anywhere in it", () => {
        const m = mount(scene());
        act(() => m.store.selectNodes([m.frame]));
        press(hitOf(m.view.container, m.frame), 330, 450);
        dragTo(m.svg, [330, 450], [350, 450]);
        expect(at(node(m.store, m.frame))).toEqual({ x: 320, y: 200 });
        m.view.unmount();
    });
});

describe("5 · children stay in their frame, and it grows to hold them", () => {
    it("Tab from a box in a frame: the step joins the frame, which grows", () => {
        const s = scene();
        let last = s.inside;
        for (let i = 0; i < 4; i++) {
            last = addNextStep(s.store, last)!;
            commitNodeText(s.store, node(s.store, last), `Step ${i}`);
        }
        s.store.setEditing(null);
        const frame = node(s.store, s.frame);
        for (const kid of childrenOf(page(s.store), s.frame)) {
            expect(holds(frame, kid)).toBe(true);
        }
        expect(childrenOf(page(s.store), s.frame)).toHaveLength(5);
        expect(frame.h).toBeGreaterThan(300);
        // Never shrinks on its own.
        expect(frame.w).toBeGreaterThanOrEqual(400);
    });

    it("a box dragged past the frame's edge (its centre still in) grows it; dragged out, it leaves", () => {
        const m = mount(scene());
        // Centre to (620, 470): still inside, but its bottom pokes out.
        press(hitOf(m.view.container, m.inside), 500, 270);
        dragTo(m.svg, [500, 270], [620, 470]);
        expect(node(m.store, m.inside).parentId).toBe(m.frame);
        expect(holds(node(m.store, m.frame), node(m.store, m.inside))).toBe(true);
        // Out by its centre: it leaves, and the frame is not dragged along.
        const frameBefore = node(m.store, m.frame);
        press(hitOf(m.view.container, m.inside), 620, 470);
        dragTo(m.svg, [620, 470], [1050, 700]);
        expect(node(m.store, m.inside).parentId).toBeNull();
        expect(at(node(m.store, m.frame))).toEqual(at(frameBefore));
        expect(node(m.store, m.frame).w).toBe(frameBefore.w);
        m.view.unmount();
    });

    it("a line written in the Steps panel after a framed step joins the frame", () => {
        jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
        const s = scene();
        const sync = new StepsSync(s.store);
        sync.start();
        const text = sync.getSnapshot().text;
        expect(text).toContain("Inside");
        sync.edit(text.replace("Inside", "Inside\nNext one"));
        jest.advanceTimersByTime(PREVIEW_MAX_WAIT);
        jest.advanceTimersByTime(BURST_IDLE);
        const made = page(s.store).nodes.find(n => n.text === "Next one")!;
        expect(made.parentId).toBe(s.frame);
        expect(holds(node(s.store, s.frame), made)).toBe(true);
        sync.stop();
        jest.useRealTimers();
    });
});

describe("6 · arranging keeps boxes in their frames", () => {
    it("a chart in a frame is laid out inside it, and the frame grows to hold it", () => {
        const s = scene("flowchart", "auto");
        let last = s.inside;
        for (let i = 0; i < 3; i++) {
            last = addNextStep(s.store, last)!;
            commitNodeText(s.store, node(s.store, last), `Step ${i}`);
        }
        s.store.setEditing(null);
        const frame = node(s.store, s.frame);
        const kids = childrenOf(page(s.store), s.frame);
        expect(kids).toHaveLength(4);
        for (const kid of kids) expect(holds(frame, kid)).toBe(true);
        const cx = new Set(kids.map(k => k.x + k.w / 2));
        expect(cx.size).toBe(1);
    });

    it("boxes in a frame are arranged among themselves, the rest among themselves", () => {
        const f = createNode({ shape: "frame", x: 0, y: 0, w: 300, h: 300 });
        const a = createNode({ shape: "process", x: 20, y: 20, w: 100, h: 50, parentId: f.id });
        const b = createNode({ shape: "process", x: 150, y: 200, w: 100, h: 50, parentId: f.id });
        const c = createNode({ shape: "process", x: 600, y: 600, w: 100, h: 50 });
        const d = createNode({ shape: "process", x: 900, y: 700, w: 100, h: 50 });
        const p = {
            ...createPage(),
            nodes: [f, a, b, c, d],
            edges: [
                createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } }),
                createEdge({ from: { nodeId: b.id }, to: { nodeId: c.id } }),
                createEdge({ from: { nodeId: c.id }, to: { nodeId: d.id } }),
            ],
        };
        const tidied = tidyChart(p, [a.id]);
        const got = (id: string) => tidied.nodes.find(n => n.id === id)!;
        // A and B in a column inside the frame, from A; C and D from C.
        expect(got(a.id)).toMatchObject({ x: 20, y: 20 });
        expect(got(b.id).x).toBe(20);
        expect(got(c.id)).toMatchObject({ x: 600, y: 600 });
        expect(got(d.id).x).toBe(600);
        // The store's commit then grows the frame to hold B.
        const fitted = fitContainers(p, tidied, { frames: true });
        expect(holds(fitted.nodes.find(n => n.id === f.id)!, got(b.id))).toBe(true);
    });
});
