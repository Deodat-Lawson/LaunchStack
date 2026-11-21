/**
 * The two places a public link could leak more than its file: the metadata a
 * viewer gets (`publicViewerMetadata`) and where bytes come from
 * (`openStoredBytes`, keyed on the document row, never on the caller).
 */

const mockFetchFile = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();
let mockS3 = false;
jest.mock("~/lib/storage", () => ({
    fetchFile: (url: string, init?: RequestInit) => mockFetchFile(url, init),
    isS3Storage: () => mockS3,
}));
jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: (url: string) => url.includes(".private.blob."),
}));
const mockSelect = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: () => ({ where: () => ({ limit: () => mockSelect() }) }),
        }),
    },
}));

import { openStoredBytes, storedBytesResponse } from "~/server/public-share/bytes";
import {
    PUBLIC_MINDMAP_ID,
    agentMarkdown,
    publicViewerMetadata,
} from "~/server/public-share/document";

describe("publicViewerMetadata", () => {
    it("keeps what picks a viewer and drops everything else", () => {
        expect(
            publicViewerMetadata({
                connector: "agent-sessions",
                clientName: "Claude Code",
                model: "claude-opus",
                sessionId: "s-123",
                projectPath: "/Users/someone/secret-project",
                gitBranch: "feature/acquisition",
                error: "boom",
                websitePreview: { url: "/api/files/9" },
                ocrRouting: { provider: "AZURE" },
            })
        ).toEqual({ connector: "agent-sessions", clientName: "Claude Code", model: "claude-opus" });
    });

    it("gives a saved web page its address, and nothing else its url", () => {
        expect(
            publicViewerMetadata({ kind: "website", url: "https://example.com/a", capturedAt: "x" })
        ).toEqual({ kind: "website", url: "https://example.com/a", capturedAt: "x" });
        expect(
            publicViewerMetadata({ kind: "artifact", url: "https://claude.ai/private" })
        ).toEqual({
            kind: "artifact",
        });
    });

    it("keeps an artifact's type and origin, not its source link", () => {
        expect(
            publicViewerMetadata({
                kind: "artifact",
                artifactType: "html",
                importedAt: "2026-11-01",
                sourceUrl: "https://claude.ai/artifact/private-id",
                addedFrom: { origin: "chatgpt", by: "auth_ada", client: "secret" },
            })
        ).toEqual({
            kind: "artifact",
            artifactType: "html",
            importedAt: "2026-11-01",
            addedFrom: { origin: "chatgpt" },
        });
    });

    it("keeps a mindmap's marker and a transcript's pairing", () => {
        // Never another row's id: the map and the recording are paired on the server.
        expect(publicViewerMetadata({ kind: "mindmap", mindmapId: 4, revision: 2 })).toEqual({
            kind: "mindmap",
            mindmapId: PUBLIC_MINDMAP_ID,
        });
        expect(
            publicViewerMetadata({
                source: "transcription",
                audioDocumentId: 12,
                language: "en",
                segments: [{ start: 0, end: 1, text: "hi" }],
            })
        ).toEqual({ source: "transcription", language: "en" });
        expect(publicViewerMetadata(null)).toBeNull();
        expect(publicViewerMetadata({ error: "only junk" })).toBeNull();
    });
});

describe("agentMarkdown", () => {
    const doc = { title: "Plan.pdf" } as Parameters<typeof agentMarkdown>[0];
    const words = {
        sharedFrom: "Shared from Acme.",
        noText: "No text yet.",
        truncated: "Cut here.",
    };

    it("is a title, where it is from, then the text", () => {
        expect(
            agentMarkdown(
                doc,
                { markdown: "Body text.\n", available: true, truncated: false },
                words
            )
        ).toBe("# Plan.pdf\n\n> Shared from Acme.\n\nBody text.\n");
    });

    it("says when there is no text, and when the text was cut", () => {
        expect(
            agentMarkdown(doc, { markdown: "", available: false, truncated: false }, words)
        ).toContain("No text yet.");
        expect(
            agentMarkdown(doc, { markdown: "Long…", available: true, truncated: true }, words)
        ).toContain("> Cut here.");
    });
});

describe("openStoredBytes", () => {
    const company = 7n;
    beforeEach(() => {
        mockFetchFile.mockReset();
        mockSelect.mockReset();
        mockS3 = false;
    });

    it("reads a database-held file only inside the link's workspace", async () => {
        mockSelect.mockResolvedValueOnce([]);
        expect((await openStoredBytes("/api/files/5", company)).kind).toBe("missing");
        mockSelect.mockResolvedValueOnce([
            {
                filename: "a.txt",
                mimeType: "text/plain",
                storageProvider: "database",
                storageUrl: null,
                fileData: Buffer.from("hello").toString("base64"),
            },
        ]);
        const opened = await openStoredBytes("/api/files/5", company);
        expect(opened).toMatchObject({ kind: "buffer", filename: "a.txt" });
        expect(opened.kind === "buffer" && opened.data.toString()).toBe("hello");
    });

    it("proxies object storage with the caller's Range, and never redirects to it", async () => {
        mockSelect.mockResolvedValueOnce([
            {
                filename: "talk.m4a",
                mimeType: "audio/mp4",
                storageProvider: "s3",
                storageUrl: "s3:companies/7/talk.m4a",
                fileData: null,
            },
        ]);
        mockFetchFile.mockResolvedValueOnce(
            new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/10" } })
        );
        const request = new Request("http://x/api/s/t/content", {
            headers: { range: "bytes=0-2" },
        });
        const res = await storedBytesResponse(request, {
            url: "/api/files/9",
            companyId: company,
            title: "talk.m4a",
            fallbackMimeType: "application/octet-stream",
            disposition: "inline",
            headers: { "Cache-Control": "private, no-store" },
        });
        expect(mockFetchFile).toHaveBeenCalledWith(
            "s3:companies/7/talk.m4a",
            expect.objectContaining({ headers: expect.anything() })
        );
        expect(res?.status).toBe(206);
        expect(res?.headers.get("location")).toBeNull();
        expect(res?.headers.get("cache-control")).toBe("private, no-store");
        expect(res?.headers.get("content-disposition")).toMatch(/^inline;/);
    });

    it("fetches an S3 document URL with server credentials", async () => {
        mockS3 = true;
        mockFetchFile.mockResolvedValueOnce(new Response("pdf", { status: 200 }));
        expect((await openStoredBytes("s3:companies/7/plan.pdf", company)).kind).toBe("upstream");
    });

    it("sends a browser to a public URL, and refuses anything that is not http(s)", async () => {
        expect(await openStoredBytes("https://cdn.example.com/a.png", company)).toEqual({
            kind: "redirect",
            location: "https://cdn.example.com/a.png",
        });
        expect((await openStoredBytes("javascript:alert(1)", company)).kind).toBe("missing");
        expect((await openStoredBytes("file:///etc/passwd", company)).kind).toBe("missing");
    });
});
