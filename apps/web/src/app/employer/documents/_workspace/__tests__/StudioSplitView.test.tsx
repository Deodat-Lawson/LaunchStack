/** @jest-environment jsdom */

import React, { useState } from "react";
import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
// The node build: the browser one needs a TextEncoder jsdom does not have.
import { renderToString } from "react-dom/server.node";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { StudioSplitView } from "../StudioSplitView";
import type { PaneTab } from "../StudioTabs";
import { SOURCE_DRAG_MIME, STUDIO_TAB_DRAG_MIME } from "../dragData";
import { newGroup, reduceLayout, rowLayout, type PaneLayout } from "../paneLayout";

/**
 * The split view's one hard promise: a pane handed to another pane — or whose
 * pane is split, or zoomed — is the same pane. Not a new one with the same props — the same React instance and
 * the same DOM node, so a half-written draft, a scroll position and an undo
 * stack all come along.
 *
 * That is easy to get wrong invisibly. React compares a portal's container
 * when it reconciles, so portalling straight into each column's slot would
 * tear the pane down and build a new one, and nothing would look different
 * unless the pane happened to hold state. Hence the mount counter below.
 */

const icon = (label: string) => {
    const Icon = () => <span data-testid={`icon-${label}`} />;
    Icon.displayName = `Icon${label}`;
    return Icon;
};
const tab = (id: string, label = id): PaneTab => ({ id, label, Icon: icon(id) });
const TABS: Record<string, PaneTab> = {
    chat: tab("chat", "Chat"),
    knowledge: tab("knowledge", "Knowledge"),
    draft: tab("draft", "Drafts"),
};

let mounts: Record<string, number> = {};

function StubPane({ id }: { id: string }) {
    const [draft, setDraft] = useState("");
    React.useEffect(() => {
        mounts[id] = (mounts[id] ?? 0) + 1;
    }, [id]);
    return (
        <input
            aria-label={`${id} draft`}
            value={draft}
            onChange={event => setDraft(event.target.value)}
        />
    );
}

function layoutOf(columns: string[][], activeIndex = 0): PaneLayout {
    return rowLayout(
        columns.map((ids, i) => newGroup(`g${i}`, ids)),
        `g${activeIndex}`,
        columns.length
    );
}

function viewOf(overrides: Record<string, unknown> = {}) {
    const props = {
        onSelect: jest.fn(),
        onClose: jest.fn(),
        onCloseOthers: jest.fn(),
        onCloseToRight: jest.fn(),
        onSplit: jest.fn(),
        onSplitRoot: jest.fn(),
        onSplitPane: jest.fn(),
        onCloseGroup: jest.fn(),
        onToggleZoom: jest.fn(),
        onResize: jest.fn(),
        onMove: jest.fn(),
        onFocusGroup: jest.fn(),
        onOpenStudio: jest.fn(),
    };
    const ui = (next: PaneLayout) => (
        <ContextMenuProvider>
            <StudioSplitView
                layout={next}
                tabFor={id => TABS[id]}
                renderPane={id => <StubPane id={id} />}
                renderEmpty={() => <div>Nothing open</div>}
                {...props}
                {...overrides}
            />
        </ContextMenuProvider>
    );
    return { props, ui };
}

function renderView(layout: PaneLayout, overrides: Record<string, unknown> = {}) {
    const { props, ui } = viewOf(overrides);
    const view = render(ui(layout));
    return { props, rerender: (next: PaneLayout) => view.rerender(ui(next)) };
}

