/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { buildTemplate } from "../model/templates";
import { MindmapEditor } from "../ui/MindmapEditor";

/**
 * Whole-editor smoke tests.
 *
 * These mount the real shell — toolbar, canvas, panels, autosave, presence —
 * against a stubbed network. They are what catches a composition bug (a hook
 * order change, a missing provider, a selector that throws) that no unit test
 * on the model layer ever would.
 */

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/employer/mindmap/1",
}));

const fetchMock = jest.fn();

beforeAll(() => {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            width: 1200,
            height: 800,
            right: 1200,
            bottom: 800,
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
    Element.prototype.scrollIntoView = function scrollIntoView() {
        /* no-op */
    };
    global.fetch = fetchMock as unknown as typeof fetch;
});

/** Minimal `Response` stand-in — jsdom does not ship the fetch primitives. */
function reply(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    });
}

beforeEach(() => {
    // Real timers throughout: the presence heartbeat reschedules itself, and
    // fake timers turn that into an unbounded loop the moment anything drains
    // the queue. Waits below are short and use `waitFor`.
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (String(url).includes("/presence")) return reply({ peers: [], revision: 1 });
        if (String(url).includes("/revisions")) return reply({ revisions: [] });
        if (method === "PATCH") return reply({ mindmap: { revision: 2 } });
        return reply({});
    });
});

function mountEditor() {
    return render(
        <MindmapEditor
            mindmapId={1}
            initialDoc={buildTemplate("mindmap", "Product plan")}
            initialTitle="Product plan"
            initialRevision={1}
            folder="Unfiled"
            publishedDocumentId={null}
            author="Ada Lovelace"
        />
    );
}

describe("editor shell", () => {
    it("mounts every region of the editor", () => {
        mountEditor();

        // Identity + save state
        expect(screen.getByLabelText("Mindmap title")).toHaveValue("Product plan");
        // Tools. Several labels ("Connector", "Sticky note") name both a
        // toolbar button and a palette tile, so assert presence, not uniqueness.
        expect(screen.getByLabelText("Select")).toBeInTheDocument();
        expect(screen.getAllByLabelText("Connector").length).toBeGreaterThan(0);
        expect(screen.getByLabelText("Pan")).toBeInTheDocument();
        // Panels
        expect(screen.getByText("Shapes")).toBeInTheDocument();
        expect(screen.getByText("Outline")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Search shapes…")).toBeInTheDocument();
        // Page tabs and zoom
        expect(screen.getByLabelText("Add page")).toBeInTheDocument();
        expect(screen.getByLabelText("Fit to screen")).toBeInTheDocument();
        expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    });

    it("renders the template's shapes on the canvas", () => {
        const view = mountEditor();
        expect(view.container.querySelectorAll("[data-node-id]").length).toBeGreaterThan(5);
        expect(view.container.querySelectorAll("[data-edge-id]").length).toBeGreaterThan(3);
    });

    it("shows the document title in the header field", async () => {
        const user = userEvent.setup();
        mountEditor();
        const title = screen.getByLabelText("Mindmap title");
        await user.clear(title);
        await user.type(title, "Renamed");
        await user.tab();
        expect(screen.getByLabelText("Mindmap title")).toHaveValue("Renamed");
    });

    it("starts a presence heartbeat", async () => {
        mountEditor();
        await waitFor(() => {
            expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/presence"))).toBe(
                true
            );
        });
    });

    it("switches the left panel between its tabs", async () => {
        const user = userEvent.setup();
        mountEditor();

        await user.click(screen.getByText("Outline"));
        expect(screen.getAllByTitle(/Central idea|First branch/).length).toBeGreaterThan(0);

        await user.click(screen.getByText("Comments"));
        expect(screen.getByText("Comment")).toBeInTheDocument();
    });

    it("offers Share and Present in the header", () => {
        mountEditor();
        expect(screen.getByRole("button", { name: /Share/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Present/ })).toBeInTheDocument();
    });

    it("opens the export dialog on ⌘E", async () => {
        const user = userEvent.setup();
        mountEditor();
        // Driven by the shortcut rather than the Share dropdown: Radix menus
        // rely on pointer capture, which jsdom does not implement, and the
        // dialog is the thing under test either way.
        await user.keyboard("{Meta>}e{/Meta}");
        expect(await screen.findByText(/Export “Product plan”/)).toBeInTheDocument();
        for (const format of ["PNG", "SVG", "PDF", "JSON", "Markdown", "Mermaid"]) {
            expect(screen.getByText(format)).toBeInTheDocument();
        }
    });

    it("opens the shortcuts dialog", async () => {
        const user = userEvent.setup();
        mountEditor();
        await user.click(screen.getByLabelText("Keyboard shortcuts"));
        expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
        expect(screen.getByText("Add child topic")).toBeInTheDocument();
    });

    it("adds a page from the page strip", async () => {
        const user = userEvent.setup();
        mountEditor();
        await user.click(screen.getByLabelText("Add page"));
        expect(screen.getByText("Page 2")).toBeInTheDocument();
    });
});

describe("autosave", () => {
    it("PATCHes the document after an edit settles", async () => {
        const user = userEvent.setup();
        mountEditor();

        // Any edit marks the document dirty; renaming is the simplest.
        const title = screen.getByLabelText("Mindmap title");
        await user.clear(title);
        await user.type(title, "Edited");
        await user.tab();

        await waitFor(
            () => {
                const saved = fetchMock.mock.calls.find(
                    call => (call[1] as RequestInit | undefined)?.method === "PATCH"
                );
                expect(saved).toBeDefined();
            },
            { timeout: 6000 }
        );
    });

    it("keeps the user's work when the server rejects a stale save", async () => {
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (String(url).includes("/presence")) return reply({ peers: [], revision: 9 });
            if ((init?.method ?? "GET") === "PATCH") return reply({ error: "Conflict" }, 409);
            return reply({});
        });

        const user = userEvent.setup();
        mountEditor();

        const title = screen.getByLabelText("Mindmap title");
        await user.clear(title);
        await user.type(title, "Mine");
        await user.tab();

        await waitFor(
            () => {
                const patched = fetchMock.mock.calls.filter(
                    call => (call[1] as RequestInit | undefined)?.method === "PATCH"
                );
                expect(patched.length).toBeGreaterThan(0);
            },
            { timeout: 6000 }
        );
        // A 409 must never silently discard local work.
        expect(screen.getByLabelText("Mindmap title")).toHaveValue("Mine");
    });

    it("tells the user when the server has moved ahead", async () => {
        fetchMock.mockImplementation((url: string) => {
            if (String(url).includes("/presence")) return reply({ peers: [], revision: 7 });
            return reply({});
        });

        mountEditor();

        expect(
            await screen.findByText(/newer version/i, undefined, { timeout: 6000 })
        ).toBeInTheDocument();
    });
});
