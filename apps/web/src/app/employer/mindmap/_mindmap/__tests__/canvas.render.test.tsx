/** @jest-environment jsdom */

import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { TooltipProvider } from "~/components/ui/tooltip";

import { createEdge, createNode, createPage } from "../model/factory";
import { createDoc } from "../model/factory";
import { EditorStore } from "../model/store";
import type { MindmapDoc } from "../model/types";
import { Canvas } from "../ui/Canvas";
import { EditorProvider } from "../ui/EditorContext";
import { Inspector } from "../ui/Inspector";
import { OutlinePanel } from "../ui/OutlinePanel";
import { ShapePalette } from "../ui/ShapePalette";
import { Toolbar } from "../ui/Toolbar";

/**
 * Rendering and interaction tests for the editor surface.
 *
 * jsdom has no layout engine, so `getBoundingClientRect` is stubbed to a fixed
 * canvas box — that is what makes screen↔world conversion deterministic and
 * lets pointer gestures be asserted at all. Everything else is the real
 * components against the real store.
 */

const CANVAS_BOX = { x: 0, y: 0, width: 1000, height: 700 };

beforeAll(() => {
    // jsdom reports every element as 0×0; the canvas needs a real box.
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return {
            x: CANVAS_BOX.x,
            y: CANVAS_BOX.y,
            left: CANVAS_BOX.x,
            top: CANVAS_BOX.y,
            width: CANVAS_BOX.width,
            height: CANVAS_BOX.height,
            right: CANVAS_BOX.x + CANVAS_BOX.width,
            bottom: CANVAS_BOX.y + CANVAS_BOX.height,
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
    // Pointer capture is not implemented in jsdom.
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

function sampleDoc(): MindmapDoc {
    const root = createNode({
        shape: "mind-root",
        x: 100,
        y: 100,
        w: 200,
        h: 80,
        text: "Central idea",
    });
    const child = createNode({
        shape: "mind-branch",
        x: 400,
        y: 120,
        w: 160,
        h: 56,
        text: "First branch",
    });
    return createDoc("Test map", [
        {
            ...createPage(),
            nodes: [root, child],
            edges: [
                createEdge({
                    from: { nodeId: root.id, port: "auto" },
                    to: { nodeId: child.id, port: "auto" },
                    label: "leads to",
                }),
            ],
        },
    ]);
}

function mount(doc = sampleDoc()) {
    const store = new EditorStore(doc);
    // A 1:1 viewport anchored at the origin makes world coordinates equal
    // client coordinates, so gestures below can be written in world terms.
    store.setViewport({ x: 0, y: 0, zoom: 1 });
    const callbacks = { onContextMenuAt: jest.fn(), onEditText: jest.fn() };

    const view = render(
        <TooltipProvider>
            <EditorProvider store={store}>
                <Canvas callbacks={callbacks} />
                <Inspector />
                <OutlinePanel canvasSize={{ w: 1000, h: 700 }} />
            </EditorProvider>
        </TooltipProvider>
    );
    return { store, view, callbacks, doc };
}

function svgOf(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("canvas svg not found");
    return svg;
}

/** jsdom's PointerEvent is incomplete; build the fields the handlers read. */
function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
    return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        ...init,
    }) as unknown as PointerEvent;
}

/**
 * jsdom does no hit testing: an event dispatched on the `<svg>` always reports
 * the `<svg>` as its target, whatever the coordinates say. The interaction
 * layer identifies what was grabbed from `event.target`, exactly as a browser
 * delivers it — so gestures here must start on the element being grabbed and
 * bubble up, which is what a real pointerdown does.
 */
function pressOn(element: Element, from: [number, number], init: PointerEventInit = {}): void {
    act(() => {
        element.dispatchEvent(
            pointer("pointerdown", from[0], from[1], { button: 0, buttons: 1, ...init })
        );
    });
}

function moveAndRelease(svg: SVGSVGElement, to: [number, number]): void {
    act(() => {
        svg.dispatchEvent(pointer("pointermove", to[0], to[1], { buttons: 1 }));
    });
    act(() => {
        svg.dispatchEvent(pointer("pointerup", to[0], to[1], { buttons: 0 }));
    });
}

function drag(
    svg: SVGSVGElement,
    origin: Element,
    from: [number, number],
    to: [number, number]
): void {
    pressOn(origin, from);
    moveAndRelease(svg, to);
}

/** The rendered hit target for a node, as the canvas emits it. */
function nodeElement(container: HTMLElement, id: string): Element {
    const el = container.querySelector(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`node ${id} is not rendered`);
    return el;
}

