/**
 * Preservation Property Tests — ADEU TypeScript Client
 *
 * Property 2: Preservation — Normal ADEU Pipeline Behavior
 * Written BEFORE fixes. EXPECTED TO PASS on unfixed code (confirms baseline behavior).
 *
 * These tests verify that the existing happy-path client behavior is preserved:
 * - All five adapter functions return expected typed results for valid inputs
 * - Valid x-batch-summary JSON headers parse correctly into BatchSummary
 * - Error handling for non-ok responses works correctly
 * - FormData is constructed correctly for all endpoints
 *
 * Requirements: 3.9
 */

import {
    readDocx,
    processDocumentBatch,
    acceptAllChanges,
    applyEditsAsMarkdown,
    diffDocxFiles,
    AdeuServiceError,
} from "~/lib/adeu/client";

import type { BatchSummary } from "~/lib/adeu/types";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADEU_SERVICE_URL = "http://localhost:8000";
});

afterEach(() => {
    delete process.env.ADEU_SERVICE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDocxBuffer(): Buffer {
    return Buffer.from("PK\x03\x04fake-docx-content");
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

// ===========================================================================
// Preservation: readDocx returns correct typed result
// ===========================================================================
describe("Preservation: readDocx returns expected ReadDocxResponse for valid input", () => {
    it("returns { text, filename } for a valid DOCX", async () => {
        const expected = { text: "Hello world", filename: "document.docx" };
        mockFetch.mockResolvedValueOnce(jsonResponse(expected));

        const result = await readDocx(makeDocxBuffer());

        expect(result).toEqual(expected);
        expect(typeof result.text).toBe("string");
        expect(typeof result.filename).toBe("string");
    });

    it("sends file as FormData with correct field name", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ text: "content", filename: "doc.docx" }),
        );

        await readDocx(makeDocxBuffer());

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe("http://localhost:8000/adeu/read");
        expect(opts.method).toBe("POST");
        expect(opts.body).toBeInstanceOf(FormData);
        expect((opts.body as FormData).get("file")).toBeTruthy();
    });

    it("preserves clean_view option in FormData", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ text: "clean", filename: "doc.docx" }),
        );

        await readDocx(makeDocxBuffer(), { cleanView: true });

        const formData: FormData = mockFetch.mock.calls[0][1].body;
        expect(formData.get("clean_view")).toBe("true");
    });
});

// ===========================================================================
// Preservation: processDocumentBatch returns summary + file blob
// ===========================================================================
describe("Preservation: processDocumentBatch returns { summary, file } for valid input", () => {
    const params = {
        author_name: "Test Author",
        edits: [{ target_text: "old", new_text: "new" }],
    };

    it("returns BatchSummary and Blob for a successful batch edit", async () => {
        const summary: BatchSummary = {
            applied_edits: 1,
            skipped_edits: 0,
            applied_actions: 0,
            skipped_actions: 0,
        };
        mockFetch.mockResolvedValueOnce(
            blobResponse("modified-docx-bytes", 200, {
                "x-batch-summary": JSON.stringify(summary),
            }),
        );

        const result = await processDocumentBatch(makeDocxBuffer(), params);

        expect(result.summary).toEqual(summary);
        expect(result.file).toBeInstanceOf(Blob);
    });

    it("returns default summary when x-batch-summary header is absent", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("modified-docx-bytes"));

        const result = await processDocumentBatch(makeDocxBuffer(), params);

        expect(result.summary).toEqual({
            applied_edits: 0,
            skipped_edits: 0,
            applied_actions: 0,
            skipped_actions: 0,
        });
    });

    it("sends file and JSON body as FormData fields", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("modified"));

        await processDocumentBatch(makeDocxBuffer(), params);

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe("http://localhost:8000/adeu/process-batch");
        const formData: FormData = opts.body;
        expect(formData.get("file")).toBeTruthy();
        expect(formData.get("body")).toBe(JSON.stringify(params));
    });
});

