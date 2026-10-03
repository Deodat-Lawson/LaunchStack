/** @jest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { StudioTabs } from "../StudioTabs";
import type { PaneTab } from "../StudioTabs";
import { SOURCE_DRAG_MIME } from "../dragData";

/**
 * One pane's strip. What matters here is that it reports what a person did
 * — selected, closed, reordered, split — and that the reporting is expressed
 * in terms the layout can act on without guessing.
 */

const icon = (label: string) => {
    const Icon = () => <span data-testid={`icon-${label}`} />;
    Icon.displayName = `Icon${label}`;
    return Icon;
};

const tab = (id: string, label = id): PaneTab => ({ id, label, Icon: icon(id) });
const TABS = [tab("chat", "Chat"), tab("knowledge", "Knowledge"), tab("draft", "Drafts")];

/** This testing-library build has no `fireEvent.auxClick`. */
function middleClick(element: Element, button: number) {
    fireEvent(element, new MouseEvent("auxclick", { button, bubbles: true, cancelable: true }));
}

describe("StudioTabs", () => {
    beforeAll(() => {
        // jsdom implements neither.
        Element.prototype.scrollIntoView = jest.fn();
    });

    /**
     * The × is aria-hidden: closing is already announced twice over, by
     * Delete on the tab and by the tab's own menu, so a screen reader is not
     * told about it a third time. It is still there for a mouse.
     */
    const closeButton = (label: string) =>
        document.querySelector<HTMLElement>(`[title="Close ${label}"]`)!;

    function renderStrip(overrides: Partial<React.ComponentProps<typeof StudioTabs>> = {}) {
        const props = {
            onSelect: jest.fn(),
            onClose: jest.fn(),
            onCloseOthers: jest.fn(),
            onCloseToRight: jest.fn(),
            onSplit: jest.fn(),
            onMove: jest.fn(),
            onOpenStudio: jest.fn(),
            onFocus: jest.fn(),
            registerSlot: jest.fn(),
        };
        render(
            <ContextMenuProvider>
                <StudioTabs
                    groupId="g0"
                    index={0}
                    groupCount={1}
                    tabs={TABS}
                    activeId="chat"
                    focused
                    canSplit
                    {...props}
                    {...overrides}
                />
            </ContextMenuProvider>
        );
        return { props };
    }

    it("shows one tab per open app, with only one selected", () => {
        renderStrip();
        expect(screen.getAllByRole("tab")).toHaveLength(3);
        expect(screen.getByRole("tab", { name: /Chat/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /Drafts/ })).toHaveAttribute(
            "aria-selected",
            "false"
        );
    });

    it("hands the host somewhere to render each pane", () => {
        const { props } = renderStrip();
        const registered = props.registerSlot.mock.calls
            .filter(([, element]) => element)
            .map(([id]) => id);
        expect(new Set(registered)).toEqual(new Set(["chat", "knowledge", "draft"]));
    });

    it("reports a tab click as a selection, and any touch as a focus", () => {
        const { props } = renderStrip();
        const knowledge = screen.getByRole("tab", { name: /Knowledge/ });
        // A real press fires pointerdown then mousedown. jsdom fires neither
        // for a click, and Radix selects on the second while the column
        // takes focus on the first, so both are needed here.
        fireEvent.pointerDown(knowledge, { button: 0 });
        fireEvent.mouseDown(knowledge, { button: 0 });
        expect(props.onSelect).toHaveBeenCalledWith("knowledge");
        expect(props.onFocus).toHaveBeenCalled();
    });

    it("closes from the X and from a middle click, but not a left click on the strip", () => {
        const { props } = renderStrip();
        fireEvent.click(closeButton("Knowledge"));
        expect(props.onClose).toHaveBeenCalledWith("knowledge");

        middleClick(screen.getByRole("tab", { name: /Drafts/ }), 1);
        expect(props.onClose).toHaveBeenCalledWith("draft");

        props.onClose.mockClear();
        middleClick(screen.getByRole("tab", { name: /Drafts/ }), 0);
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it("closes on Delete and claims the key, so nothing behind the tab also acts on it", () => {
        const { props } = renderStrip();
        const handled = fireEvent.keyDown(screen.getByRole("tab", { name: /Drafts/ }), {
            key: "Delete",
        });
        expect(props.onClose).toHaveBeenCalledWith("draft");
        // fireEvent returns false once a handler has called preventDefault.
        expect(handled).toBe(false);
    });

    it("also closes on Backspace, which is what the Delete key sends on a Mac laptop", () => {
        const { props } = renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Drafts/ }), { key: "Backspace" });
        expect(props.onClose).toHaveBeenCalledWith("draft");
    });

    it("reorders with Alt+Arrow, naming the neighbour to land in front of", () => {
        const { props } = renderStrip();
        const knowledge = screen.getByRole("tab", { name: /Knowledge/ });

        fireEvent.keyDown(knowledge, { key: "ArrowLeft", altKey: true });
        expect(props.onMove).toHaveBeenCalledWith("knowledge", "g0", "chat");

        props.onMove.mockClear();
        fireEvent.keyDown(knowledge, { key: "ArrowRight", altKey: true });
        // Past Drafts, which is last, so: to the end of this column.
        expect(props.onMove).toHaveBeenCalledWith("knowledge", "g0", null);
    });

    it("does not move the first tab further left, or the last further right", () => {
        const { props } = renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Chat/ }), {
            key: "ArrowLeft",
            altKey: true,
        });
        fireEvent.keyDown(screen.getByRole("tab", { name: /Drafts/ }), {
            key: "ArrowRight",
            altKey: true,
        });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    it("says where a tab landed, for anyone not watching the strip", () => {
        renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Knowledge/ }), {
            key: "ArrowLeft",
            altKey: true,
        });
        expect(screen.getByRole("status")).toHaveTextContent("Knowledge moved to position 1 of 3");
    });

    /** The pane's own verbs live behind one "⋯" button, not a row of them. */
    const openPaneMenu = (name = "Pane actions") => {
        fireEvent.click(screen.getByRole("button", { name }));
        return screen.getByRole("menu");
    };
    const menuItem = (menu: HTMLElement, id: string) =>
        within(menu).getByTestId(`context-menu-item-${id}`);

    it("keeps the strip to one pane menu instead of a row of split buttons", () => {
        renderStrip({ onSplitPane: jest.fn(), onToggleZoom: jest.fn(), groupCount: 2 });
        expect(screen.queryByRole("button", { name: /^Split right/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Maximize/ })).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Pane actions, pane 1 of 2" })
        ).toBeInTheDocument();
    });

    it("splits right or down from the pane menu, and says why when it cannot", () => {
        const onSplitPane = jest.fn();
        renderStrip({ onSplitPane, paneKeys: { splitRight: "⌘⌥\\" } });
        let menu = openPaneMenu();
        expect(menuItem(menu, "split-right")).toHaveTextContent("⌘⌥\\");
        fireEvent.click(menuItem(menu, "split-right"));
        expect(onSplitPane).toHaveBeenCalledWith("right");

        menu = openPaneMenu();
        fireEvent.click(menuItem(menu, "split-down"));
        expect(onSplitPane).toHaveBeenCalledWith("down");
        onSplitPane.mockClear();

        cleanup();
        renderStrip({
            onSplitPane,
            splitRefusal: { right: "Too narrow to split side by side.", down: null },
        });
        menu = openPaneMenu();
        const right = menuItem(menu, "split-right");
        expect(right).toHaveAttribute("aria-disabled", "true");
        expect(right).toHaveAttribute("title", "Too narrow to split side by side.");
        fireEvent.click(right);
        expect(onSplitPane).not.toHaveBeenCalled();

        cleanup();
        renderStrip({ onSplitPane, canSplit: false });
        menu = openPaneMenu();
        expect(menuItem(menu, "split-down")).toHaveAttribute("title", "Every pane is taken.");
    });

    it("maximizes from the menu or by double-clicking a tab, and shows the way back", () => {
        const onToggleZoom = jest.fn();
        renderStrip({ onToggleZoom });
        // One pane: nothing to maximize over.
        fireEvent.doubleClick(screen.getByRole("tab", { name: /Chat/ }).parentElement!);
        expect(onToggleZoom).not.toHaveBeenCalled();
        // Nothing to maximize over and nothing to split here: no menu of
        // greyed-out items, just no menu.
        expect(screen.queryByRole("button", { name: "Pane actions" })).not.toBeInTheDocument();

        cleanup();
        renderStrip({ onToggleZoom, onSplitPane: jest.fn() });
        expect(menuItem(openPaneMenu(), "zoom")).toHaveAttribute("aria-disabled", "true");

        cleanup();
        // A phone: no splits, one pane.
        renderStrip({ onToggleZoom, onSplitPane: jest.fn(), splittable: false });
        expect(screen.queryByRole("button", { name: "Pane actions" })).not.toBeInTheDocument();

        cleanup();
        renderStrip({ onToggleZoom, groupCount: 2 });
        fireEvent.doubleClick(screen.getByRole("tab", { name: /Chat/ }).parentElement!);
        expect(onToggleZoom).toHaveBeenCalledTimes(1);

        cleanup();
        renderStrip({ onToggleZoom, groupCount: 2, zoomed: true });
        const restore = screen.getByRole("button", {
            name: "Restore the other panes, pane 1 of 2",
        });
        expect(restore).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(restore);
        expect(onToggleZoom).toHaveBeenCalledTimes(2);
    });

    it("closes a pane from its menu, and an empty one from its strip, but never the only one", () => {
        const onClosePane = jest.fn();
        renderStrip({ onClosePane, groupCount: 2 });
        fireEvent.click(menuItem(openPaneMenu("Pane actions, pane 1 of 2"), "close-pane"));
        expect(onClosePane).toHaveBeenCalledTimes(1);

        cleanup();
        renderStrip({ tabs: [], activeId: "", onClosePane, groupCount: 2 });
        fireEvent.click(screen.getByRole("button", { name: "Close this pane, pane 1 of 2" }));
        expect(onClosePane).toHaveBeenCalledTimes(2);

        cleanup();
        renderStrip({ tabs: [], activeId: "", onClosePane, groupCount: 1 });
        expect(screen.queryByRole("button", { name: "Close this pane" })).not.toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-close-pane")).not.toBeInTheDocument();
    });

    it("takes a source dropped from the sidebar, where it was dropped", () => {
        const { props } = renderStrip();
        const knowledge = screen.getByRole("tab", { name: /Knowledge/ }).parentElement!;
        knowledge.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 100, height: 28 }) as DOMRect;
        const dataTransfer = {
            types: [SOURCE_DRAG_MIME],
            getData: (type: string) => (type === SOURCE_DRAG_MIME ? "d7" : ""),
            dropEffect: "",
        };
        const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 10 });
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
        fireEvent(knowledge, event);
        expect(props.onMove).toHaveBeenCalledWith("source:d7", "g0", "knowledge");
    });

    it("reports a tab drag starting and ending, for the panes' drop zones", () => {
        const onDragTab = jest.fn();
        renderStrip({ onDragTab });
        const chat = screen.getByRole("tab", { name: /Chat/ }).parentElement!;
        const dataTransfer = { setData: jest.fn(), effectAllowed: "" };
        fireEvent.dragStart(chat, { dataTransfer });
        expect(onDragTab).toHaveBeenLastCalledWith("chat");
        fireEvent.dragEnd(chat);
        expect(onDragTab).toHaveBeenLastCalledWith(null);
    });

    it("counts the tabs for a screen reader and keeps the close buttons out of the tab order", () => {
        renderStrip();
        const tabs = screen.getAllByRole("tab");
        expect(tabs[1]).toHaveAttribute("aria-posinset", "2");
        expect(tabs[1]).toHaveAttribute("aria-setsize", "3");
        const close = closeButton("Chat");
        expect(close).toHaveAttribute("tabindex", "-1");
        expect(close).toHaveAttribute("aria-hidden", "true");
    });

    it("marks which pane is the current one", () => {
        const { container } = render(
            <ContextMenuProvider>
                <StudioTabs
                    groupId="g1"
                    index={1}
                    groupCount={2}
                    tabs={TABS}
                    activeId="chat"
                    focused={false}
                    canSplit
                    onSelect={jest.fn()}
                    onClose={jest.fn()}
                    onCloseOthers={jest.fn()}
                    onCloseToRight={jest.fn()}
                    onSplit={jest.fn()}
                    onMove={jest.fn()}
                    onOpenStudio={jest.fn()}
                    onFocus={jest.fn()}
                    registerSlot={jest.fn()}
                />
            </ContextMenuProvider>
        );
        expect(container.querySelector("[data-studio-tab-strip]")).toHaveAttribute(
            "data-focused",
            "false"
        );
    });
});