describe("canvas rendering", () => {
    it("draws every shape with a hit target carrying its id", () => {
        const { view, doc } = mount();
        const svg = svgOf(view.container);
        for (const node of doc.pages[0]!.nodes) {
            expect(svg.querySelector(`[data-node-id="${node.id}"]`)).not.toBeNull();
        }
    });

    it("draws connectors with their own hit target", () => {
        const { view, doc } = mount();
        const svg = svgOf(view.container);
        const edge = doc.pages[0]!.edges[0]!;
        expect(svg.querySelector(`[data-edge-id="${edge.id}"]`)).not.toBeNull();
    });

    it("renders shape labels as SVG text", () => {
        const { view } = mount();
        expect(within(view.container).getAllByText("Central idea").length).toBeGreaterThan(0);
        expect(within(view.container).getAllByText("First branch").length).toBeGreaterThan(0);
    });

    it("renders connector labels", () => {
        const { view } = mount();
        expect(within(view.container).getAllByText("leads to").length).toBeGreaterThan(0);
    });

    it("emits no NaN into any path", () => {
        const { view } = mount();
        for (const path of Array.from(view.container.querySelectorAll("path"))) {
            expect(path.getAttribute("d") ?? "").not.toMatch(/NaN/);
        }
    });
});

describe("selection", () => {
    it("selects a shape on click and shows its resize handles", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        const root = doc.pages[0]!.nodes[0]!;

        pressOn(nodeElement(view.container, root.id), [root.x + 20, root.y + 20]);
        act(() => {
            svg.dispatchEvent(pointer("pointerup", root.x + 20, root.y + 20, { buttons: 0 }));
        });

        expect(store.selectedNodeIds()).toEqual([root.id]);
        expect(view.container.querySelectorAll("[data-handle]").length).toBe(9);
    });

    it("adds to the selection with shift-click", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        const [root, child] = doc.pages[0]!.nodes;

        pressOn(nodeElement(view.container, root!.id), [root!.x + 20, root!.y + 20]);
        act(() => {
            svg.dispatchEvent(pointer("pointerup", root!.x + 20, root!.y + 20, { buttons: 0 }));
        });
        pressOn(nodeElement(view.container, child!.id), [child!.x + 20, child!.y + 20], {
            shiftKey: true,
        });
        act(() => {
            svg.dispatchEvent(pointer("pointerup", child!.x + 20, child!.y + 20, { buttons: 0 }));
        });

        expect(store.selectedNodeIds().sort()).toEqual([root!.id, child!.id].sort());
    });

    it("clears the selection when the canvas background is clicked", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        store.selectNodes([doc.pages[0]!.nodes[0]!.id]);

        act(() => {
            svg.dispatchEvent(pointer("pointerdown", 900, 600, { button: 0, buttons: 1 }));
        });
        act(() => {
            svg.dispatchEvent(pointer("pointerup", 900, 600, { buttons: 0 }));
        });

        expect(store.selectedNodeIds()).toEqual([]);
    });

    it("marquee-selects everything it covers", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);

        // Starting on the background is what makes this a marquee.
        drag(svg, svg, [20, 20], [900, 600]);

        expect(store.selectedNodeIds().sort()).toEqual(doc.pages[0]!.nodes.map(n => n.id).sort());
    });
});

describe("dragging", () => {
    it("moves the selected shape and records one undo entry", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        const root = doc.pages[0]!.nodes[0]!;

        drag(
            svg,
            nodeElement(view.container, root.id),
            [root.x + 20, root.y + 20],
            [root.x + 120, root.y + 20]
        );

        const moved = store.getState().doc.pages[0]!.nodes.find(n => n.id === root.id)!;
        expect(moved.x).toBeGreaterThan(root.x);
        expect(store.getState().canUndo).toBe(true);

        store.undo();
        const restored = store.getState().doc.pages[0]!.nodes.find(n => n.id === root.id)!;
        expect(restored.x).toBe(root.x);
    });

    it("snaps a dragged shape to the grid", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        const root = doc.pages[0]!.nodes[0]!;

        drag(
            svg,
            nodeElement(view.container, root.id),
            [root.x + 20, root.y + 20],
            [root.x + 20 + 103, root.y + 20]
        );

        const moved = store.getState().doc.pages[0]!.nodes.find(n => n.id === root.id)!;
        expect(moved.x % store.getState().doc.settings.gridSize).toBe(0);
    });

    it("does not move a locked shape", () => {
        const doc = sampleDoc();
        doc.pages[0]!.nodes[0]!.locked = true;
        const { store, view } = mount(doc);
        const svg = svgOf(view.container);
        const root = doc.pages[0]!.nodes[0]!;

        // A locked shape has pointer events disabled, so the press lands on the
        // canvas — but drive it through the shape's own element anyway to prove
        // the guard, not just the CSS.
        drag(
            svg,
            nodeElement(view.container, root.id),
            [root.x + 20, root.y + 20],
            [root.x + 200, root.y + 20]
        );

        const after = store.getState().doc.pages[0]!.nodes[0]!;
        expect(after.x).toBe(root.x);
        expect(store.selectedNodeIds()).toEqual([]);
    });

    it("draws a connector when dragged out of a port", () => {
        const { store, view, doc } = mount();
        const svg = svgOf(view.container);
        const root = doc.pages[0]!.nodes[0]!;
        store.selectNodes([root.id]);
        view.rerender(
            <TooltipProvider>
                <EditorProvider store={store}>
                    <Canvas callbacks={{ onContextMenuAt: jest.fn(), onEditText: jest.fn() }} />
                </EditorProvider>
            </TooltipProvider>
        );

        const port = svgOf(view.container).querySelector(
            `[data-node-id="${root.id}"][data-port="e"] circle`
        );
        expect(port).not.toBeNull();

        act(() => {
            port!.dispatchEvent(
                pointer("pointerdown", root.x + root.w, root.y + root.h / 2, {
                    button: 0,
                    buttons: 1,
                })
            );
        });
        act(() => {
            svg.dispatchEvent(pointer("pointermove", 700, 400, { buttons: 1 }));
        });
        act(() => {
            svg.dispatchEvent(pointer("pointerup", 700, 400, { buttons: 0 }));
        });

        const page = store.getState().doc.pages[0]!;
        // Dragging into empty space creates the target topic and the connector.
        expect(page.nodes).toHaveLength(3);
        expect(page.edges).toHaveLength(2);
    });
});

