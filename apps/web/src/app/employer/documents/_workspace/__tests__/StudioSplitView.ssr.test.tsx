/** @jest-environment node */

import React from "react";
import { renderToString } from "react-dom/server";

import { ContextMenuProvider } from "~/components/context-menu";
import { StudioSplitView } from "../StudioSplitView";
import type { PaneTab } from "../StudioTabs";
import { newGroup, type PaneLayout } from "../paneLayout";

/**
 * The split view on the server, where there is no `document`.
 *
 * Its panes live in nodes it creates itself and moves between columns, and
 * the server has nothing to create them with. It once reached for
 * `document.createElement` during render and took down every page that
 * server-rendered it. This file runs in node, not jsdom, because jsdom
 * supplies a `document` and would let exactly that through.
 */

const tab = (id: string, label: string): PaneTab => ({
    id,
    label,
    Icon: () => <span />,
});
const TABS: Record<string, PaneTab> = {
    chat: tab("chat", "Chat"),
    knowledge: tab("knowledge", "Knowledge"),
};

const layout: PaneLayout = {
    groups: [newGroup("g0", ["chat"]), newGroup("g1", ["knowledge"])],
    activeGroupId: "g0",
    seq: 2,
};

const noop = () => undefined;

const view = (
    <ContextMenuProvider>
        <StudioSplitView
            layout={layout}
            tabFor={id => TABS[id]}
            renderPane={id => <p>pane:{id}</p>}
            onSelect={noop}
            onClose={noop}
            onCloseOthers={noop}
            onCloseToRight={noop}
            onSplit={noop}
            onMove={noop}
            onFocusGroup={noop}
            onOpenStudio={noop}
            emptyState={<div>Nothing open</div>}
        />
    </ContextMenuProvider>
);

/**
 * Renders on the server and returns what it logged along with the markup.
 * React 18, which jest runs, warns about every useLayoutEffect it meets on
 * the server; the app router renders with React 19, which dropped that
 * warning, so it is left out. Anything else is a real complaint.
 */
function serverRender() {
    const errors = jest.spyOn(console, "error").mockImplementation(noop);
    try {
        const html = renderToString(view);
        const complaints = errors.mock.calls
            .map(call => String(call[0]))
            .filter(message => !message.includes("useLayoutEffect does nothing on the server"));
        return { html, complaints };
    } finally {
        errors.mockRestore();
    }
}

describe("StudioSplitView on the server", () => {
    it("renders without a document", () => {
        expect(typeof document).toBe("undefined");
        expect(serverRender().complaints).toEqual([]);
    });

    it("draws the columns and leaves the panes to the client", () => {
        const { html } = serverRender();
        expect(html).toContain("Open apps, column 1 of 2");
        expect(html).toContain("Open apps, column 2 of 2");
        // The panes arrive with the first client render, in hosts the
        // browser makes; nothing of them is in the server's markup.
        expect(html).not.toContain("pane:");
    });
});
