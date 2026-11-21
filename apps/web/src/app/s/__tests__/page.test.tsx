/** @jest-environment node */

import { renderToStaticMarkup } from "react-dom/server";

import type { PublicDocument, PublicDocumentText } from "~/server/public-share/document";

import PublicFilePage, { generateMetadata } from "../[token]/page";

/**
 * /s/<token> as the server renders it, before any script runs: a live link's
 * page carries the file's words in its HTML (what an AI agent fetching the
 * address reads), a dead one is a 404 that says nothing about the token, and
 * neither leaks into search engines or Referer headers.
 */

// The app router's React has `cache`; the React jest runs does not.
jest.mock("react", () => {
    const actual = jest.requireActual<Record<string, unknown>>("react");
    return { ...actual, cache: <T,>(fn: T) => fn };
});

const mockResolvePublicLink = jest.fn();
jest.mock("~/server/workspace/public-links", () => ({
    resolvePublicLink: (token: string) => mockResolvePublicLink(token) as unknown,
}));

const mockLoadPublicDocumentRow = jest.fn();
const mockToPublicDocument = jest.fn();
const mockPublicDocumentText = jest.fn();
jest.mock("~/server/public-share/document", () => ({
    loadPublicDocumentRow: (...args: unknown[]) => mockLoadPublicDocumentRow(...args) as unknown,
    toPublicDocument: (...args: unknown[]) => mockToPublicDocument(...args) as unknown,
    publicDocumentText: (...args: unknown[]) => mockPublicDocumentText(...args) as unknown,
}));

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const API_BASE = `/api/s/${TOKEN}`;
const SENTENCE = "The billing migration ships before the October board meeting.";

function publicDocument(overrides: Partial<PublicDocument> = {}): PublicDocument {
    return {
        title: "Q3 plan.pdf",
        displayType: "pdf",
        mimeType: "application/pdf",
        ocrMetadata: null,
        workspaceName: "Acme",
        updatedAt: "2026-11-02T12:00:00.000Z",
        expiresAt: null,
        allowDownload: true,
        contentUrl: `${API_BASE}/content`,
        downloadUrl: `${API_BASE}/content?download=1`,
        markdownUrl: `/s/${TOKEN}.md`,
        apiBase: API_BASE,
        ...overrides,
    };
}

const TEXT: PublicDocumentText = {
    markdown: `# Q3 plan\n\n${SENTENCE}`,
    available: true,
    truncated: false,
};

function live(doc: PublicDocument, text: PublicDocumentText = TEXT) {
    mockResolvePublicLink.mockResolvedValue({ token: TOKEN, companyId: 1n, documentId: 7 });
    mockLoadPublicDocumentRow.mockResolvedValue({ title: doc.title });
    mockToPublicDocument.mockResolvedValue(doc);
    mockPublicDocumentText.mockResolvedValue(text);
}

const params = Promise.resolve({ token: TOKEN });

async function html(): Promise<string> {
    return renderToStaticMarkup(await PublicFilePage({ params }));
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("a live link", () => {
    it("serves the file's text in the HTML, below the viewer", async () => {
        live(publicDocument());
        const page = await html();

        expect(page).toContain(SENTENCE);
        expect(page).toContain("Text version");
        // The viewer is drawn in the browser (see PublicFileViewer); the
        // server's HTML carries the words and never an internal URL.
        expect(page).not.toContain("/api/files/");
        expect(page).not.toContain("/api/documents/");
        expect(page).toContain(`href="/s/${TOKEN}.md"`);
        expect(page).toContain(`href="${API_BASE}/content?download=1"`);
    });

    it("shows a presentation as its text, never through Office Online", async () => {
        live(
            publicDocument({
                title: "Deck.pptx",
                displayType: "pptx",
                mimeType:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            })
        );
        const page = await html();

        expect(page).toContain(SENTENCE);
        expect(page).toContain("Presentations can&#x27;t be previewed here");
        expect(page).not.toContain("officeapps");
        expect(page).not.toContain("<iframe");
    });

    it("shows a CSV as a table, its text version keeping its rows", async () => {
        live(
            publicDocument({
                title: "pipeline.csv",
                displayType: "text",
                mimeType: "text/csv",
            }),
            { markdown: "owner,task\nAna,Tax provider\n", available: true, truncated: false }
        );
        const page = await html();

        expect(page).toContain(">Spreadsheet<");
        expect(page).not.toContain("<iframe");
        expect(page).toContain('<code class="language-csv">owner,task\nAna,Tax provider\n</code>');
    });

    it("offers no download when the link has downloads off", async () => {
        live(publicDocument({ allowDownload: false, downloadUrl: null }));
        const page = await html();

        expect(page).not.toContain("download=1");
        expect(page).not.toContain(">Download<");
    });

    it("is titled by the file, unindexed, sends no Referer, and names its Markdown", async () => {
        live(publicDocument());
        const meta = await generateMetadata({ params });

        expect(meta.title).toEqual({ absolute: "Q3 plan.pdf" });
        expect(meta.robots).toEqual({ index: false, follow: false });
        expect(meta.referrer).toBe("no-referrer");
        expect(meta.alternates?.types).toEqual({ "text/markdown": `/s/${TOKEN}.md` });
    });
});

describe("a dead link", () => {
    it("is a 404", async () => {
        mockResolvePublicLink.mockResolvedValue(null);
        await expect(PublicFilePage({ params })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
        expect(mockPublicDocumentText).not.toHaveBeenCalled();
    });

    it("is a 404 when the file went away after the link resolved", async () => {
        mockResolvePublicLink.mockResolvedValue({ token: TOKEN, companyId: 1n, documentId: 7 });
        mockLoadPublicDocumentRow.mockResolvedValue(null);
        await expect(PublicFilePage({ params })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    it("has generic, unindexed metadata", async () => {
        mockResolvePublicLink.mockResolvedValue(null);
        const meta = await generateMetadata({ params });

        expect(meta.title).toEqual({ absolute: "Link not available" });
        expect(meta.robots).toEqual({ index: false, follow: false });
        expect(meta.referrer).toBe("no-referrer");
        expect(meta.alternates).toBeUndefined();
    });
});