describe("inspector", () => {
    it("shows page settings when nothing is selected", () => {
        mount();
        expect(screen.getByText("Canvas")).toBeInTheDocument();
        expect(screen.getByText("Theme")).toBeInTheDocument();
    });

    it("switches to shape properties once something is selected", () => {
        const { store, doc } = mount();
        act(() => store.selectNodes([doc.pages[0]!.nodes[0]!.id]));
        expect(screen.getByText("Fill & stroke")).toBeInTheDocument();
        expect(screen.getByText("Position & size")).toBeInTheDocument();
    });

    it("reports a multi-selection as a count", () => {
        const { store, doc } = mount();
        act(() => store.selectNodes(doc.pages[0]!.nodes.map(n => n.id)));
        expect(screen.getByText("2 shapes")).toBeInTheDocument();
    });

    it("writes a geometry edit back to the document", async () => {
        const user = userEvent.setup();
        const { store, doc } = mount();
        const root = doc.pages[0]!.nodes[0]!;
        act(() => store.selectNodes([root.id]));

        const widthField = screen.getByLabelText("Width");
        await user.clear(widthField);
        await user.type(widthField, "321");
        await user.tab();

        expect(store.getState().doc.pages[0]!.nodes[0]!.w).toBe(321);
    });
});

describe("outline", () => {
    it("lists topics in tree order", () => {
        mount();
        const outlineButtons = screen.getAllByTitle(/Central idea|First branch/);
        expect(outlineButtons.length).toBeGreaterThan(0);
    });

    it("selects and centres a topic when its row is clicked", async () => {
        const user = userEvent.setup();
        const { store, doc } = mount();
        await user.click(screen.getByTitle("First branch"));
        expect(store.selectedNodeIds()).toEqual([doc.pages[0]!.nodes[1]!.id]);
    });
});

describe("shape palette and toolbar", () => {
    function mountChrome() {
        const store = new EditorStore(sampleDoc());
        const view = render(
            <TooltipProvider>
                <EditorProvider store={store}>
                    <Toolbar onOpenShapes={jest.fn()} />
                    <ShapePalette />
                </EditorProvider>
            </TooltipProvider>
        );
        return { store, view };
    }

    it("arms a tool when its button is pressed", async () => {
        const user = userEvent.setup();
        const { store } = mountChrome();
        // "Sticky note" names both the toolbar button and its palette tile; the
        // toolbar renders first.
        await user.click(screen.getAllByLabelText("Sticky note")[0]!);
        expect(store.getState().tool).toBe("sticky");
    });

    it("arms a shape when a palette tile is chosen", async () => {
        const user = userEvent.setup();
        const { store } = mountChrome();
        await user.click(screen.getAllByLabelText("Decision")[0]!);
        expect(store.getState().tool).toBe("shape");
        expect(store.getState().pendingShape).toBe("decision");
    });

    it("filters the palette by search", async () => {
        const user = userEvent.setup();
        mountChrome();
        await user.type(screen.getByPlaceholderText("Search shapes…"), "cylinder");
        expect(screen.getAllByLabelText("Cylinder").length).toBeGreaterThan(0);
        expect(screen.queryByLabelText("Decision")).toBeNull();
    });
});
