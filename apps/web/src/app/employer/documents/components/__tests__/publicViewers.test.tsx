/** @jest-environment jsdom */

import React, { type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { PublicViewerEndpointsProvider } from "~/lib/viewer-endpoints";
import type { MediaPreview } from "~/lib/media-document";

import { ConversationViewer } from "../ConversationViewer";
import { DocumentViewer } from "../DocumentViewer";
import { MindmapDocumentViewer } from "../MindmapDocumentViewer";
import { PptxViewer } from "../PptxViewer";
import { WebsiteViewer } from "../WebsiteViewer";
import { MediaViewer } from "../media/MediaViewer";
import type { DocumentType } from "../../types/document";

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

/**
 * The workspace's viewers on a public link (ADR-016): every read goes to the
 * routes under the token, nothing records a view, nothing translates (a model
 * call), nothing edits, and nothing hands the file to a third party.
 */

const API_BASE = "/api/s/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const CONTENT = `${API_BASE}/content`;

const fetchMock = jest.fn();

interface Answer {
    status?: number;
    json?: unknown;
    text?: string;
}

/** jsdom has no `Response`; the viewers only read these members. */
function answer({ status = 200, json, text }: Answer) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        headers: { get: () => null },
        json: () => Promise.resolve(json ?? {}),
        text: () => Promise.resolve(text ?? JSON.stringify(json ?? {})),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob([])),
    } as unknown as Response);
}

function respond(routes: Record<string, Answer>) {
    fetchMock.mockImplementation((url: string) => answer(routes[url] ?? { status: 404 }));
}

function onPublicLink(ui: ReactElement, { allowDownload = false } = {}) {
    return render(
        <PublicViewerEndpointsProvider apiBase={API_BASE} allowDownload={allowDownload}>
            {ui}
        </PublicViewerEndpointsProvider>
    );
}

function requested(): string[] {
    return fetchMock.mock.calls.map(call => String(call[0]));
}

