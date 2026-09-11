/** @jest-environment jsdom */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { addComment } from "../model/commands";
import { createDoc, createNode, createPage } from "../model/factory";
import { EditorStore } from "../model/store";
import { CommentsPanel } from "../ui/CommentsPanel";
import { EditorProvider } from "../ui/EditorContext";

/**
 * The comments panel's selection scoping: clicking a shape must surface that
 * shape's threads under their own header, with the rest of the page demoted
 * below — "what was said about this box?" answered by clicking the box.
 */

function mountPanel() {
    const box = createNode({ shape: "rectangle", x: 10, y: 10, text: "Billing service" });
    const other = createNode({ shape: "rectangle", x: 400, y: 10, text: "Queue" });
    const doc = createDoc("Test map", [{ ...createPage(), nodes: [box, other], edges: [] }]);
    const store = new EditorStore(doc);
    addComment(store, { nodeId: box.id, at: { x: 170, y: 10 }, author: "Ana", body: "Rename this?" });
    addComment(store, { nodeId: null, at: { x: 50, y: 300 }, author: "Ben", body: "Page note" });
    const view = render(
        <EditorProvider store={store}>
            <CommentsPanel author="Test" canvasSize={{ w: 1000, h: 700 }} />
        </EditorProvider>
    );
    return { store, view, box };
}

describe("selection scoping", () => {
    it("lists every thread flat when nothing is selected", () => {
        mountPanel();
        expect(screen.getByText("2 threads")).toBeInTheDocument();
        expect(screen.getByText("Rename this?")).toBeInTheDocument();
        expect(screen.getByText("Page note")).toBeInTheDocument();
        expect(screen.queryByText(/^On “/)).toBeNull();
    });

    it("surfaces the selected shape's threads under their own header", () => {
        const { store } = mountPanel();
        act(() => store.selectNodes([storeBoxId(store)]));
        expect(screen.getByText("On “Billing service”")).toBeInTheDocument();
        expect(screen.getByText("Elsewhere on this page")).toBeInTheDocument();
        expect(screen.getByText("Rename this?")).toBeInTheDocument();
    });

    it("says so when the selected shape has no threads yet", () => {
        const { store } = mountPanel();
        const queue = store.getState().doc.pages[0]!.nodes[1]!;
        act(() => store.selectNodes([queue.id]));
        expect(screen.getByText("On “Queue”")).toBeInTheDocument();
        expect(
            screen.getByText("Nothing here yet — the box above posts to this shape.")
        ).toBeInTheDocument();
    });
});

function storeBoxId(store: EditorStore): string {
    return store.getState().doc.pages[0]!.nodes[0]!.id;
}
