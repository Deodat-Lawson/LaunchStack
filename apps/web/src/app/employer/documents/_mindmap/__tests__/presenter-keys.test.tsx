/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { createEdge, createNode, createPage } from "../model/factory";
import { buildTemplate } from "../model/templates";
import { MindmapEditor } from "../ui/MindmapEditor";

/**
 * → in Present has to reveal the next branch.
 *
 * Three window listeners want the arrow keys while presenting — the
 * keyboard map, the page stepper and the Presenter — and each skips a key
 * another has already claimed. The keyboard map claimed it unconditionally,
 * so nothing ever moved: the presentation sat on "Overview" (on main too).
 * The Presenter now listens in the capture phase and claims only real steps.
 */

beforeAll(() => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    Element.prototype.scrollIntoView = function scrollIntoView() {
        /* no-op */
    };
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ peers: [], revision: 1 }),
            text: () => Promise.resolve("{}"),
        })
    ) as unknown as typeof fetch;
});

function press(key: string) {
    act(() => {
        fireEvent.keyDown(window, { key });
    });
}

it("steps through the branches with the arrow keys, forward and back", () => {
    render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={buildTemplate("mindmap", "Deck")}
            initialTitle="Deck"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
            initialChrome="focus"
        />
    );
    fireEvent.click(screen.getByRole("button", { name: /Present/ }));
    expect(screen.getByText("Overview")).toBeInTheDocument();

    press("ArrowRight");
    expect(screen.getByText("Branch 1 of 4")).toBeInTheDocument();
    press("ArrowRight");
    expect(screen.getByText("Branch 2 of 4")).toBeInTheDocument();
    press("ArrowLeft");
    expect(screen.getByText("Branch 1 of 4")).toBeInTheDocument();
});

it("starts the next page at its own overview when → runs past the last branch", () => {
    const base = buildTemplate("mindmap", "Deck");
    const root = createNode({ shape: "mind-root", x: 0, y: 0, text: "Second page" });
    const a = createNode({ shape: "mind-branch", x: 300, y: 0, text: "A" });
    const b = createNode({ shape: "mind-branch", x: 300, y: 120, text: "B" });
    const link = (to: string) =>
        createEdge({ from: { nodeId: root.id, port: "auto" }, to: { nodeId: to, port: "auto" } });
    const second = {
        ...createPage("Page 2"),
        nodes: [root, a, b],
        edges: [link(a.id), link(b.id)],
    };
    render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={{ ...base, pages: [...base.pages, second] }}
            initialTitle="Deck"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
            initialChrome="focus"
        />
    );
    fireEvent.click(screen.getByRole("button", { name: /Present/ }));
    // Overview → four branches → the whole map, then one more turns the page.
    for (let i = 0; i < 6; i++) press("ArrowRight");
    expect(screen.getByText("Overview")).toBeInTheDocument();
    press("ArrowRight");
    expect(screen.getByText("Branch 1 of 2")).toBeInTheDocument();
});
