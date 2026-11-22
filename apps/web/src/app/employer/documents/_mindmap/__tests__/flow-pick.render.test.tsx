/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { insertShape } from "../model/commands";
import { FlowOverlay } from "../flow";
import type { FlowLayout } from "../model/types";
import { activePage, nodeById } from "../model/doc";
import { nodeCenter } from "../model/geometry";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { EmptyCanvasHint } from "../ui/EmptyCanvasHint";
import { closeMenu, menuOf } from "../flow/pick/menu";

/**
 * The "What goes here?" menu against the real canvas, on every flowchart: an
 * arrow pulled out of a box and let go in space opens it there, a
 * double-click on empty canvas opens it too; and the empty board's prompt.
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

/**
 * A blank flowchart with one step at (84, 32). Hand-placed unless asked: the
 * menu's own placement is what most of these check, and a chart that
 * arranges itself moves the pick into its row (tested below).
 */
function mount({ empty = false, layout = "manual" as FlowLayout } = {}) {
    const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    // A clean board so the drags land where the pointer is.
    store.update(
        d => ({ ...d, settings: { ...d.settings, snapToGrid: false, flowLayout: layout } }),
        { transient: true }
    );
    const first = empty ? null : insertShape(store, "process", { x: 84, y: 32 });
    store.setEditing(null);
    store.clearSelection();
    const view = render(
        <EditorProvider store={store}>
            <div data-mindmap-stage="">
                <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                <EmptyCanvasHint canvasSize={{ w: 1000, h: 700 }} onPasteOutline={jest.fn()} />
                <FlowOverlay canvasSize={{ w: 1000, h: 700 }} />
            </div>
        </EditorProvider>
    );
    const svg = view.container.querySelector("svg");
    if (!svg) throw new Error("canvas not rendered");
    return { store, view, svg, first };
}

const page = (store: EditorStore) => activePage(store.getState().doc);

/** Pull an arrow out of the box's right-hand dot and let go at (x, y). */
function dragOut({ store, view, svg }: ReturnType<typeof mount>, id: string, x: number, y: number) {
    act(() => store.selectNodes([id]));
    const dot = view.container.querySelector(`[data-node-id="${id}"][data-port="e"] circle`)!;
    expect(dot).not.toBeNull();
    act(() => {
        dot.dispatchEvent(pointer("pointerdown", 184, 32, { button: 0, buttons: 1 }));
    });
    for (const [mx, my] of [
        [260, 34],
        [x, y],
    ] as const) {
        act(() => {
            svg.dispatchEvent(pointer("pointermove", mx, my, { buttons: 1 }));
        });
        runFrame();
    }
    act(() => {
        svg.dispatchEvent(pointer("pointerup", x, y, { buttons: 0 }));
    });
}

describe("pick menu: an arrow let go in space", () => {
    it("opens the menu there, with a dashed preview and nothing on the page", () => {
        const m = mount();
        const before = page(m.store);
        dragOut(m, m.first!, 460, 50);

        expect(page(m.store)).toBe(before);
        const menu = screen.getByRole("menu");
        const items = within(menu).getAllByRole("menuitem");
        expect(items.map(i => i.textContent)).toEqual([
            "1Step",
            "2Decision",
            "3Start/End",
            "4Data",
            "5Note",
            "6Just the arrow",
        ]);
        // The step is highlighted and focused, ready for Enter.
        expect(items[0]).toHaveAttribute("data-active", "true");
        expect(document.activeElement).toBe(items[0]);
        // The preview is drawn on the board: the arrow and the box.
        const ghost = m.view.container.querySelector("[data-pick-ghost]")!;
        expect(ghost).not.toBeNull();
        expect(ghost.querySelectorAll("path").length).toBeGreaterThan(2);
        act(() => closeMenu(m.store));
        m.view.unmount();
    });

    it("a number key picks: the decision, joined, label open, on the step's line", () => {
        const m = mount();
        dragOut(m, m.first!, 460, 50);
        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "2" });
        });

        expect(screen.queryByRole("menu")).toBeNull();
        const made = page(m.store).nodes.at(-1)!;
        expect(made.shape).toBe("decision");
        // 18px off the step's centre line: lined up with it (C3).
        expect(nodeCenter(made)).toEqual({ x: 460, y: 32 });
        const edge = page(m.store).edges[0]!;
        expect(edge.from.nodeId).toBe(m.first);
        expect(edge.to.nodeId).toBe(made.id);
        expect(m.store.getState().editing).toEqual({ kind: "node", id: made.id });

        // One step: the box and its arrow go together.
        act(() => {
            m.store.setEditing(null);
            m.store.undo();
        });
        expect(page(m.store).nodes.map(n => n.id)).toEqual([m.first]);
        expect(page(m.store).edges).toHaveLength(0);
        m.view.unmount();
    });

    it("arrows move through the options and Enter picks", () => {
        const m = mount();
        dragOut(m, m.first!, 460, 300);
        const menu = screen.getByRole("menu");
        act(() => {
            fireEvent.keyDown(menu, { key: "ArrowDown" });
        });
        act(() => {
            fireEvent.keyDown(menu, { key: "ArrowRight" });
        });
        expect(within(menu).getByText("Note").closest("[role=menuitem]")).toHaveAttribute(
            "data-active",
            "true"
        );
        act(() => {
            fireEvent.keyDown(menu, { key: "Enter" });
        });
        expect(page(m.store).nodes.at(-1)!.shape).toBe("sticky");
        m.view.unmount();
    });

    it("'Just the arrow' leaves the arrow with its end at the point", () => {
        const m = mount();
        dragOut(m, m.first!, 460, 300);
        act(() => {
            fireEvent.click(screen.getByText("Just the arrow"));
        });
        expect(page(m.store).nodes).toHaveLength(1);
        expect(page(m.store).edges[0]!.to).toEqual({ point: { x: 460, y: 300 } });
        m.view.unmount();
    });

    it("Escape closes it and leaves nothing on the page", () => {
        const m = mount();
        const before = m.store.getState().doc;
        dragOut(m, m.first!, 460, 300);
        act(() => {
            fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(menuOf(m.store)).toBeNull();
        expect(m.store.getState().doc).toBe(before);
        expect(m.view.container.querySelector("[data-pick-ghost]")).toBeNull();
        m.view.unmount();
    });

    it("a press elsewhere closes it and leaves nothing either", async () => {
        const m = mount();
        const before = m.store.getState().doc;
        dragOut(m, m.first!, 460, 300);
        // Radix starts listening for an outside press a tick after opening.
        await act(async () => {
            await new Promise(r => setTimeout(r, 0));
        });
        act(() => {
            fireEvent.pointerDown(m.svg, { button: 0, buttons: 1, clientX: 900, clientY: 600 });
        });
        expect(menuOf(m.store)).toBeNull();
        expect(m.store.getState().doc).toBe(before);
        m.view.unmount();
    });
});

