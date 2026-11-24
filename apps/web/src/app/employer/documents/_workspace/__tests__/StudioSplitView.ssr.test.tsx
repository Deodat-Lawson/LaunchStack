/** @jest-environment node */

import React from "react";
import { renderToString } from "react-dom/server";

import { ContextMenuProvider } from "~/components/context-menu";
import { StudioSplitView } from "../StudioSplitView";
import type { PaneTab } from "../StudioTabs";
import { newGroup, rowLayout } from "../paneLayout";

/**
 * The split view on the server, where there is no `document`.
 *
 * Its panes' content lives in nodes it creates itself and moves between
 * panes, and the server has nothing to create them with. It once reached for
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

const layout = rowLayout([newGroup("g0", ["chat"]), newGroup("g1", ["knowledge"])], "g0", 2);

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
            onSplitRoot={noop}
            onSplitPane={noop}
            onCloseGroup={noop}
            onToggleZoom={noop}
            onResize={noop}
            onMove={noop}
            onFocusGroup={noop}
            onOpenStudio={noop}
            renderEmpty={() => <div>Nothing open</div>}
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

    it("draws the panes' strips and leaves their content to the client", () => {
        const { html } = serverRender();
        expect(html).toContain("Open apps, pane 1 of 2");
        expect(html).toContain("Open apps, pane 2 of 2");
        // The content arrives with the first client commit, in hosts the
        // browser makes; nothing of it is in the server's markup.
        expect(html).not.toContain("pane:");
    });
});