// ===========================================================================
// Preservation: Valid x-batch-summary JSON parses correctly
// ===========================================================================
describe("Preservation: Well-formed x-batch-summary JSON parses into correct BatchSummary", () => {
    const params = {
        author_name: "Author",
        edits: [{ target_text: "a", new_text: "b" }],
    };

    it("parses summary with all fields populated", async () => {
        const summary: BatchSummary = {
            applied_edits: 3,
            skipped_edits: 1,
            applied_actions: 2,
            skipped_actions: 0,
        };
        mockFetch.mockResolvedValueOnce(
            blobResponse("docx", 200, {
                "x-batch-summary": JSON.stringify(summary),
            }),
        );

        const result = await processDocumentBatch(makeDocxBuffer(), params);

        expect(result.summary.applied_edits).toBe(3);
        expect(result.summary.skipped_edits).toBe(1);
        expect(result.summary.applied_actions).toBe(2);
        expect(result.summary.skipped_actions).toBe(0);
    });

    it("parses summary with zero counts", async () => {
        const summary: BatchSummary = {
            applied_edits: 0,
            skipped_edits: 0,
            applied_actions: 0,
            skipped_actions: 0,
        };
        mockFetch.mockResolvedValueOnce(
            blobResponse("docx", 200, {
                "x-batch-summary": JSON.stringify(summary),
            }),
        );

        const result = await processDocumentBatch(makeDocxBuffer(), params);

        expect(result.summary).toEqual(summary);
    });

    it("parses summary with large counts", async () => {
        const summary: BatchSummary = {
            applied_edits: 100,
            skipped_edits: 50,
            applied_actions: 25,
            skipped_actions: 10,
        };
        mockFetch.mockResolvedValueOnce(
            blobResponse("docx", 200, {
                "x-batch-summary": JSON.stringify(summary),
            }),
        );

        const result = await processDocumentBatch(makeDocxBuffer(), params);

        expect(result.summary).toEqual(summary);
    });
});

// ===========================================================================
// Preservation: acceptAllChanges returns Blob
// ===========================================================================
describe("Preservation: acceptAllChanges returns Blob for valid input", () => {
    it("returns a Blob for a valid DOCX", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("clean-docx"));

        const result = await acceptAllChanges(makeDocxBuffer());

        expect(result).toBeInstanceOf(Blob);
    });

    it("sends POST to /adeu/accept-all with file FormData", async () => {
        mockFetch.mockResolvedValueOnce(blobResponse("clean-docx"));

        await acceptAllChanges(makeDocxBuffer());

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe("http://localhost:8000/adeu/accept-all");
        expect(opts.method).toBe("POST");
        expect((opts.body as FormData).get("file")).toBeTruthy();
    });
});

// ===========================================================================
// Preservation: applyEditsAsMarkdown returns markdown string
// ===========================================================================
describe("Preservation: applyEditsAsMarkdown returns ApplyEditsMarkdownResponse", () => {
    const params = {
        edits: [{ target_text: "old text", new_text: "new text" }],
        include_index: true,
    };

    it("returns { markdown } for valid edits", async () => {
        const expected = { markdown: "Some {--old--}{++new++} text" };
        mockFetch.mockResolvedValueOnce(jsonResponse(expected));

        const result = await applyEditsAsMarkdown(makeDocxBuffer(), params);

        expect(result).toEqual(expected);
        expect(typeof result.markdown).toBe("string");
    });

    it("sends edits and options in JSON body field", async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ markdown: "text" }));

        await applyEditsAsMarkdown(makeDocxBuffer(), params);

        const formData: FormData = mockFetch.mock.calls[0][1].body;
        const body = JSON.parse(formData.get("body") as string);
        expect(body.edits).toEqual(params.edits);
        expect(body.include_index).toBe(true);
    });
});

// ===========================================================================
// Preservation: diffDocxFiles returns diff result
// ===========================================================================
describe("Preservation: diffDocxFiles returns DiffResponse for valid inputs", () => {
    it("returns { diff, has_differences } for two files", async () => {
        const expected = { diff: "- old\n+ new", has_differences: true };
        mockFetch.mockResolvedValueOnce(jsonResponse(expected));

        const result = await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

        expect(result).toEqual(expected);
        expect(typeof result.diff).toBe("string");
        expect(typeof result.has_differences).toBe("boolean");
    });

    it("returns has_differences: false for identical documents", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ diff: "", has_differences: false }),
        );

        const result = await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

        expect(result.has_differences).toBe(false);
        expect(result.diff).toBe("");
    });

    it("sends both files as separate FormData fields", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ diff: "", has_differences: false }),
        );

        await diffDocxFiles(makeDocxBuffer(), makeDocxBuffer());

        const formData: FormData = mockFetch.mock.calls[0][1].body;
        expect(formData.get("original")).toBeTruthy();
        expect(formData.get("modified")).toBeTruthy();
    });
});

// ===========================================================================
// Preservation: Error handling for non-ok responses
// ===========================================================================
describe("Preservation: Error responses throw AdeuServiceError with correct fields", () => {
    it("throws AdeuServiceError with statusCode and detail on 422", async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ detail: "Invalid DOCX file" }, 422),
        );

        try {
            await readDocx(makeDocxBuffer());
            fail("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(AdeuServiceError);
            expect((e as AdeuServiceError).statusCode).toBe(422);
            expect((e as AdeuServiceError).detail).toBe("Invalid DOCX file");
        }
    });

    it("throws AdeuServiceError with statusCode 0 on network failure", async () => {
        mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

        try {
            await readDocx(makeDocxBuffer());
            fail("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(AdeuServiceError);
            expect((e as AdeuServiceError).statusCode).toBe(0);
            expect((e as AdeuServiceError).detail).toContain("ECONNREFUSED");
        }
    });
});
