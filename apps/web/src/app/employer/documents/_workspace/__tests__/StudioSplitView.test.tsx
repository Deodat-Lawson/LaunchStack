/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { StudioSplitView } from "../StudioSplitView";
import type { PaneTab } from "../StudioTabs";
import { newGroup, type PaneLayout } from "../paneLayout";

/**
 * The split view's one hard promise: a pane handed to another column is the
 * same pane. Not a new one with the same props — the same React instance and
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
    return {
        groups: columns.map((ids, i) => newGroup(`g${i}`, ids)),
        activeGroupId: `g${activeIndex}`,
        seq: columns.length,
    };
}

function renderView(layout: PaneLayout, overrides: Record<string, unknown> = {}) {
    const props = {
        onSelect: jest.fn(),
        onClose: jest.fn(),
        onCloseOthers: jest.fn(),
        onCloseToRight: jest.fn(),
        onSplit: jest.fn(),
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
                emptyState={<div>Nothing open</div>}
                {...props}
                {...overrides}
            />
        </ContextMenuProvider>
    );
    const view = render(ui(layout));
    return { props, rerender: (next: PaneLayout) => view.rerender(ui(next)) };
}

describe("StudioSplitView", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
        // react-resizable-panels measures; jsdom has no ResizeObserver.
        global.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
    });

    beforeEach(() => {
        mounts = {};
    });

    it("gives each column its own strip, named so they can be told apart", () => {
        renderView(layoutOf([["chat"], ["knowledge"]]));
        expect(
            screen.getByRole("tablist", { name: "Open apps, column 1 of 2" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("tablist", { name: "Open apps, column 2 of 2" })
        ).toBeInTheDocument();
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

    it("drops a tab the workspace can no longer name", () => {
        renderView(layoutOf([["chat", "vanished"]]));
        const strip = screen.getByRole("tablist", { name: "Open apps" });
        expect(within(strip).getAllByRole("tab")).toHaveLength(1);
    });
});
