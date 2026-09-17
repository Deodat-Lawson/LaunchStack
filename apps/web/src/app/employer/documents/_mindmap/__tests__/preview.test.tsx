/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { createDoc, createNode, createPage } from "../model/factory";
import { isDarkSurface, THEME_BY_ID } from "../model/palette";
import { applyThemeToDoc } from "../model/theme";
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

/** Observers created during a render, so a test can fire a resize at them. */
const resizeCallbacks: Array<() => void> = [];

/** Restage the measured box and notify every observer, as a real resize would. */
function resizeStageTo(width: number, height: number) {
    CANVAS_BOX.width = width;
    CANVAS_BOX.height = height;
    act(() => {
        for (const cb of resizeCallbacks) cb();
    });
}

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
        constructor(private readonly cb: () => void) {}
        observe() {
            resizeCallbacks.push(this.cb);
        }
        unobserve() {
            /* no-op */
        }
        disconnect() {
            const i = resizeCallbacks.indexOf(this.cb);
            if (i >= 0) resizeCallbacks.splice(i, 1);
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
function setAppTheme(mode: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", mode);
}

/** The paper the canvas actually painted, read off the rendered svg. */
function paperIsDark(container: HTMLElement): boolean {
    const svg = container.querySelector("svg")!;
    return svg.getAttribute("data-paper") === "dark";
}

beforeEach(() => {
    fetchMock.mockReset();
    setAppTheme("light");
    resizeCallbacks.length = 0;
    CANVAS_BOX.width = 1000;
    CANVAS_BOX.height = 700;
});

function currentZoom(): number {
    return Number(screen.getByText(/%$/).textContent.replace("%", ""));
}

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

    /**
     * The preview commonly mounts while its panel is still animating open, so
     * the first measurement is narrow. Framing once against that and never
     * revisiting it left the board at 8% in a full-width pane.
     */
    it("re-frames when the stage grows, rather than keeping the first fit", () => {
        CANVAS_BOX.width = 160;
        CANVAS_BOX.height = 1200;
        render(<MindmapPreview doc={sampleDoc()} />);
        const cramped = currentZoom();

        resizeStageTo(1000, 700);

        expect(currentZoom()).toBeGreaterThan(cramped);
    });

    it("stops re-framing once the reader has zoomed", async () => {
        const user = userEvent.setup();
        render(<MindmapPreview doc={sampleDoc()} />);

        await user.click(screen.getByRole("button", { name: "Zoom in" }));
        const chosen = currentZoom();

        resizeStageTo(1400, 900);

        expect(currentZoom()).toBe(chosen);
    });

    it("re-arms auto-framing when the reader asks to fit", async () => {
        const user = userEvent.setup();
        render(<MindmapPreview doc={sampleDoc()} />);

        await user.click(screen.getByRole("button", { name: "Zoom in" }));
        await user.click(screen.getByRole("button", { name: "Fit to screen" }));
        const fitted = currentZoom();

        resizeStageTo(1400, 900);

        expect(currentZoom()).not.toBe(fitted);
    });

    /**
     * Board paper is document data, but the ten themes are five identities in
     * two lightings. A reader in a light app should not be handed a black page,
     * and a reader in a dark one should not be flashbanged.
     */
    describe("lighting follows the reader, without touching the document", () => {
        it("shows a dark board lit for a light app", () => {
            const dark = applyThemeToDoc(sampleDoc(), "midnight");
            expect(isDarkSurface(dark.pages[0]!.background.color)).toBe(true);

            setAppTheme("light");
            const { container } = render(<MindmapPreview doc={dark} />);

            expect(paperIsDark(container)).toBe(false);
        });

        it("shows a light board lit for a dark app", () => {
            setAppTheme("dark");
            const { container } = render(<MindmapPreview doc={sampleDoc()} />);

            expect(paperIsDark(container)).toBe(true);
        });

        it("leaves the document alone — this is a rendering choice, not an edit", () => {
            const dark = applyThemeToDoc(sampleDoc(), "midnight");
            const before = JSON.stringify(dark);

            setAppTheme("light");
            render(<MindmapPreview doc={dark} />);

            expect(JSON.stringify(dark)).toBe(before);
        });

        it("keeps the board's identity, changing only its lighting", () => {
            const dark = applyThemeToDoc(sampleDoc(), "midnight");
            setAppTheme("light");
            render(<MindmapPreview doc={dark} />);

            // Midnight's twin is Launchstack — same cycle, opposite lighting.
            expect(THEME_BY_ID.default!.cycle).toEqual(THEME_BY_ID.midnight!.cycle);
        });
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
