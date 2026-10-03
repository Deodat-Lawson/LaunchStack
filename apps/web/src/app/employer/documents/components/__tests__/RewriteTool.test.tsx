/** @jest-environment jsdom */

/**
 * Rewrite, as someone uses it inside its tab: the rail replaces the old
 * New rewrite / My rewrites buttons, a saved rewrite opens at a path of its
 * own and Back returns to the list, the first save of a new rewrite gives it
 * that path without losing the editor, the step-by-step workflow is a screen
 * Back can leave, and a rewrite that is gone says so instead of crashing.
 *
 * The editor and the workflow are stand-ins: their own behaviour is not what
 * is under test, only how the tool opens, feeds and leaves them.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { ToolHost } from "~/components/tool-app/nav";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let mockEditorMounts = 0;

interface MockEditorProps {
    initialTitle: string;
    initialContent: string;
    documentId?: number;
    onBack: () => void;
    onSave: (title: string, content: string) => void | Promise<void>;
}

function MockEditor(props: MockEditorProps) {
    const [mount] = React.useState(() => ++mockEditorMounts);
    return (
        <div data-testid="editor">
            <div data-testid="editor-title">{props.initialTitle}</div>
            <div data-testid="editor-content">{props.initialContent}</div>
            <div data-testid="editor-document-id">{String(props.documentId ?? "none")}</div>
            <div data-testid="editor-mount">{mount}</div>
            <button onClick={props.onBack}>Editor back</button>
            <button
                onClick={() => void props.onSave("My draft", `${props.initialContent} (edited)`)}
            >
                Save
            </button>
            <button onClick={() => void props.onSave("   ", props.initialContent)}>
                Save without a title
            </button>
        </div>
    );
}

jest.mock("../DocumentGeneratorEditor", () => ({ DocumentGeneratorEditor: MockEditor }));

interface MockWorkflowProps {
    initialText?: string;
    onComplete: (text: string) => void;
    onCancel: () => void;
}

function MockWorkflow(props: MockWorkflowProps) {
    return (
        <div data-testid="workflow">
            <div data-testid="workflow-text">{props.initialText}</div>
            <button onClick={() => props.onComplete("The polished text")}>Finish</button>
            <button onClick={props.onCancel}>Exit</button>
        </div>
    );
}

jest.mock("../generator/RewriteWorkflow", () => ({ RewriteWorkflow: MockWorkflow }));

import { RewriteTool } from "../RewriteTool";

// Radix measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const SCOPE = "member-1:workspace-1";
const SAVED_KEY = `tool.location.v1:${SCOPE}:rewrite`;

const DOCS = [
    {
        id: 1,
        title: "Quarterly letter",
        content: "<p>Dear investors, the quarter went well.</p>",
        createdAt: "2026-09-01T10:00:00Z",
        updatedAt: "2026-09-02T10:00:00Z",
    },
    {
        id: 2,
        title: "Hiring post",
        content: "We are hiring a founding engineer.",
        createdAt: "2026-09-03T10:00:00Z",
    },
];

type Handler = (init?: RequestInit) => { status?: number; body: unknown };

let listResponse: Handler;
let postResponse: Handler;
let putResponse: Handler;
const mockFetch = jest.fn();

function respond({ status = 200, body }: { status?: number; body: unknown }) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(JSON.parse(text) as unknown),
        text: () => Promise.resolve(text),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEditorMounts = 0;
    window.localStorage.clear();
    window.sessionStorage.clear();
    listResponse = () => ({ body: { success: true, documents: DOCS } });
    postResponse = () => ({ body: { success: true, document: { id: 77 } } });
    putResponse = () => ({ body: { success: true } });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return respond(listResponse(init));
        if (init.method === "POST") return respond(postResponse(init));
        return respond(putResponse(init));
    });
    global.fetch = mockFetch as unknown as typeof fetch;
});

/** Let a list request still in flight (the first load, the refresh on leaving the editor) land inside act. */
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

function listCalls() {
    return mockFetch.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method)
        .length;
}

