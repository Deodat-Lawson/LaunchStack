/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { readStepsPanel } from "../lib/preferences";
import { buildTemplate } from "../model/templates";
import { MindmapEditor } from "../ui/MindmapEditor";

/**
 * The Steps panel is a toggle beside a flowchart: a top-bar button, open when
 * the person has never chosen, and their choice remembered in this browser.
 * Never on a mindmap, never while presenting.
 */

beforeAll(() => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    Element.prototype.scrollIntoView = () => undefined;
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ peers: [], revision: 1 }),
            text: () => Promise.resolve("{}"),
        })
    ) as unknown as typeof fetch;
});

beforeEach(() => window.localStorage.clear());

function mount(template = "blank") {
    return render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={buildTemplate(template, "Steps")}
            initialTitle="Steps"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
        />
    );
}

const panel = () => screen.queryByRole("textbox", { name: "Steps, one per line" });
const toggle = () => screen.getByRole("button", { name: "Steps" });

describe("the Steps panel toggle", () => {
    it("is open on a flowchart when nobody has chosen", () => {
        expect(readStepsPanel()).toBe(true);
        mount();
        expect(panel()).toBeInTheDocument();
        expect(toggle()).toHaveAttribute("aria-pressed", "true");
    });

    it("closes from the top bar, and the next flowchart opens closed", () => {
        const view = mount();
        act(() => {
            fireEvent.click(toggle());
        });
        expect(panel()).toBeNull();
        expect(window.localStorage.getItem("mindmap:steps-panel")).toBe("closed");
        view.unmount();

        mount("flowchart");
        expect(panel()).toBeNull();
        act(() => {
            fireEvent.click(toggle());
        });
        expect(panel()).toBeInTheDocument();
        expect(window.localStorage.getItem("mindmap:steps-panel")).toBe("open");
    });

    it("closes from its own ×, too", () => {
        mount();
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Close the steps" }));
        });
        expect(panel()).toBeNull();
        expect(toggle()).toHaveAttribute("aria-pressed", "false");
    });

    it("is not on a mindmap", () => {
        mount("mindmap");
        expect(screen.queryByRole("button", { name: "Steps" })).toBeNull();
        expect(panel()).toBeNull();
    });

    describe("on a narrow screen", () => {
        const wide = window.innerWidth;
        beforeEach(() => {
            Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
        });
        afterEach(() => {
            Object.defineProperty(window, "innerWidth", { configurable: true, value: wide });
        });
        const sheet = () => document.querySelector("[data-slot='sheet-content']");

        it("starts closed, and opens over the canvas as a sheet that closes again", () => {
            mount();
            expect(panel()).toBeNull();
            expect(toggle()).toHaveAttribute("aria-pressed", "false");
            act(() => {
                fireEvent.click(toggle());
            });
            expect(panel()).toBeInTheDocument();
            // Over the canvas, not beside it: in the sheet, with no docked column.
            expect(sheet()).toContainElement(panel());
            expect(screen.queryByRole("complementary", { name: "Steps" })).toBeNull();
            // The sheet has the one ✕; the panel's own steps aside.
            expect(screen.queryByRole("button", { name: "Close the steps" })).toBeNull();
            act(() => {
                fireEvent.click(screen.getByRole("button", { name: "Close" }));
            });
            expect(panel()).toBeNull();
            expect(window.localStorage.getItem("mindmap:steps-panel")).toBe("closed");
        });

        it("a stored choice to keep it open still applies, as a sheet", () => {
            window.localStorage.setItem("mindmap:steps-panel", "open");
            mount();
            expect(panel()).toBeInTheDocument();
            expect(sheet()).toContainElement(panel());
        });
    });

    it("steps aside while presenting", () => {
        mount();
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Present" }));
        });
        expect(panel()).toBeNull();
    });
});
