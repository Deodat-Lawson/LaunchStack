/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { insertShape } from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { nodeCenter } from "../model/geometry";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { EmptyCanvasHint } from "../ui/EmptyCanvasHint";
import { uiC } from "../variants/c-drop-pick/ui";
import { closeMenu, menuOf } from "../variants/c-drop-pick/menu";

/**
 * Direction C's gestures against the real canvas: an arrow pulled out of a
 * box and let go in space opens the pick menu there, a double-click on empty
 * canvas opens it too, and the empty page's button opens it in the middle.
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

const Overlay = uiC.StageOverlay!;

/** A blank flowchart in direction C, with one step at (84, 32). */
function mount({ empty = false } = {}) {
    const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
    store.setFlowVariant("c");
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    // A clean board so the drags land where the pointer is.
    store.update(d => ({ ...d, settings: { ...d.settings, snapToGrid: false } }), {
        transient: true,
    });
    const first = empty ? null : insertShape(store, "process", { x: 84, y: 32 });
    store.setEditing(null);
    store.clearSelection();
    const view = render(
        <EditorProvider store={store}>
            <div data-mindmap-stage="">
                <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                <EmptyCanvasHint canvasSize={{ w: 1000, h: 700 }} onPasteOutline={jest.fn()} />
                <Overlay canvasSize={{ w: 1000, h: 700 }} />
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

describe("variant C: an arrow let go in space (C1)", () => {
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
        const ghost = m.view.container.querySelector("[data-c-ghost]")!;
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
        expect(m.view.container.querySelector("[data-c-ghost]")).toBeNull();
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

describe("variant C: a double-click on empty canvas (C2)", () => {
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

describe("variant C: the empty page (C5)", () => {
    it("invites a double-click, and its button opens the menu in the middle", () => {
        const m = mount({ empty: true });
        expect(screen.getByText("Double-click anywhere to add a step")).toBeInTheDocument();
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: /Choose the first shape/ }));
        });
        expect(menuOf(m.store)!.at).toEqual({ x: 500, y: 350 });
        expect(within(screen.getByRole("menu")).getAllByRole("menuitem")).toHaveLength(5);
        // The words step aside while the menu is open.
        expect(screen.queryByText("Double-click anywhere to add a step")).toBeNull();
        act(() => {
            fireEvent.keyDown(screen.getByRole("menu"), { key: "1" });
        });
        const [made] = page(m.store).nodes;
        expect(made!.shape).toBe("process");
        expect(nodeCenter(made!)).toEqual({ x: 500, y: 350 });
        m.view.unmount();
    });
});