function saveCalls(method: "POST" | "PUT") {
    return mockFetch.mock.calls
        .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
        .map(
            ([, init]) =>
                JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
        );
}

function mount(host: ToolHost = {}) {
    return render(<RewriteTool host={{ storageScope: SCOPE, ...host }} />);
}

/** The rail, not the folded screen bar: its links are what a wide tab shows. */
function rail() {
    return within(screen.getByRole("complementary", { name: "Rewrite screens" }));
}

function remembered() {
    return window.localStorage.getItem(SAVED_KEY);
}

describe("RewriteTool", () => {
    it("opens on New rewrite: the rail has both screens, the hero keeps its heading but not its tabs", async () => {
        mount();
        expect(screen.getByRole("heading", { name: /Refine your\s+prose/ })).toBeInTheDocument();
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();
        expect(screen.getByText("How the workflow works")).toBeInTheDocument();

        const newLink = rail().getByRole("link", { name: "New rewrite" });
        expect(newLink).toHaveAttribute("aria-current", "page");
        expect(newLink).toHaveAttribute("href", "/employer/documents?feature=rewrite&at=%2F");
        // The count arrives with the list.
        await waitFor(() =>
            expect(rail().getByRole("link", { name: /My rewrites/ })).toHaveTextContent(
                "My rewrites2"
            )
        );
        // The hero's own New rewrite / My rewrites buttons are gone.
        expect(screen.queryByRole("button", { name: /My rewrites/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^New rewrite/ })).not.toBeInTheDocument();
    });

    it("lists saved rewrites, opens one at its own path, and Back returns to the list", async () => {
        mount();
        fireEvent.click(rail().getByRole("link", { name: /My rewrites/ }));
        expect(remembered()).toBe("/rewrites");

        const row = await screen.findByRole("link", { name: /Quarterly letter/ });
        expect(row).toHaveAttribute(
            "href",
            "/employer/documents?feature=rewrite&at=%2Frewrites%2F1"
        );
        expect(screen.getByRole("link", { name: /Hiring post/ })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Search your rewrites"), {
            target: { value: "hiring" },
        });
        expect(screen.queryByRole("link", { name: /Quarterly letter/ })).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Search your rewrites"), {
            target: { value: "" },
        });

        fireEvent.click(screen.getByRole("link", { name: /Quarterly letter/ }));
        expect(screen.getByTestId("editor-title")).toHaveTextContent("Quarterly letter");
        expect(screen.getByTestId("editor-document-id")).toHaveTextContent("1");
        expect(remembered()).toBe("/rewrites/1");
        // A rewrite is a record under My rewrites.
        expect(rail().getByRole("link", { name: /My rewrites/ })).toHaveAttribute(
            "aria-current",
            "page"
        );

        const before = listCalls();
        fireEvent.click(screen.getByRole("button", { name: "Editor back" }));
        expect(await screen.findByRole("link", { name: /Quarterly letter/ })).toBeInTheDocument();
        expect(remembered()).toBe("/rewrites");
        // Leaving the editor refreshes the list, as the old Back to list did.
        await waitFor(() => expect(listCalls()).toBe(before + 1));

        // The frame's Forward goes back into the same rewrite.
        fireEvent.click(screen.getAllByRole("button", { name: "Forward" })[0]!);
        expect(screen.getByTestId("editor-title")).toHaveTextContent("Quarterly letter");
    });

    it("saves edits to a saved rewrite in place", async () => {
        mount({ request: { at: "/rewrites/2", nonce: 1 } });
        expect(await screen.findByTestId("editor-title")).toHaveTextContent("Hiring post");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(saveCalls("PUT")).toHaveLength(1));
        expect(saveCalls("PUT")[0]).toEqual({
            id: 2,
            title: "My draft",
            content: "We are hiring a founding engineer. (edited)",
            citations: [],
        });
        expect(saveCalls("POST")).toHaveLength(0);
        expect(remembered()).toBe("/rewrites/2");
    });

    it("gives a new rewrite its own path on the first save, in the same editor", async () => {
        mount();
        await waitFor(() =>
            expect(rail().getByRole("link", { name: /My rewrites/ })).toHaveTextContent("2")
        );
        fireEvent.click(screen.getByRole("button", { name: /Start from blank/ }));

        expect(screen.getByTestId("editor-document-id")).toHaveTextContent("none");
        const mountBefore = screen.getByTestId("editor-mount").textContent;
        // Nothing to come back to yet: the tab keeps remembering New rewrite.
        expect(remembered()).toBe("/");

        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(screen.getByTestId("editor-document-id")).toHaveTextContent("77")
        );
        expect(saveCalls("POST")[0]).toMatchObject({
            title: "My draft",
            templateId: "rewrite",
            metadata: { source: "rewrite" },
        });
        expect(screen.getByTestId("editor-mount").textContent).toBe(mountBefore);
        expect(remembered()).toBe("/rewrites/77");
        expect(rail().getByRole("link", { name: /My rewrites/ })).toHaveTextContent("3");

        // The next save updates the rewrite it just created.
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(saveCalls("PUT")).toHaveLength(1));
        expect(saveCalls("PUT")[0]).toMatchObject({ id: 77 });

        // Back from the editor returns to where it was started, as before.
        fireEvent.click(screen.getByRole("button", { name: "Editor back" }));
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();
        await settle();
    });

    it("saves a rewrite with no title as Untitled (Rewrite)", async () => {
        mount({ request: { at: "/rewrites/new", nonce: 1 } });
        fireEvent.click(await screen.findByRole("button", { name: "Save without a title" }));
        await waitFor(() => expect(saveCalls("POST")).toHaveLength(1));
        expect(saveCalls("POST")[0]).toMatchObject({ title: "Untitled (Rewrite)" });
    });

    it("runs the step-by-step workflow as a screen Back can leave, and finishing opens the editor", async () => {
        Object.assign(navigator, {
            clipboard: { readText: jest.fn(() => Promise.resolve("Text from the clipboard")) },
        });
        mount();
        fireEvent.click(screen.getByRole("button", { name: /Start workflow/ }));
        expect(screen.getByTestId("workflow")).toBeInTheDocument();
        expect(screen.getByTestId("workflow-text")).toBeEmptyDOMElement();
        // The workflow's input lives in memory only; the tab does not reopen on it.
        expect(remembered()).toBe("/");

        // The frame's Back leaves it.
        fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]!);
        expect(screen.queryByTestId("workflow")).not.toBeInTheDocument();
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Paste from clipboard/ }));
        expect(await screen.findByTestId("workflow-text")).toHaveTextContent(
            "Text from the clipboard"
        );

        fireEvent.click(screen.getByRole("button", { name: "Finish" }));
        expect(screen.getByTestId("editor-title")).toHaveTextContent("Rewritten Text");
        expect(screen.getByTestId("editor-content")).toHaveTextContent("The polished text");
        expect(screen.getByTestId("editor-document-id")).toHaveTextContent("none");

        // The finished workflow is not in the history: Back goes to New rewrite.
        fireEvent.click(screen.getByRole("button", { name: "Editor back" }));
        expect(screen.queryByTestId("workflow")).not.toBeInTheDocument();
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();
        await settle();
    });

    it("Exit leaves the workflow for the screen it was started from", async () => {
        mount();
        fireEvent.click(screen.getByRole("button", { name: /Start workflow/ }));
        fireEvent.click(screen.getByRole("button", { name: "Exit" }));
        expect(screen.queryByTestId("workflow")).not.toBeInTheDocument();
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Back" })[0]).toBeDisabled();
        await settle();
    });

    it("imports a text file into the workflow and says why it cannot import a PDF", async () => {
        mount();
        const input = screen.getByLabelText("Import a document");

        const pdf = new File(["%PDF"], "deck.pdf", { type: "application/pdf" });
        fireEvent.change(input, { target: { files: [pdf] } });
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "PDF import not yet supported. Please copy and paste the text manually."
        );

        const txt = new File(["Plain words to polish"], "notes.txt", { type: "text/plain" });
        Object.defineProperty(txt, "text", {
            value: () => Promise.resolve("Plain words to polish"),
        });
        fireEvent.change(input, { target: { files: [txt] } });
        expect(await screen.findByTestId("workflow-text")).toHaveTextContent(
            "Plain words to polish"
        );
    });

    it("says so when a rewrite is gone, and goes to My rewrites from there", async () => {
        mount({ request: { at: "/rewrites/999", nonce: 1 } });
        expect(await screen.findByText("This rewrite is not here")).toBeInTheDocument();
        expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Go to My rewrites" }));
        expect(await screen.findByRole("link", { name: /Quarterly letter/ })).toBeInTheDocument();
        expect(remembered()).toBe("/rewrites");
    });

    it("does not remember a link to a rewrite that is gone", async () => {
        const view = mount();
        fireEvent.click(rail().getByRole("link", { name: /My rewrites/ }));
        await screen.findByRole("link", { name: /Quarterly letter/ });
        expect(remembered()).toBe("/rewrites");

        // Another tool, or an old bookmark, asks for a rewrite that was deleted.
        view.rerender(
            <RewriteTool
                host={{ storageScope: SCOPE, request: { at: "/rewrites/999", nonce: 2 } }}
            />
        );
        expect(await screen.findByText("This rewrite is not here")).toBeInTheDocument();
        expect(remembered()).toBe("/rewrites");
    });

    it("waits for the list before deciding a rewrite is gone", async () => {
        let release: () => void = () => undefined;
        mockFetch.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    release = () =>
                        resolve(respond({ body: { success: true, documents: DOCS } }) as unknown);
                })
        );
        mount({ request: { at: "/rewrites/1", nonce: 1 } });
        expect(screen.getByLabelText("Loading rewrite")).toBeInTheDocument();
        expect(screen.queryByText("This rewrite is not here")).not.toBeInTheDocument();
        await act(async () => release());
        expect(await screen.findByTestId("editor-title")).toHaveTextContent("Quarterly letter");
    });

    it("shows a save that failed in the editor", async () => {
        putResponse = () => ({ body: { success: false, message: "Document is locked" } });
        mount({ request: { at: "/rewrites/1", nonce: 1 } });
        fireEvent.click(await screen.findByRole("button", { name: "Save" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Document is locked");

        putResponse = () => ({ status: 502, body: "<html>Bad gateway</html>" });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Failed to save (502). <html>Bad gateway</html>"
            )
        );
    });

    it("has a not-found screen for a path it does not know", async () => {
        mount({ request: { at: "/drafts", nonce: 1 } });
        expect(screen.getByText("This screen does not exist")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Go to New rewrite" }));
        expect(screen.getByText("Step-by-step rewrite")).toBeInTheDocument();
        await settle();
    });

    it("opens text another tool handed over in the editor, once", async () => {
        window.sessionStorage.setItem(
            "pdr.pendingRewriteDraft",
            JSON.stringify({ title: "Campaign Draft (LinkedIn)", content: "Launch post body" })
        );
        mount();
        expect(await screen.findByTestId("editor-title")).toHaveTextContent(
            "Campaign Draft (LinkedIn)"
        );
        expect(screen.getByTestId("editor-content")).toHaveTextContent("Launch post body");
        expect(window.sessionStorage.getItem("pdr.pendingRewriteDraft")).toBeNull();
    });

    it("picks up a hand-off when an open Rewrite tab comes to the front", async () => {
        const view = mount({ active: false });
        expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
        window.sessionStorage.setItem(
            "pdr.pendingRewriteDraft",
            JSON.stringify({ content: "Handed over while hidden" })
        );
        view.rerender(<RewriteTool host={{ storageScope: SCOPE, active: true }} />);
        expect(await screen.findByTestId("editor-content")).toHaveTextContent(
            "Handed over while hidden"
        );
        expect(screen.getByTestId("editor-title")).toHaveTextContent("Rewritten Text");
    });
});
