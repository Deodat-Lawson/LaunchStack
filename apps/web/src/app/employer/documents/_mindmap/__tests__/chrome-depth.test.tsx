/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { buildCommands } from "../ui/CommandPalette";
import { MindmapEditor } from "../ui/MindmapEditor";
import { buildTemplate } from "../model/templates";
import { EditorStore } from "../model/store";
import type { ChromeDepth } from "../model/store";

/**
 * Guardrails for the disclosure plan.
 *
 * "Simple" has to stay simple after the next ten features land, and it will
 * not unless something fails when it stops being simple. So the budget is a
 * number a test can read, and parity between the two depths is generated from
 * the same table the palette is.
 */

const fetchMock = jest.fn();

beforeAll(() => {
    // jsdom has no layout; the editor sizes its stage from ResizeObserver.
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    Element.prototype.scrollIntoView = function scrollIntoView() {
        /* no-op */
    };
    global.fetch = fetchMock as unknown as typeof fetch;
});

function reply(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    });
}

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (String(url).includes("/presence")) return reply({ peers: [], revision: 1 });
        if (String(url).includes("/revisions")) return reply({ revisions: [] });
        if (method === "PATCH") return reply({ mindmap: { revision: 2 } });
        return reply({});
    });
    window.localStorage.clear();
});

function mount(templateId: string, depth?: ChromeDepth) {
    return render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={buildTemplate(templateId, "Guardrail")}
            initialTitle="Guardrail"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
            initialChrome={depth}
        />
    );
}

/** Interactive controls that are chrome — everything except what is drawn. */
function chromeControls(container: HTMLElement): HTMLElement[] {
    const all = Array.from(
        container.querySelectorAll<HTMLElement>(
            'button, [role="button"], input, select, textarea, [role="menuitem"], [role="tab"]'
        )
    );
    return all.filter(el => !el.closest("svg") && !el.hidden);
}

/**
 * The budget: what focus depth renders today, and no more. Twelve in the top
 * bar (back, title, save, undo, redo, arrange, ⌘K, appearance, the two-way
 * depth toggle, present, share), six on the rail, seven in the page strip and
 * zoom bar. Raise it deliberately, in a commit that says why — the whole
 * point is that a control cannot drift into level zero unnoticed.
 */
const FOCUS_BUDGET = 26;

describe("chrome depth", () => {
    test("a mindmap opens in focus depth and stays under the control budget", () => {
        const view = mount("mindmap");
        const focus = chromeControls(view.container).length;
        // Jest's expect takes no message, and the number is the whole point.
        if (focus > FOCUS_BUDGET) {
            throw new Error(`focus depth renders ${focus} controls; the budget is ${FOCUS_BUDGET}`);
        }
        // The two side panels are the bulk of the full editor; neither is here.
        expect(screen.queryByRole("tab", { name: /shapes/i })).toBeNull();
        expect(screen.queryByPlaceholderText("Search shapes…")).toBeNull();
        view.unmount();

        // And the difference is real: the full editor is several times larger.
        const full = mount("mindmap", "everything");
        const everything = chromeControls(full.container).length;
        expect(everything).toBeGreaterThan(focus * 3);
    });

    test("a flowchart opens with everything", () => {
        mount("flowchart");
        expect(screen.getByPlaceholderText("Search shapes…")).toBeInTheDocument();
    });

    test("the toggle switches depth and remembers the choice for that kind", async () => {
        const user = userEvent.setup();
        const view = mount("mindmap");
        await user.click(screen.getByRole("button", { name: "Everything" }));
        expect(screen.getByPlaceholderText("Search shapes…")).toBeInTheDocument();
        expect(window.localStorage.getItem("mindmap:chrome-depth:mindmap")).toBe("everything");

        view.unmount();
        mount("mindmap");
        // Remembered: the next mindmap opens with the panels.
        await waitFor(() =>
            expect(screen.getByPlaceholderText("Search shapes…")).toBeInTheDocument()
        );
    });

    test("focus depth still exposes the mindmap's five tools", () => {
        mount("mindmap");
        const rail = screen.getByRole("button", { name: "Select" }).parentElement!;
        const names = within(rail)
            .getAllByRole("button")
            .map(b => b.getAttribute("aria-label"));
        expect(names).toEqual(
            expect.arrayContaining([
                "Select",
                "Topic",
                "Connector",
                "Text",
                "Sticky note",
                "All shapes",
            ])
        );
        expect(names).not.toContain("Pen");
        expect(names).not.toContain("Eraser");
    });
});

describe("command parity", () => {
    const host = {
        onSave: () => undefined,
        onExport: () => undefined,
        onImport: () => undefined,
        onPublish: () => undefined,
        onPresent: () => undefined,
        onShortcuts: () => undefined,
        onFit: () => undefined,
    };

    test("⌘K offers the same commands in both depths", () => {
        const store = new EditorStore(buildTemplate("mindmap", "Parity"));
        store.setChromeDepth("focus");
        const focus = buildCommands(store, host).map(c => c.id);
        store.setChromeDepth("everything");
        const everything = buildCommands(store, host).map(c => c.id);
        expect(focus).toEqual(everything);
        expect(focus.length).toBeGreaterThan(20);
    });
});
