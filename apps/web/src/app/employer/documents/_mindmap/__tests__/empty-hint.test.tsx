/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { buildTemplate } from "../model/templates";
import { MindmapEditor } from "../ui/MindmapEditor";

/**
 * The "Type your idea" prompt is the central topic before it exists, and it
 * was the one piece of the board painted in the *viewer's* theme: with the app
 * dark and the board light it measured 1.6:1, and 2.0:1 the other way round —
 * a placeholder nobody could see. It is HTML over the paper, not part of the
 * <svg>, so it has to opt into the paper's colours itself. jsdom has no
 * cascade to measure, so this pins the binding; the contrast was measured in
 * Chrome (light board 5.5:1, dark board 7.8:1, whichever the app theme).
 */

beforeAll(() => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ peers: [], revision: 1 }),
            text: () => Promise.resolve("{}"),
        })
    ) as unknown as typeof fetch;
});

function mount(board: "light" | "dark") {
    return render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={buildTemplate("blank", "Hint", board)}
            initialTitle="Hint"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
            initialChrome="focus"
        />
    );
}

describe("the empty-board prompt", () => {
    it.each(["light", "dark"] as const)("takes its colours from a %s board", board => {
        mount(board);
        const prompt = screen.getByRole("button", { name: "Type your idea" });
        const scope = prompt.closest("[data-paper]");
        expect(scope).not.toBeNull();
        expect(scope).toHaveAttribute("data-paper", board);
        // The paper rebinds `--accent` (brand) but not brand-ink/brand-soft,
        // which would fall back to the app theme.
        expect(prompt.className).not.toMatch(/brand-ink|brand-soft/);
    });
});