describe("pick menu: a double-click on empty canvas", () => {
    it("opens the menu without 'Just the arrow', and a pick lands there", () => {
        const m = mount();
        act(() => {
            m.svg.dispatchEvent(pointer("pointerdown", 600, 400, { button: 0, buttons: 1 }));
        });
        act(() => {
            m.svg.dispatchEvent(pointer("pointerup", 600, 400, { buttons: 0 }));
        });
        act(() => {
            m.svg.dispatchEvent(pointer("dblclick", 600, 400));
        });
        const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
        expect(items).toHaveLength(5);
        expect(screen.queryByText("Just the arrow")).toBeNull();
        // Nothing yet: the double-click no longer drops a box by itself.
        expect(page(m.store).nodes).toHaveLength(1);

        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "3" });
        });
        const made = page(m.store).nodes.at(-1)!;
        expect(made.shape).toBe("terminator");
        expect(nodeCenter(made)).toEqual({ x: 600, y: 400 });
        expect(page(m.store).edges).toHaveLength(0);
        expect(nodeById(page(m.store), made.id)!.textStyle.bold).toBe(false);
        m.view.unmount();
    });
});

describe("pick menu: on a chart that arranges itself", () => {
    it("the pick joins the chart's row below the step, Yes out of a decision", () => {
        const m = mount({ layout: "auto" });
        dragOut(m, m.first!, 460, 50);
        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "1" });
        });
        const step = nodeById(page(m.store), m.first!)!;
        const made = page(m.store).nodes.at(-1)!;
        expect(nodeCenter(made).x).toBe(nodeCenter(step).x);
        expect(made.y).toBeGreaterThan(step.y + step.h);
        m.view.unmount();
    });
});

describe("the empty flowchart", () => {
    it("offers the three ways to start in one opaque card", () => {
        const m = mount({ empty: true });
        const card = m.view.container.querySelector("[data-flow-empty-card]")!;
        expect(card).not.toBeNull();
        expect(card.className).toContain("bg-panel");
        expect(card).toHaveTextContent("Start typing to name the first step");
        expect(card).toHaveTextContent("Double-click anywhere to pick a shape");
        expect(card).toHaveTextContent("Or write the steps in the panel");
        m.view.unmount();
    });

    it("the ghost starts the chart empty, where the ghost is", () => {
        const m = mount({ empty: true });
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Type your first step" }));
        });
        const [made] = page(m.store).nodes;
        expect(made!.shape).toBe("process");
        expect(m.store.getState().editing).toEqual({ kind: "node", id: made!.id });
        m.view.unmount();
    });

    it("'write the steps' opens the Steps panel", () => {
        const m = mount({ empty: true });
        act(() => m.store.setStepsPanel(false));
        act(() => {
            fireEvent.click(
                screen.getByRole("button", { name: "Or write the steps in the panel" })
            );
        });
        expect(m.store.getState().stepsPanel).toBe(true);
        m.view.unmount();
    });

    it("steps aside while a double-click's menu is open", () => {
        const m = mount({ empty: true });
        act(() => {
            m.svg.dispatchEvent(pointer("dblclick", 500, 350));
        });
        expect(menuOf(m.store)!.at).toEqual({ x: 500, y: 350 });
        expect(m.view.container.querySelector("[data-flow-empty-card]")).toBeNull();
        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "1" });
        });
        const [made] = page(m.store).nodes;
        expect(made!.shape).toBe("process");
        expect(nodeCenter(made!)).toEqual({ x: 500, y: 350 });
        m.view.unmount();
    });
});
