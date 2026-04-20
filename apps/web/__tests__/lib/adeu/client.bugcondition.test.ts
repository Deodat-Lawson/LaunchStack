/**
 * Bug Condition Exploration Tests — ADEU TypeScript Client
 *
 * Property 1: Expected Behavior — ADEU Review Fixes
 * Tests in this file verify bugs 1.9, 1.13, 1.14 are FIXED.
 * They PASS on fixed code, confirming each bug has been resolved.
 */

import {
    readDocx,
    processDocumentBatch,
    acceptAllChanges,
    applyEditsAsMarkdown,
    diffDocxFiles,
} from "~/lib/adeu/client";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADEU_SERVICE_URL = "http://localhost:8000";
    process.env.SIDECAR_API_KEY = "test-api-key";
});

afterEach(() => {
    delete process.env.ADEU_SERVICE_URL;
    delete process.env.SIDECAR_API_KEY;
});

function makeDocxBuffer(): Buffer {
    return Buffer.from("PK\x03\x04fake-docx-content");
}

function blobResponse(
    content: string,
    status = 200,
    headers?: Record<string, string>,
): Response {
    return new Response(content, {
        status,
        headers: {
            "content-type":
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ...headers,
        },
    });
}

function jsonResponse(
    body: object,
    status = 200,
    headers?: Record<string, string>,
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

// ===========================================================================
// Fix 1.9 — Authentication: client sends X-API-Key header
// ===========================================================================
describe("Fix 1.9: Authentication — client sends X-API-Key header to sidecar", () => {
    it("readDocx sends X-API-Key header to sidecar", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ text: "hello", filename: "doc.docx" }),
        );

        await readDocx(makeDocxBuffer());

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        // FIX: X-API-Key header is sent for authentication.
        const headers = opts.headers as Record<string, string> | undefined;
        const hasApiKey =
            headers?.["X-API-Key"] !== undefined ||
            headers?.["x-api-key"] !== undefined;
        expect(hasApiKey).toBe(true);
    });

    it("processDocumentBatch sends X-API-Key header", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("modified-docx"));

        await processDocumentBatch(makeDocxBuffer(), {
            author_name: "Author",
            edits: [{ target_text: "a", new_text: "b" }],
        });

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        const headers = opts.headers as Record<string, string> | undefined;
        const hasApiKey =
            headers?.["X-API-Key"] !== undefined ||
            headers?.["x-api-key"] !== undefined;
        expect(hasApiKey).toBe(true);
    });

    it("acceptAllChanges sends X-API-Key header", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("clean-docx"));

        await acceptAllChanges(makeDocxBuffer());

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        const headers = opts.headers as Record<string, string> | undefined;
        const hasApiKey =
            headers?.["X-API-Key"] !== undefined ||
            headers?.["x-api-key"] !== undefined;
        expect(hasApiKey).toBe(true);
    });

    it("applyEditsAsMarkdown sends X-API-Key header", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: "text" }));

        await applyEditsAsMarkdown(makeDocxBuffer(), {
            edits: [{ target_text: "a", new_text: "b" }],
        });

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        const headers = opts.headers as Record<string, string> | undefined;
        const hasApiKey =
            headers?.["X-API-Key"] !== undefined ||
            headers?.["x-api-key"] !== undefined;
        expect(hasApiKey).toBe(true);
    });

    it("diffDocxFiles sends X-API-Key header", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ diff: "", has_differences: false }),
        );

        await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        const headers = opts.headers as Record<string, string> | undefined;
        const hasApiKey =
            headers?.["X-API-Key"] !== undefined ||
            headers?.["x-api-key"] !== undefined;
        expect(hasApiKey).toBe(true);
    });
});

// ===========================================================================
// Fix 1.13 — Graceful JSON.parse: malformed x-batch-summary handled safely
// ===========================================================================
describe("Fix 1.13: Graceful JSON.parse — malformed x-batch-summary handled without crash", () => {
    it("processDocumentBatch does NOT throw on malformed x-batch-summary", async () => {
        // Return a valid DOCX response but with a malformed JSON header
        mockFetch.mockResolvedValueOnce(
            blobResponse("modified-docx-bytes", 200, {
                "x-batch-summary": "{broken json",
            }),
        );

        // FIX: JSON.parse error is caught gracefully; no crash.
        await expect(
            processDocumentBatch(makeDocxBuffer(), {
                author_name: "Author",
                edits: [{ target_text: "a", new_text: "b" }],
            }),
        ).resolves.toBeDefined();
    });

    it("processDocumentBatch returns default summary on malformed x-batch-summary", async () => {
        mockFetch.mockResolvedValueOnce(
            blobResponse("modified-docx-bytes", 200, {
                "x-batch-summary": "not-json-at-all",
            }),
        );

        // FIX: Falls back to default summary instead of crashing
        const result = await processDocumentBatch(makeDocxBuffer(), {
            author_name: "Author",
            edits: [{ target_text: "a", new_text: "b" }],
        });
        expect(result).toBeDefined();
        expect(result.summary).toBeDefined();
    });
});

// ===========================================================================
// Fix 1.14 — Fetch timeout: AbortController signal is present
// ===========================================================================
describe("Fix 1.14: Fetch timeout — client uses AbortController signal", () => {
    it("readDocx fetch call has a signal (AbortController)", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ text: "hello", filename: "doc.docx" }),
        );

        await readDocx(makeDocxBuffer());

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        // FIX: An AbortController signal is passed to fetch so hung requests abort.
        expect(opts.signal).toBeDefined();
    });

    it("processDocumentBatch fetch call has a signal (AbortController)", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("modified"));

        await processDocumentBatch(makeDocxBuffer(), {
            author_name: "Author",
            edits: [{ target_text: "a", new_text: "b" }],
        });

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(opts.signal).toBeDefined();
    });

    it("acceptAllChanges fetch call has a signal (AbortController)", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("clean"));

        await acceptAllChanges(makeDocxBuffer());

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(opts.signal).toBeDefined();
    });

    it("applyEditsAsMarkdown fetch call has a signal (AbortController)", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: "text" }));

        await applyEditsAsMarkdown(makeDocxBuffer(), {
            edits: [{ target_text: "a", new_text: "b" }],
        });

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(opts.signal).toBeDefined();
    });

    it("diffDocxFiles fetch call has a signal (AbortController)", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ diff: "", has_differences: false }),
        );

        await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

        const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(opts.signal).toBeDefined();
    });
});
