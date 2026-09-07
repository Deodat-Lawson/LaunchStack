/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { createDoc, createNode, createPage } from "../model/factory";
import type { MindmapDoc } from "../model/types";
import { MindmapPreview } from "../ui/MindmapPreview";

/**
 * The read-only preview is the editor's canvas on a store that is always
 * presenting. What matters is the negative space: nothing here may edit. A
 * click must not select, a double-click must not open a label, and there is
 * no autosave or presence traffic at all — the workspace viewer opens this
 * for every map a person merely looks at.
 */

const CANVAS_BOX = { x: 0, y: 0, width: 1000, height: 700 };

beforeAll(() => {
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

const fetchMock = jest.fn();
beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(() => {
    fetchMock.mockReset();
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
    const first = { ...createPage(), name: "Overview", nodes: [root, child], edges: [] };
    const second = { ...createPage(), name: "Detail", nodes: [], edges: [] };
    const doc = createDoc("Test map", [first, second]);
    return { ...doc, activePageId: first.id };
}

describe("MindmapPreview", () => {
    it("draws the document's shapes and labels", () => {
        const doc = sampleDoc();
        const { container } = render(<MindmapPreview doc={doc} />);
        const [root, child] = doc.pages[0]!.nodes;
        expect(container.querySelector(`[data-node-id="${root!.id}"]`)).not.toBeNull();
        expect(container.querySelector(`[data-node-id="${child!.id}"]`)).not.toBeNull();
        expect(screen.getByText("Central idea")).toBeInTheDocument();
    });

    it("does not select on click or open a label on double-click", () => {
        const doc = sampleDoc();
        const { container } = render(<MindmapPreview doc={doc} />);
        const root = doc.pages[0]!.nodes[0]!;
        const el = container.querySelector(`[data-node-id="${root.id}"]`)!;

        fireEvent.pointerDown(el, { clientX: 200, clientY: 140, button: 0, pointerId: 1 });
        fireEvent.pointerUp(el, { clientX: 200, clientY: 140, button: 0, pointerId: 1 });
        expect(container.querySelectorAll("[data-handle]").length).toBe(0);

        fireEvent.doubleClick(el, { clientX: 200, clientY: 140 });
        expect(container.querySelector("textarea")).toBeNull();
    });

    it("makes no network requests of its own", () => {
        render(<MindmapPreview doc={sampleDoc()} />);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("offers page tabs and zoom, and nothing that edits", async () => {
        const user = userEvent.setup();
        render(<MindmapPreview doc={sampleDoc()} />);

        expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Detail" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Fit to screen" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /add page/i })).toBeNull();

        const before = screen.getByText(/%$/).textContent;
        await user.click(screen.getByRole("button", { name: "Zoom in" }));
        expect(screen.getByText(/%$/).textContent).not.toBe(before);
    });
});
