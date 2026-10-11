/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

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