function publicDoc(overrides: Partial<DocumentType>): DocumentType {
    return { id: 0, title: "Shared", category: "", url: CONTENT, ...overrides };
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    URL.createObjectURL = jest.fn(() => "blob:preview");
    URL.revokeObjectURL = jest.fn();
    Element.prototype.scrollTo = jest.fn();
    (global as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

beforeEach(() => {
    fetchMock.mockReset();
    respond({});
});

describe("DocumentViewer on a public link", () => {
    it("records no view", async () => {
        const doc = publicDoc({ id: 9, title: "report.pdf", mimeType: "application/pdf" });
        onPublicLink(<DocumentViewer document={doc} minimal />);

        expect(screen.getByTitle("report.pdf")).toHaveAttribute("src", `${CONTENT}#page=1`);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(requested()).not.toContain("/api/documents/track-view");
    });

    it("still records a view in the workspace", async () => {
        const doc = publicDoc({ id: 9, title: "report.pdf", mimeType: "application/pdf" });
        render(<DocumentViewer document={doc} minimal />);
        await waitFor(() => expect(requested()).toContain("/api/documents/track-view"));
    });

    it("opens a Word file read-only, never in the editor", async () => {
        const doc = publicDoc({
            id: 9,
            title: "memo.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        // Not minimal, with a numeric id: in the workspace this is the editor.
        onPublicLink(<DocumentViewer document={doc} />);
        await waitFor(() => expect(requested()).toContain(CONTENT));
        expect(requested().some(url => url.includes("/api/documents/9"))).toBe(false);
        // Its failure screen offers a retry, and no download on a link with downloads off.
        expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
        expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
    });

    it("frames a page with no permission to download, either", () => {
        onPublicLink(
            <DocumentViewer
                document={publicDoc({ title: "page.html", mimeType: "text/html" })}
                minimal
            />
        );
        expect(screen.getByTitle("page.html")).toHaveAttribute("sandbox", "");
    });

    it("shows the file the way the server classified it", () => {
        // Nothing on the document says PDF; the stored file did.
        onPublicLink(
            <DocumentViewer
                document={publicDoc({ title: "Q3 report" })}
                minimal
                displayType="pdf"
            />
        );
        const frame = screen.getByTitle("Q3 report");
        expect(frame).toHaveAttribute("src", `${CONTENT}#page=1`);
        expect(frame).not.toHaveAttribute("sandbox");
    });
});

describe("PptxViewer on a public link", () => {
    it("never sends the file to Office Online and offers no download of its own", () => {
        onPublicLink(<PptxViewer url={`https://app.example.com${CONTENT}`} title="deck.pptx" />);

        expect(screen.getByText("Presentations can't be previewed on a shared link")).toBeVisible();
        expect(document.querySelector("iframe")).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();
    });
});

describe("MediaViewer on a public link", () => {
    const PREVIEW: MediaPreview = {
        documentId: 0,
        title: "standup.mp3",
        kind: "audio",
        playback: {
            type: "file",
            documentId: 0,
            url: `${API_BASE}/media/content`,
            mimeType: "audio/mpeg",
        },
        transcript: {
            documentId: 0,
            title: "standup.mp3 (Transcription)",
            language: "en",
            languages: null,
            segments: null,
            translations: [],
        },
        durationSeconds: null,
    };

    it("reads the pairing and the transcript from the link, with no Translate", async () => {
        respond({
            [`${API_BASE}/media`]: { json: PREVIEW },
            [`${API_BASE}/media/transcript`]: { text: "We ship the billing fix on Friday." },
        });
        onPublicLink(
            <MediaViewer
                document={publicDoc({
                    title: "standup.mp3 (Transcription)",
                    mimeType: "text/plain",
                })}
            />
        );

        expect(await screen.findByText("We ship the billing fix on Friday.")).toBeVisible();
        expect(screen.getByTestId("file-player").querySelector("video")).toHaveAttribute(
            "src",
            `${API_BASE}/media/content`
        );
        expect(screen.queryByRole("button", { name: "Translate transcript" })).toBeNull();
        expect(requested().every(url => url.startsWith(`${API_BASE}/`))).toBe(true);
        // Downloads are off on this link: the player offers none.
        expect(screen.queryByRole("link", { name: "Download the file" })).toBeNull();
    });

    it("offers the player's download when the link allows it", async () => {
        respond({
            [`${API_BASE}/media`]: { json: PREVIEW },
            [`${API_BASE}/media/transcript`]: { text: "We ship the billing fix on Friday." },
        });
        onPublicLink(
            <MediaViewer
                document={publicDoc({
                    title: "standup.mp3 (Transcription)",
                    mimeType: "text/plain",
                })}
            />,
            { allowDownload: true }
        );
        await screen.findByText("We ship the billing fix on Friday.");
        expect(screen.getByRole("link", { name: "Download the file" })).toHaveAttribute(
            "href",
            `${API_BASE}/media/content`
        );
    });
});

describe("WebsiteViewer on a public link", () => {
    const SITE = publicDoc({
        title: "Acme",
        ocrMetadata: { kind: "website", url: "https://acme.com/", capturedAt: "2026-11-01" },
    });
    const TEXT = `# Acme

Acme builds reusable rockets for small satellite teams. Launch windows open every week, and pricing starts low enough for a seed-stage company to fly. Every launch carries up to twelve payloads.`;

    it("opens on the page text when there is no stored picture, with no retry", async () => {
        respond({
            [`${API_BASE}/website-preview`]: {
                status: 404,
                json: { error: "This page has no saved picture." },
            },
            [`${API_BASE}/text`]: { json: { markdown: TEXT, available: true, truncated: false } },
        });
        onPublicLink(<WebsiteViewer document={SITE} />);

        // A visitor never sees a failure: the words are the page.
        expect(
            await screen.findByText("Below is the text read from this page when it was saved.")
        ).toBeVisible();
        expect(screen.getByText("Couldn't show this page")).not.toBeVisible();
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        expect(requested()).toEqual([`${API_BASE}/website-preview`, `${API_BASE}/text`]);
    });
});

describe("MindmapDocumentViewer on a public link", () => {
    it("reads the published map from the link, not the workspace's map route", async () => {
        respond({});
        onPublicLink(
            <MindmapDocumentViewer
                document={publicDoc({
                    title: "Roadmap",
                    ocrMetadata: { kind: "mindmap", mindmapId: 44 },
                })}
            />
        );
        await waitFor(() => expect(requested()).toContain(`${API_BASE}/mindmap`));
        expect(requested().some(url => url.startsWith("/api/mindmaps"))).toBe(false);
    });
});

describe("ConversationViewer on a public link", () => {
    const SESSION = "# Session\n\n## User\n\nHello\n\n## Assistant\n\nHi there";

    it("offers no way to continue the conversation in a workspace", async () => {
        respond({ [CONTENT]: { text: SESSION } });
        onPublicLink(
            <ConversationViewer
                document={publicDoc({
                    title: "session.md",
                    mimeType: "text/markdown",
                    ocrMetadata: { connector: "claude-code" },
                })}
            />
        );
        await screen.findByRole("heading", { level: 1 });
        expect(requested()).toEqual([CONTENT]);
        expect(screen.queryByRole("button", { name: /Continue this conversation/ })).toBeNull();
    });

    it("still offers it in the workspace", async () => {
        respond({ "/api/files/5": { text: SESSION } });
        render(
            <ConversationViewer
                document={publicDoc({
                    id: 5,
                    title: "session.md",
                    url: "/api/files/5",
                    mimeType: "text/markdown",
                    ocrMetadata: { connector: "claude-code" },
                })}
            />
        );
        await screen.findByRole("heading", { level: 1 });
        expect(screen.getByRole("button", { name: /Continue this conversation/ })).toBeVisible();
    });
});
