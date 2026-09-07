/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AddSourceModal } from "../AddSourceModal";
import { ADD_TABS } from "../types";

/**
 * "Add a source" → Create.
 *
 * The Create group does not ingest anything: Mindmap makes a document in the
 * Mindmap app and sends the user to the editor, where publishing it back turns
 * the diagram into a citable source; Google Doc makes a real Doc in the
 * workspace's Drive and opens it in a new tab. These tests pin both routes —
 * the entry point is the whole reason the features know about each other.
 */

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

const fetchMock = jest.fn();

/** Response the URL-aware mock returns for anything but the status probe. */
let defaultResponse: Record<string, unknown>;
/** What GET /api/connectors/google reports; drives whether the tab exists. */
let googleStatus: Record<string, unknown>;

function jsonOk(body: unknown, status = 201) {
    return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(""),
    };
}

/** The call the component made to `url`, or undefined. */
function callTo(url: string): [string, RequestInit | undefined] | undefined {
    return fetchMock.mock.calls.find(c => c[0] === url) as
        | [string, RequestInit | undefined]
        | undefined;
}

/** The request body the component sent to `url`, as JSON. */
function sentBody<T>(url: string): T {
    const body = callTo(url)?.[1]?.body;
    if (typeof body !== "string") throw new Error(`expected a JSON string body for ${url}`);
    return JSON.parse(body) as T;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    mockPush.mockReset();
    fetchMock.mockReset();
    // Default: Drive-linked files are dark, so the Google Doc tab is absent and
    // the Mindmap assertions below see the modal exactly as it ships today.
    googleStatus = { enabled: false, connected: false };
    defaultResponse = { mindmap: { id: 42 } };
    fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
            url === "/api/connectors/google" ? jsonOk(googleStatus, 200) : jsonOk(defaultResponse)
        )
    );
});

/**
 * The modal probes the Google connection on open. Tests that do not care about
 * it still have to let that state land, or React warns about an update outside
 * act().
 */
function settleStatus() {
    return waitFor(() => expect(callTo("/api/connectors/google")).toBeDefined());
}

function mount(props: Partial<React.ComponentProps<typeof AddSourceModal>> = {}) {
    return render(
        <AddSourceModal
            open
            onClose={jest.fn()}
            userId="user_1"
            defaultCategory="Strategy"
            folders={["Strategy", "Unfiled"]}
            onUploaded={jest.fn()}
            {...props}
        />
    );
}

describe("the Create group", () => {
    it("is listed first, before Upload and Connect", () => {
        expect(ADD_TABS[0]?.group).toBe("Create");
        expect(ADD_TABS.map(g => g.group)).toEqual(["Create", "Upload", "Connect"]);
    });

    it("offers a Mindmap entry", () => {
        expect(ADD_TABS[0]?.items.map(i => i.id)).toContain("mindmap");
    });

    it("renders the Mindmap tab in the sidebar", async () => {
        mount();
        expect(screen.getByRole("button", { name: "Mindmap" })).toBeInTheDocument();
        await settleStatus();
    });
});

describe("creating a mindmap", () => {
    it("shows the template gallery when the tab is opened", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));

        expect(screen.getByText("Diagram it, then cite it")).toBeInTheDocument();
        expect(screen.getByText("Blank canvas")).toBeInTheDocument();
        expect(screen.getByText("Flowchart")).toBeInTheDocument();
        expect(screen.getByText("Org chart")).toBeInTheDocument();
    });

    it("names the destination folder so the user knows where it lands", async () => {
        const user = userEvent.setup();
        mount({ defaultCategory: "Strategy" });
        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        // The folder is named twice on purpose: in the panel copy and on the
        // "Save to" picker in the footer.
        expect(screen.getAllByText("Strategy").length).toBeGreaterThanOrEqual(1);
    });

    it("opens on the Mindmap tab when asked to", async () => {
        mount({ initialTab: "mindmap" });
        expect(screen.getByText("Diagram it, then cite it")).toBeInTheDocument();
        await settleStatus();
    });

    it("creates the document and navigates to the editor", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Mindmap", { selector: "span" }));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());

        expect(callTo("/api/mindmaps")![1]!.method).toBe("POST");
        const body = sentBody<{ title: string; templateId: string; folder: string }>(
            "/api/mindmaps"
        );
        expect(body.templateId).toBe("mindmap");
        expect(body.folder).toBe("Strategy");

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/employer/mindmap/42"));
    });

    it("creates an untitled document from the blank template", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());
        const body = sentBody<{ title: string; templateId: string }>("/api/mindmaps");
        expect(body.templateId).toBe("blank");
        expect(body.title).toBe("Untitled mindmap");
    });

    it("stays put and reports the problem when creation fails", async () => {
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(
                url === "/api/connectors/google"
                    ? jsonOk(googleStatus, 200)
                    : jsonOk({ error: "Boom" }, 500)
            )
        );
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(callTo("/api/mindmaps")).toBeDefined());
        expect(mockPush).not.toHaveBeenCalled();
    });
});

