/** @jest-environment jsdom */

/**
 * Templated Drafts as a tab on the shared tool frame. What this pins:
 *
 * - the path → screen switch (`draftsScreenFor`), on its own;
 * - the rail replaces the library's old New document / My documents tabs,
 *   counts the drafts, and moves inside the tab;
 * - a draft is a record page at /documents/<id> whose back control leads to
 *   My documents, and an id the list does not have is a not-found state the
 *   tab does not remember;
 * - the home's "Ask AI" hands its text to the assistant once, and the
 *   assistant keeps its conversation across trips through the rail;
 * - loading, error and retry behave as they did.
 *
 * The editors and the chat are stand-ins: they are large, and what matters
 * here is what the tab hands them and does with their callbacks.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { ToolHost } from "~/components/tool-app/nav";
import { DraftsTool, draftsRail } from "~/app/employer/documents/components/DraftsTool";
import {
    DRAFTS_ROOTS,
    draftsDocumentPath,
    draftsScreenFor,
} from "~/app/employer/documents/components/generator/drafts-screens";

const mockChatMounts = jest.fn();

jest.mock("~/app/employer/documents/components/LegalDocumentEditor", () => ({
    LegalDocumentEditor: (props: {
        initialTitle: string;
        templateId: string;
        onBack: () => void;
        onSave: (title: string, content: string, sections: unknown[]) => void;
    }) => (
        <div data-testid="legal-editor">
            <h2>{props.initialTitle}</h2>
            <span data-testid="legal-editor-template">{props.templateId}</span>
            <button onClick={props.onBack}>Back to My documents</button>
            <button onClick={() => props.onSave("Renamed NDA", "<p>Body</p>", [])}>Save</button>
        </div>
    ),
}));

jest.mock("~/app/employer/documents/components/DocumentGeneratorEditor", () => ({
    DocumentGeneratorEditor: (props: {
        initialTitle: string;
        backLabel?: string;
        docxBase64?: string;
        onBack: () => void;
    }) => (
        <div data-testid="general-editor">
            <h2>{props.initialTitle}</h2>
            <button onClick={props.onBack}>{props.backLabel ?? "Back"}</button>
        </div>
    ),
}));

jest.mock("~/app/employer/documents/components/LegalChatbot", () => ({
    LegalChatbot: function FakeChat(props: {
        onBack?: () => void;
        initialMessage?: string;
        onContinueToTemplateForm: (templateId: string, prefilled: Record<string, string>) => void;
    }) {
        const { useEffect, useState } = jest.requireActual<typeof React>("react");
        // State that only survives if the chat stays mounted.
        const [typed, setTyped] = useState(0);
        useEffect(() => {
            mockChatMounts(props.initialMessage);
        }, []); // eslint-disable-line react-hooks/exhaustive-deps
        return (
            <div data-testid="chat">
                <p data-testid="chat-initial">{props.initialMessage ?? "(none)"}</p>
                <p data-testid="chat-typed">{typed}</p>
                <button onClick={() => setTyped(n => n + 1)}>Type</button>
                {props.onBack && <button onClick={props.onBack}>Chat back</button>}
                <button
                    onClick={() =>
                        props.onContinueToTemplateForm("nda", { disclosing_party: "Acme" })
                    }
                >
                    Continue to template form
                </button>
            </div>
        );
    },
}));

// ─── The path → screen switch ────────────────────────────────────────────────

describe("draftsScreenFor", () => {
    it.each([
        ["/", { screen: "new" }],
        ["", { screen: "new" }],
        ["/documents", { screen: "documents" }],
        ["/documents/12", { screen: "document", id: "12" }],
        ["/documents/a%20b", { screen: "document", id: "a b" }],
        ["/documents/%E0%A4%A", { screen: "document", id: "%E0%A4%A" }],
        ["/assistant", { screen: "assistant" }],
        ["/documents/12/extra", { screen: "not-found" }],
        ["/assistant/x", { screen: "not-found" }],
        ["/templates", { screen: "not-found" }],
        ["/write/3", { screen: "not-found" }],
    ])("%j is %j", (path, expected) => {
        expect(draftsScreenFor(path)).toEqual(expected);
    });

    it("document paths round-trip through the switch", () => {
        for (const id of ["7", "a b", "x/y"]) {
            expect(draftsScreenFor(draftsDocumentPath(id))).toEqual({ screen: "document", id });
        }
    });

    it("every root has a screen", () => {
        for (const root of DRAFTS_ROOTS) {
            expect(draftsScreenFor(`/${root}`).screen).not.toBe("not-found");
        }
    });

    it("the rail counts drafts only once the list is known", () => {
        const [group] = draftsRail(null);
        expect(group!.items.map(i => [i.to, i.label, i.count])).toEqual([
            ["/", "New document", undefined],
            ["/documents", "My documents", null],
            ["/assistant", "Assistant", undefined],
        ]);
        expect(draftsRail(3)[0]!.items[1]!.count).toBe(3);
    });
});

// ─── The tab ─────────────────────────────────────────────────────────────────

interface ServerDoc {
    id: number;
    title: string;
    content: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
}

const NDA_CONTENT =
    '<h1>Non-Disclosure Agreement</h1><p><mark data-field-key="disclosing_party">[Disclosing party]</mark></p>';

let serverDocs: ServerDoc[];
let failList: number;
let nextId: number;
let calls: { method: string; url: string; body?: unknown }[];
let holdList: Promise<void> | null;

function json(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
        Object.assign(globalThis, { ResizeObserver: NoopResizeObserver });
    }
});

beforeEach(() => {
    mockChatMounts.mockClear();
    window.localStorage.clear();
    failList = 0;
    nextId = 100;
    holdList = null;
    calls = [];
    serverDocs = [
        {
            id: 1,
            title: "Acme NDA",
            content: NDA_CONTENT,
            templateId: "nda",
            metadata: { templateType: "legal" },
            createdAt: new Date().toISOString(),
        },
        {
            id: 2,
            title: "Rewrite scratch",
            content: "<p>x</p>",
            templateId: "rewrite",
            createdAt: new Date().toISOString(),
        },
    ];
    Object.assign(globalThis, {
        fetch: jest.fn(async (input: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            // Every call in this tool sends a JSON string body.
            const body =
                typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
            calls.push({ method, url: input, body });
            if (input === "/api/document-generator/documents" && method === "GET") {
                if (holdList) await holdList;
                if (failList > 0) {
                    failList -= 1;
                    return json({ success: false, message: "Failed to fetch documents" });
                }
                return json({ success: true, documents: serverDocs });
            }
            if (input === "/api/document-generator/documents" && method === "POST") {
                return json({ success: true, document: { id: nextId++ } });
            }
            if (input === "/api/document-generator/documents" && method === "PUT") {
                return json({ success: true });
            }
            if (input === "/api/document-generator/legal-generate") {
                return json({ success: true, docxBase64: "UEsDBA==" });
            }
            throw new Error(`not simulated: ${method} ${input}`);
        }),
    });
});

function mount(at: string, extra: Partial<ToolHost> = {}) {
    const host: ToolHost = { active: true, request: { at, nonce: 1 }, ...extra };
    return render(<DraftsTool host={host} />);
}

const rail = () => screen.getByRole("complementary", { name: "Templated Drafts screens" });
const railLink = (name: RegExp) => within(rail()).getByRole("link", { name });
const goBack = () => fireEvent.click(within(rail()).getByRole("button", { name: "Back" }));

describe("the Templated Drafts tab", () => {
    it("opens on New document with a rail instead of the library's own tabs", async () => {
        mount("/");
        expect(
            await screen.findByRole("heading", { name: /generate a legal document/i })
        ).toBeVisible();
        expect(screen.queryByRole("tablist", { name: "Document view" })).toBeNull();

        expect(railLink(/new document/i)).toHaveAttribute("aria-current", "page");
        // The Rewrite draft is not Templated Drafts' to count.
        expect(railLink(/my documents/i)).toHaveTextContent(/My documents\s*1$/);
        expect(railLink(/assistant/i)).toBeInTheDocument();
        expect(screen.getByText(/Recent in your workspace/i)).toBeVisible();
    });

    it("shows the loading state, with no count in the rail, until the list arrives", async () => {
        let release!: () => void;
        holdList = new Promise(resolve => (release = resolve));
        mount("/documents");
        expect(screen.getByText("Loading documents…")).toBeVisible();
        expect(railLink(/my documents/i)).toHaveTextContent(/^My documents$/);
        await act(async () => release());
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
    });

    it("moves to My documents from the rail and opens a draft as a record under it", async () => {
        mount("/");
        await screen.findByRole("heading", { name: /generate a legal document/i });

        fireEvent.click(railLink(/my documents/i));
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
        expect(railLink(/my documents/i)).toHaveAttribute("aria-current", "page");

        fireEvent.click(screen.getByRole("button", { name: /Acme NDA/ }));
        const editor = await screen.findByTestId("legal-editor");
        expect(within(editor).getByRole("heading", { name: "Acme NDA" })).toBeInTheDocument();
        // Still My documents in the rail: the draft is a record under it.
        expect(railLink(/my documents/i)).toHaveAttribute("aria-current", "page");
        // Opening rebuilt the DOCX from the draft's content, as it always did.
        expect(calls.some(c => c.url === "/api/document-generator/legal-generate")).toBe(true);

        fireEvent.click(within(editor).getByRole("button", { name: "Back to My documents" }));
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
    });

    it("saves an open draft and keeps the list in step", async () => {
        mount("/documents/1");
        const editor = await screen.findByTestId("legal-editor");
        fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(calls.find(c => c.method === "PUT")?.body).toMatchObject({
                id: 1,
                title: "Renamed NDA",
                content: "<p>Body</p>",
            })
        );
        fireEvent.click(railLink(/my documents/i));
        expect(await screen.findByRole("button", { name: /Renamed NDA/ })).toBeVisible();
    });

    it("creates a draft from a template and opens it; Back returns to New document", async () => {
        mount("/");
        await screen.findByRole("heading", { name: /generate a legal document/i });
        fireEvent.click(screen.getByRole("button", { name: /^Non-Disclosure Agreement\b/ }));

        const editor = await screen.findByTestId("legal-editor");
        expect(within(editor).getByTestId("legal-editor-template")).toHaveTextContent("nda");
        expect(
            calls.find(c => c.method === "POST" && c.url.endsWith("/documents"))?.body
        ).toMatchObject({
            title: "Non-Disclosure Agreement",
            templateId: "nda",
        });
        expect(railLink(/my documents/i)).toHaveTextContent(/My documents\s*2$/);

        goBack();
        expect(
            await screen.findByRole("heading", { name: /generate a legal document/i })
        ).toBeVisible();
    });

    it("hands the home's question to the assistant once, and keeps the conversation across the rail", async () => {
        mount("/");
        await screen.findByRole("heading", { name: /generate a legal document/i });

        fireEvent.change(screen.getByPlaceholderText("e.g. NDA for new employees…"), {
            target: { value: "NDA for a new contractor" },
        });
        fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

        expect(await screen.findByTestId("chat-initial")).toHaveTextContent(
            "NDA for a new contractor"
        );
        expect(railLink(/assistant/i)).toHaveAttribute("aria-current", "page");
        // A screen of the rail: no back button of its own.
        expect(screen.queryByRole("button", { name: "Chat back" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Type" }));
        expect(mockChatMounts).toHaveBeenCalledTimes(1);

        fireEvent.click(railLink(/my documents/i));
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
        expect(screen.getByTestId("chat")).not.toBeVisible();

        fireEvent.click(railLink(/assistant/i));
        expect(screen.getByTestId("chat")).toBeVisible();
        expect(screen.getByTestId("chat-typed")).toHaveTextContent("1");
        expect(mockChatMounts).toHaveBeenCalledTimes(1);

        // "Ask AI" again is a new conversation.
        fireEvent.click(railLink(/new document/i));
        await screen.findByRole("heading", { name: /generate a legal document/i });
        fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
        await waitFor(() => expect(mockChatMounts).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId("chat-initial")).toHaveTextContent("(none)");
        expect(screen.getByTestId("chat-typed")).toHaveTextContent("0");
    });

    it("never puts the question in the tab's location", async () => {
        mount("/", { storageScope: "member:ws" });
        await screen.findByRole("heading", { name: /generate a legal document/i });
        fireEvent.change(screen.getByPlaceholderText("e.g. NDA for new employees…"), {
            target: { value: "Confidential: Acme acquisition" },
        });
        fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
        await screen.findByTestId("chat");
        await waitFor(() =>
            expect(window.localStorage.getItem("tool.location.v1:member:ws:draft")).toBe(
                "/assistant"
            )
        );
    });

    it("continues from the assistant into the new draft's editor", async () => {
        mount("/assistant");
        fireEvent.click(await screen.findByRole("button", { name: "Continue to template form" }));
        const editor = await screen.findByTestId("legal-editor");
        expect(
            within(editor).getByRole("heading", { name: "Non-Disclosure Agreement" })
        ).toBeInTheDocument();
        const created = calls.find(c => c.method === "POST" && c.url.endsWith("/documents"));
        expect(created?.body).toMatchObject({
            templateId: "nda",
            metadata: { legalData: { disclosing_party: "Acme" } },
        });
        // Back is the conversation, still there.
        goBack();
        expect(screen.getByTestId("chat")).toBeVisible();
        expect(mockChatMounts).toHaveBeenCalledTimes(1);
    });

    it("says so for a draft the list does not have, with a way back to My documents", async () => {
        mount("/documents/999", { storageScope: "member:ws" });
        expect(await screen.findByText("This draft is not in My documents")).toBeVisible();

        fireEvent.click(screen.getByRole("button", { name: "Go to My documents" }));
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
        await waitFor(() =>
            expect(window.localStorage.getItem("tool.location.v1:member:ws:draft")).toBe(
                "/documents"
            )
        );
    });

    it("does not remember a missing draft reached once the list is loaded", async () => {
        const host: ToolHost = {
            active: true,
            request: { at: "/documents", nonce: 1 },
            storageScope: "member:ws",
        };
        const { rerender } = render(<DraftsTool host={host} />);
        await screen.findByRole("heading", { name: "My documents" });
        await waitFor(() =>
            expect(window.localStorage.getItem("tool.location.v1:member:ws:draft")).toBe(
                "/documents"
            )
        );

        rerender(<DraftsTool host={{ ...host, request: { at: "/documents/999", nonce: 2 } }} />);
        expect(await screen.findByText("This draft is not in My documents")).toBeVisible();
        expect(window.localStorage.getItem("tool.location.v1:member:ws:draft")).toBe("/documents");
    });

    it("shows the frame's not-found for a path it has no screen for", async () => {
        mount("/templates/nda");
        expect(await screen.findByText("This screen does not exist")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Go to New document" }));
        expect(
            await screen.findByRole("heading", { name: /generate a legal document/i })
        ).toBeVisible();
    });

    it("shows the error with a retry when the list fails, and recovers", async () => {
        failList = 1;
        mount("/");
        expect(await screen.findByText("Failed to fetch documents")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(
            await screen.findByRole("heading", { name: /generate a legal document/i })
        ).toBeVisible();
    });

    it("on a draft's path, a failed list is an error to retry, not a missing draft", async () => {
        failList = 1;
        mount("/documents/1");
        expect(await screen.findByText("Failed to fetch documents")).toBeVisible();
        expect(screen.queryByText("This draft is not in My documents")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByTestId("legal-editor")).toBeInTheDocument();
    });

    it("opens a general draft in the general editor, whose back button names My documents", async () => {
        serverDocs.push({
            id: 3,
            title: "Plain memo",
            content: "<p>memo</p>",
            templateId: "Custom",
            createdAt: new Date().toISOString(),
        });
        mount("/documents/3");
        const editor = await screen.findByTestId("general-editor");
        fireEvent.click(within(editor).getByRole("button", { name: "My documents" }));
        expect(await screen.findByRole("heading", { name: "My documents" })).toBeVisible();
    });
});