describe("StudioSplitView", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
        // Panes the view hosts may measure; jsdom has no ResizeObserver.
        global.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
    });

    beforeEach(() => {
        mounts = {};
    });

    it("gives each pane its own strip, named so they can be told apart", () => {
        renderView(layoutOf([["chat"], ["knowledge"]]));
        expect(screen.getByRole("tablist", { name: "Open apps, pane 1 of 2" })).toBeInTheDocument();
        expect(screen.getByRole("tablist", { name: "Open apps, pane 2 of 2" })).toBeInTheDocument();
    });

    it("renders every open pane, in whichever column holds it", () => {
        renderView(layoutOf([["chat"], ["knowledge"]]));
        expect(screen.getByLabelText("chat draft")).toBeInTheDocument();
        expect(screen.getByLabelText("knowledge draft")).toBeInTheDocument();
    });

    it("keeps a pane alive when it is handed to another column", () => {
        const { rerender } = renderView(layoutOf([["chat"], ["knowledge"]]));

        fireEvent.change(screen.getByLabelText("chat draft"), {
            target: { value: "half a sentence" },
        });
        const before = screen.getByLabelText("chat draft");
        expect(mounts.chat).toBe(1);

        // Chat leaves the first column for the second.
        rerender(layoutOf([[], ["knowledge", "chat"]], 1));

        const after = screen.getByLabelText("chat draft");
        expect(after).toHaveValue("half a sentence");
        // The same element, not a replacement that happens to look alike.
        expect(after).toBe(before);
        expect(mounts.chat).toBe(1);
    });

    it("drops a pane once its tab is gone, so reopening starts clean", () => {
        const { rerender } = renderView(layoutOf([["chat", "knowledge"]]));
        expect(mounts.knowledge).toBe(1);

        rerender(layoutOf([["chat"]]));
        expect(screen.queryByLabelText("knowledge draft")).not.toBeInTheDocument();

        rerender(layoutOf([["chat", "knowledge"]]));
        expect(mounts.knowledge).toBe(2);
    });

    it("tells the layout which column was touched, even from inside a pane", () => {
        const { props } = renderView(layoutOf([["chat"], ["knowledge"]], 0));
        fireEvent.pointerDown(screen.getByLabelText("knowledge draft"));
        expect(props.onFocusGroup).toHaveBeenCalledWith("g1");
    });

    it("keeps the strip, and offers a way back into Studio, when nothing is open", () => {
        renderView(layoutOf([[]]));
        expect(screen.getByText("Nothing open")).toBeInTheDocument();
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
        // The strip survives an empty workspace: it carries the sidebar
        // control, the account menu and the only way to open anything.
        expect(screen.getByRole("button", { name: "Open a Studio app" })).toBeInTheDocument();
    });

    it("brings the panes in after hydrating server markup, and still moves them intact", () => {
        const { ui } = viewOf();
        const container = document.createElement("div");
        document.body.appendChild(container);

        // React 18, which jest runs, warns about every useLayoutEffect it
        // meets on the server; the app router renders with React 19, which
        // dropped that warning. Anything else logged here is a real problem.
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        let root!: ReturnType<typeof hydrateRoot>;
        try {
            // The server has no document to make pane hosts with, so its
            // markup is the strips alone (see StudioSplitView.ssr.test.tsx).
            container.innerHTML = renderToString(ui(layoutOf([["chat"], ["knowledge"]])));
            expect(within(container).queryByLabelText("chat draft")).not.toBeInTheDocument();

            act(() => {
                root = hydrateRoot(container, ui(layoutOf([["chat"], ["knowledge"]])));
            });
            // Leaving the panes out of the server's markup is not a mismatch.
            const complaints = errors.mock.calls
                .map(call => String(call[0]))
                .filter(message => !message.includes("useLayoutEffect does nothing on the server"));
            expect(complaints).toEqual([]);
        } finally {
            errors.mockRestore();
        }

        const before = within(container).getByLabelText("chat draft");
        fireEvent.change(before, { target: { value: "half a sentence" } });
        act(() => root.render(ui(layoutOf([[], ["knowledge", "chat"]], 1))));

        const after = within(container).getByLabelText("chat draft");
        expect(after).toBe(before);
        expect(after).toHaveValue("half a sentence");
        expect(mounts.chat).toBe(1);

        act(() => root.unmount());
        container.remove();
    });

    it("drops a tab the workspace can no longer name", () => {
        renderView(layoutOf([["chat", "vanished"]]));
        const strip = screen.getByRole("tablist", { name: "Open apps" });
        expect(within(strip).getAllByRole("tab")).toHaveLength(1);
    });

    it("keeps a pane alive when the pane holding it is split", () => {
        const start = layoutOf([["chat", "knowledge"]]);
        const { rerender } = renderView(start);
        fireEvent.change(screen.getByLabelText("chat draft"), { target: { value: "draft" } });
        const before = screen.getByLabelText("chat draft");

        // Knowledge goes below: g0 now sits inside a column split.
        rerender(reduceLayout(start, { type: "split", id: "knowledge", side: "down" }));
        const after = screen.getByLabelText("chat draft");
        expect(after).toBe(before);
        expect(after).toHaveValue("draft");
        expect(mounts.chat).toBe(1);
        expect(mounts.knowledge).toBe(1);
    });

    it("places the panes from the tree: side by side, then stacked", () => {
        const stacked = reduceLayout(layoutOf([["chat", "knowledge"]]), {
            type: "split",
            id: "knowledge",
            side: "down",
        });
        const { container } = render(
            <ContextMenuProvider>
                <StudioSplitView
                    layout={stacked}
                    tabFor={id => TABS[id]}
                    renderPane={id => <StubPane id={id} />}
                    renderEmpty={() => null}
                    onSelect={jest.fn()}
                    onClose={jest.fn()}
                    onCloseOthers={jest.fn()}
                    onCloseToRight={jest.fn()}
                    onSplit={jest.fn()}
                    onSplitRoot={jest.fn()}
                    onSplitPane={jest.fn()}
                    onCloseGroup={jest.fn()}
                    onToggleZoom={jest.fn()}
                    onResize={jest.fn()}
                    onMove={jest.fn()}
                    onFocusGroup={jest.fn()}
                    onOpenStudio={jest.fn()}
                />
            </ContextMenuProvider>
        );
        const top = container.querySelector<HTMLElement>('[data-studio-pane="g0"]')!;
        const bottom = container.querySelector<HTMLElement>('[data-studio-pane="g1"]')!;
        const pct = (value: string) => parseFloat(value);
        expect(pct(top.style.top)).toBe(0);
        expect(pct(top.style.height)).toBe(50);
        expect(pct(bottom.style.top)).toBe(50);
        expect(pct(bottom.style.width)).toBe(100);
        expect(container.querySelector('[data-studio-divider="column"]')).toBeInTheDocument();
    });

    it("hides the other panes behind a zoom without unmounting them", () => {
        const zoomed = reduceLayout(layoutOf([["chat"], ["knowledge"]], 1), {
            type: "toggleZoom",
        });
        const { container } = render(
            <ContextMenuProvider>
                <StudioSplitView
                    layout={zoomed}
                    tabFor={id => TABS[id]}
                    renderPane={id => <StubPane id={id} />}
                    renderEmpty={() => null}
                    onSelect={jest.fn()}
                    onClose={jest.fn()}
                    onCloseOthers={jest.fn()}
                    onCloseToRight={jest.fn()}
                    onSplit={jest.fn()}
                    onSplitRoot={jest.fn()}
                    onSplitPane={jest.fn()}
                    onCloseGroup={jest.fn()}
                    onToggleZoom={jest.fn()}
                    onResize={jest.fn()}
                    onMove={jest.fn()}
                    onFocusGroup={jest.fn()}
                    onOpenStudio={jest.fn()}
                />
            </ContextMenuProvider>
        );
        expect(container.querySelector('[data-studio-pane="g0"]')).toHaveClass("invisible");
        const full = container.querySelector<HTMLElement>('[data-studio-pane="g1"]')!;
        expect(parseFloat(full.style.width)).toBe(100);
        expect(screen.getByLabelText("chat draft")).toBeInTheDocument();
        // No dividers to drag while one pane has the whole centre.
        expect(container.querySelector("[data-studio-divider]")).not.toBeInTheDocument();
    });

    it("moves a divider from the keyboard and reports the new shares", () => {
        const { props } = renderView(layoutOf([["chat"], ["knowledge"]]));
        const divider = screen.getByRole("separator", { name: "Resize the panes either side" });
        expect(divider).toHaveAttribute("aria-valuenow", "50");
        fireEvent.keyDown(divider, { key: "ArrowRight" });
        const [splitId, sizes] = props.onResize.mock.calls[0] as [string, number[]];
        expect(splitId).toBe("s2");
        expect(sizes[0]).toBeCloseTo(0.52);
        expect(sizes[1]).toBeCloseTo(0.48);
        fireEvent.doubleClick(divider);
        expect(props.onResize).toHaveBeenLastCalledWith("s2", [0.5, 0.5]);
    });

    it("splits a pane where a dragged tab is dropped on its edge", () => {
        jest.useFakeTimers();
        try {
            const { props } = renderView(layoutOf([["chat", "knowledge"], ["draft"]]));
            const chatTab = screen.getByRole("tab", { name: /Chat/ }).parentElement!;
            fireEvent.dragStart(chatTab, {
                dataTransfer: { setData: jest.fn(), effectAllowed: "" },
            });
            act(() => {
                jest.runAllTimers();
            });
            const zone = document.querySelector<HTMLElement>('[data-studio-drop-zone="g1"]')!;
            expect(zone).toBeInTheDocument();
            zone.getBoundingClientRect = () =>
                ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
            const dataTransfer = {
                types: [STUDIO_TAB_DRAG_MIME],
                getData: (type: string) => (type === STUDIO_TAB_DRAG_MIME ? "chat" : ""),
                dropEffect: "",
            };
            // jsdom has no DragEvent, and a plain Event carries no position;
            // a MouseEvent does, with the tab's data put on it by hand.
            const dropAt = (clientX: number, clientY: number) => {
                const event = new MouseEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    clientX,
                    clientY,
                });
                Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
                fireEvent(zone, event);
            };
            // Near the bottom edge: a split below.
            dropAt(200, 290);
            expect(props.onSplit).toHaveBeenCalledWith("chat", "down", "g1");
            expect(props.onMove).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    /** jsdom has no DragEvent; a MouseEvent carries a position, and the data goes on by hand. */
    function dragEvent(type: string, data: Record<string, string>, clientX = 0, clientY = 0) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
        Object.defineProperty(event, "dataTransfer", {
            value: {
                types: Object.keys(data),
                getData: (key: string) => data[key] ?? "",
                setData: jest.fn(),
                dropEffect: "",
                effectAllowed: "",
            },
        });
        return event;
    }

    function sized(element: Element, width: number, height: number) {
        element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height }) as DOMRect;
    }

    it("offers drop zones for a source dragged from the sidebar, and opens it where it lands", () => {
        jest.useFakeTimers();
        try {
            const { props } = renderView(layoutOf([["chat"], ["knowledge"]]));
            // The sidebar knows nothing of panes; the drag is noticed on the document.
            fireEvent(document.body, dragEvent("dragstart", { [SOURCE_DRAG_MIME]: "d1" }));
            act(() => {
                jest.runAllTimers();
            });
            const zone = document.querySelector<HTMLElement>('[data-studio-drop-zone="g0"]')!;
            expect(zone).toBeInTheDocument();
            // A source is open nowhere, so even a pane with one tab takes it.
            expect(document.querySelector('[data-studio-drop-zone="g1"]')).toBeInTheDocument();
            sized(zone, 400, 300);
            fireEvent(zone, dragEvent("drop", { [SOURCE_DRAG_MIME]: "d1" }, 10, 150));
            expect(props.onSplit).toHaveBeenCalledWith("source:d1", "left", "g0");

            fireEvent(document.body, dragEvent("dragstart", { [SOURCE_DRAG_MIME]: "d2" }));
            act(() => {
                jest.runAllTimers();
            });
            const again = document.querySelector<HTMLElement>('[data-studio-drop-zone="g1"]')!;
            sized(again, 400, 300);
            fireEvent(again, dragEvent("drop", { [SOURCE_DRAG_MIME]: "d2" }, 200, 150));
            expect(props.onMove).toHaveBeenCalledWith("source:d2", "g1", null);
        } finally {
            jest.useRealTimers();
        }
    });

    it("makes a pane the whole height when a drop lands on the workspace's own edge", () => {
        jest.useFakeTimers();
        try {
            const { props } = renderView(layoutOf([["chat", "draft"], ["knowledge"]]));
            fireEvent.dragStart(screen.getByRole("tab", { name: /Drafts/ }).parentElement!, {
                dataTransfer: { setData: jest.fn(), effectAllowed: "" },
            });
            act(() => {
                jest.runAllTimers();
            });
            const edge = document.querySelector<HTMLElement>('[data-studio-root-drop="right"]')!;
            expect(edge).toBeInTheDocument();
            fireEvent(edge, dragEvent("drop", { [STUDIO_TAB_DRAG_MIME]: "draft" }));
            expect(props.onSplitRoot).toHaveBeenCalledWith("draft", "right");
        } finally {
            jest.useRealTimers();
        }
    });

    it("offers only the middle of a pane too narrow to halve", () => {
        jest.useFakeTimers();
        const Original = global.ResizeObserver;
        // A 400px-wide centre: two columns of 200px, each too narrow to halve.
        global.ResizeObserver = class {
            constructor(private callback: ResizeObserverCallback) {}
            observe() {
                this.callback(
                    [{ contentRect: { width: 400, height: 800 } } as ResizeObserverEntry],
                    this as unknown as ResizeObserver
                );
            }
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        try {
            const { props } = renderView(layoutOf([["chat", "draft"], ["knowledge"]]));
            fireEvent.dragStart(screen.getByRole("tab", { name: /Drafts/ }).parentElement!, {
                dataTransfer: { setData: jest.fn(), effectAllowed: "" },
            });
            act(() => {
                jest.runAllTimers();
            });
            const zone = document.querySelector<HTMLElement>('[data-studio-drop-zone="g1"]')!;
            sized(zone, 200, 760);
            // Right at the left edge: a side split is closed, a top/bottom one is not.
            fireEvent(zone, dragEvent("drop", { [STUDIO_TAB_DRAG_MIME]: "draft" }, 5, 380));
            expect(props.onSplit).not.toHaveBeenCalled();
            expect(props.onMove).toHaveBeenCalledWith("draft", "g1", null);
        } finally {
            global.ResizeObserver = Original;
            jest.useRealTimers();
        }
    });

    it("still takes the drop when the page updates mid-event, as it does for a real drag", () => {
        // A real drag is dispatched by the browser, which lets React apply
        // updates between one listener and the next. This listener, added
        // after the view's own, does the same: it flushes whatever the view's
        // capture-phase listeners asked for before the drop reaches its target.
        jest.useFakeTimers();
        // `flushSync` applies updates already scheduled, as the browser's
        // microtask checkpoint between listeners does; `act` would only
        // flush work queued inside its own scope.
        const flushBetweenListeners = () => flushSync(() => {});
        try {
            const { props } = renderView(layoutOf([["chat", "draft"], ["knowledge"]]));
            fireEvent.dragStart(screen.getByRole("tab", { name: /Drafts/ }).parentElement!, {
                dataTransfer: { setData: jest.fn(), effectAllowed: "" },
            });
            act(() => {
                jest.runAllTimers();
            });
            window.addEventListener("drop", flushBetweenListeners, true);
            const zone = document.querySelector<HTMLElement>('[data-studio-drop-zone="g1"]')!;
            sized(zone, 400, 300);
            fireEvent(zone, dragEvent("drop", { [STUDIO_TAB_DRAG_MIME]: "draft" }, 200, 150));
            expect(props.onMove).toHaveBeenCalledWith("draft", "g1", null);
            // And the zones do go, once the drop has been handled.
            act(() => {
                jest.runAllTimers();
            });
            expect(document.querySelector("[data-studio-drop-zone]")).not.toBeInTheDocument();
        } finally {
            window.removeEventListener("drop", flushBetweenListeners, true);
            jest.useRealTimers();
        }
    });

    it("keeps the workspace-edge bands off the strips, so a strip drop stays a strip drop", () => {
        jest.useFakeTimers();
        try {
            renderView(layoutOf([["chat", "draft"], ["knowledge"]]));
            fireEvent.dragStart(screen.getByRole("tab", { name: /Drafts/ }).parentElement!, {
                dataTransfer: { setData: jest.fn(), effectAllowed: "" },
            });
            act(() => {
                jest.runAllTimers();
            });
            for (const side of ["left", "right", "up"]) {
                expect(document.querySelector(`[data-studio-root-drop="${side}"]`)).toHaveClass(
                    "top-10"
                );
            }
        } finally {
            jest.useRealTimers();
        }
    });
});
