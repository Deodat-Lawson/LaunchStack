/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AddSourceModal } from "../AddSourceModal";
import { ADD_TABS } from "../types";

/**
 * "Add a source" → Create → Mindmap.
 *
 * The Create group does not ingest anything: it makes a document in the Mindmap
 * app and sends the user to the editor, where publishing it back turns the
 * diagram into a citable source. This test pins that route — the entry point is
 * the whole reason the two features know about each other.
 */

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

const fetchMock = jest.fn();

/** The request body the component sent, as JSON. */
function sentBody<T>(callIndex = 0): T {
    const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
    const body = init?.body;
    if (typeof body !== "string") throw new Error("expected a JSON string body");
    return JSON.parse(body) as T;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    mockPush.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ mindmap: { id: 42 } }),
        text: () => Promise.resolve(""),
    });
});

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

    it("renders the Mindmap tab in the sidebar", () => {
        mount();
        expect(screen.getByRole("button", { name: "Mindmap" })).toBeInTheDocument();
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

    it("opens on the Mindmap tab when asked to", () => {
        mount({ initialTab: "mindmap" });
        expect(screen.getByText("Diagram it, then cite it")).toBeInTheDocument();
    });

    it("creates the document and opens it in the workspace editor", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Mindmap", { selector: "span" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe("/api/mindmaps");
        expect((init as RequestInit).method).toBe("POST");
        const body = sentBody<{ title: string; templateId: string; folder: string }>();
        expect(body.templateId).toBe("mindmap");
        expect(body.folder).toBe("Strategy");

        // No gallery, no route of its own: the map opens where the library is.
        await waitFor(() =>
            expect(mockPush).toHaveBeenCalledWith("/employer/documents?source=m42&edit=1")
        );
    });

    it("hands the new map to the workspace when it asks for it", async () => {
        const user = userEvent.setup();
        const onMindmapCreated = jest.fn();
        mount({ onMindmapCreated });

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(onMindmapCreated).toHaveBeenCalledWith(42));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("creates an untitled document from the blank template", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const body = sentBody<{ title: string; templateId: string }>();
        expect(body.templateId).toBe("blank");
        expect(body.title).toBe("Untitled mindmap");
    });

    it("stays put and reports the problem when creation fails", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: "Boom" }),
            text: () => Promise.resolve("Boom"),
        });
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByRole("button", { name: "Mindmap" }));
        await user.click(screen.getByText("Blank canvas"));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(mockPush).not.toHaveBeenCalled();
    });
});