/**
 * The Drive-linked files feature is dark by default, so the tab has to be
 * absent — not disabled — unless the deployment reports it enabled.
 */
describe("creating a Google Doc", () => {
    const openedTabs: Array<{ location: { href: string }; close: jest.Mock }> = [];

    beforeEach(() => {
        openedTabs.length = 0;
        window.open = jest.fn(() => {
            const tab = { location: { href: "" }, close: jest.fn() };
            openedTabs.push(tab);
            return tab as unknown as Window;
        }) as unknown as typeof window.open;
    });

    function enabled(extra: Record<string, unknown> = {}) {
        googleStatus = {
            enabled: true,
            connected: true,
            accountEmail: "team@example.com",
            ...extra,
        };
    }

    it("hides the tab when the deployment has the feature off", async () => {
        mount();
        await waitFor(() => expect(callTo("/api/connectors/google")).toBeDefined());
        expect(screen.queryByRole("button", { name: "Google Doc" })).not.toBeInTheDocument();
    });

    it("shows the tab once the deployment reports it enabled", async () => {
        enabled();
        mount();
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
    });

    it("offers Connect instead of Create when no account is linked yet", async () => {
        enabled({ connected: false, connectUrl: "/api/connectors/google/oauth/start" });
        const user = userEvent.setup();
        mount();

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));

        expect(screen.getByRole("button", { name: "Connect Google" })).toBeInTheDocument();
        expect(screen.queryByText("Blank document")).not.toBeInTheDocument();
    });

    it("creates the doc in the chosen folder and opens it in a new tab", async () => {
        enabled();
        defaultResponse = {
            success: true,
            documentId: 51,
            url: "https://docs.google.com/document/d/doc1/edit",
        };
        const onUploaded = jest.fn();
        const user = userEvent.setup();
        mount({ defaultCategory: "Strategy", onUploaded });

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.type(screen.getByPlaceholderText("Untitled document"), "Q3 Planning");
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(callTo("/api/google-docs")).toBeDefined());
        const body = sentBody<{ title: string; folder: string }>("/api/google-docs");
        expect(body).toEqual({ title: "Q3 Planning", folder: "Strategy" });

        // The tab is opened synchronously and pointed afterwards, so a popup
        // blocker sees a real user gesture.
        await waitFor(() =>
            expect(openedTabs[0]!.location.href).toBe(
                "https://docs.google.com/document/d/doc1/edit"
            )
        );
        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    });

    it("sends no title when the field is left blank, letting the server default", async () => {
        enabled();
        defaultResponse = { success: true, documentId: 51, url: "https://docs.google.com/x" };
        const user = userEvent.setup();
        mount();

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(callTo("/api/google-docs")).toBeDefined());
        expect(sentBody<{ title?: string }>("/api/google-docs").title).toBeUndefined();
    });

    it("closes the blank tab when creation fails", async () => {
        enabled();
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(
                url === "/api/connectors/google"
                    ? jsonOk(googleStatus, 200)
                    : jsonOk({ success: false, message: "Not connected" }, 409)
            )
        );
        const onUploaded = jest.fn();
        const user = userEvent.setup();
        mount({ onUploaded });

        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Google Doc" })).toBeInTheDocument()
        );
        await user.click(screen.getByRole("button", { name: "Google Doc" }));
        await user.click(screen.getByText("Blank document"));

        await waitFor(() => expect(openedTabs[0]!.close).toHaveBeenCalled());
        expect(onUploaded).not.toHaveBeenCalled();
    });
});
