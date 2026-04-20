/**
 * Preservation Property Tests — modifyDocument (Inngest function)
 *
 * Property 2: Preservation — Normal ADEU Pipeline Behavior
 * Written BEFORE fixes. EXPECTED TO PASS on unfixed code (confirms baseline behavior).
 *
 * These tests verify that the existing happy-path behavior is preserved:
 * - Normal-sized DOCX files process through the full pipeline successfully
 * - Single-user document edits complete with correct result and updatedAt
 * - Step execution order is maintained (fetch → modify → store)
 * - Successful edits update the document record with url and updatedAt
 *
 * Requirements: 3.1, 3.2, 3.4
 */

jest.mock("~/server/db", () => ({
    db: {
        update: jest.fn(),
        select: jest.fn(),
    },
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    fetchBlob: jest.fn(),
    putFile: jest.fn(),
}));

jest.mock("~/lib/adeu/client", () => ({
    processDocumentBatch: jest.fn(),
    AdeuServiceError: class AdeuServiceError extends Error {
        statusCode: number;
        detail: string;
        constructor(statusCode: number, detail: string) {
            super(`Adeu service error (${statusCode}): ${detail}`);
            this.name = "AdeuServiceError";
            this.statusCode = statusCode;
            this.detail = detail;
        }
    },
}));

import { modifyDocument } from "~/server/inngest/functions/modifyDocument";
import { db } from "~/server/db";
import { fetchBlob, putFile } from "~/server/storage/vercel-blob";
import { processDocumentBatch } from "~/lib/adeu/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStep(): {
    run: jest.Mock;
    stepOutputs: Record<string, unknown>;
    stepOrder: string[];
} {
    const stepOutputs: Record<string, unknown> = {};
    const stepOrder: string[] = [];
    return {
        stepOutputs,
        stepOrder,
        run: jest.fn(async (name: string, fn: () => Promise<unknown>) => {
            stepOrder.push(name);
            const result = await fn();
            stepOutputs[name] = result;
            return result;
        }),
    };
}

function makeSmallDocxBuffer(): Buffer {
    // ~500 KB — well under the 1 MB threshold and 4 MB step limit
    return Buffer.from("PK\x03\x04" + "A".repeat(500 * 1024));
}

function setupSuccessfulPipeline(docBuffer: Buffer) {
    // Step 1: fetchBlob returns the document
    (fetchBlob as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () =>
            Promise.resolve(
                docBuffer.buffer.slice(
                    docBuffer.byteOffset,
                    docBuffer.byteOffset + docBuffer.byteLength,
                ),
            ),
    });

    // Step 2: processDocumentBatch returns modified file + summary
    const summary = {
        applied_edits: 1,
        skipped_edits: 0,
        applied_actions: 0,
        skipped_actions: 0,
    };
    const modifiedBlob = new Blob([Buffer.from("modified-docx-content")]);
    (processDocumentBatch as jest.Mock).mockResolvedValueOnce({
        summary,
        file: modifiedBlob,
    });

    // Step 3: putFile stores the modified DOCX
    (putFile as jest.Mock).mockResolvedValueOnce({
        url: "https://blob.store/documents/modified-42.docx",
        pathname: "documents/modified-42.docx",
    });

    // DB update succeeds
    const mockWhere = jest.fn().mockResolvedValue([]);
    const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
    (db.update as jest.Mock).mockReturnValue({ set: mockSet });

    return { summary, mockSet, mockWhere };
}

// ===========================================================================
// Preservation: Normal-sized DOCX processes through full pipeline
// ===========================================================================
describe("Preservation: Normal-sized DOCX (< 1 MB) processes through modifyDocument successfully", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("completes all three steps in order: fetch → modify → store", async () => {
        const docBuffer = makeSmallDocxBuffer();
        setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        await handler({
            event: {
                data: {
                    documentId: 42,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test Author",
                    edits: [{ target_text: "old", new_text: "new" }],
                },
            },
            step,
        });

        // Preservation: steps execute in the correct order
        // Note: "store-result" was renamed to "update-document-record" (Fix 1.15)
        // to reflect that the DB write is now in its own dedicated step
        expect(step.stepOrder).toEqual([
            "fetch-document",
            "modify-document",
            "update-document-record",
        ]);
    });

    it("returns success with documentId, url, and summary", async () => {
        const docBuffer = makeSmallDocxBuffer();
        const { summary } = setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        const result = await handler({
            event: {
                data: {
                    documentId: 42,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test Author",
                    edits: [{ target_text: "old", new_text: "new" }],
                },
            },
            step,
        });

        // Preservation: successful result shape
        expect(result).toEqual({
            success: true,
            documentId: 42,
            url: "https://blob.store/documents/modified-42.docx",
            summary,
        });
    });

    it("fetches document from the provided blob URL", async () => {
        const docBuffer = makeSmallDocxBuffer();
        setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        await handler({
            event: {
                data: {
                    documentId: 42,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test Author",
                    edits: [{ target_text: "old", new_text: "new" }],
                },
            },
            step,
        });

        // Preservation: fetchBlob called with the correct URL
        expect(fetchBlob).toHaveBeenCalledWith("https://blob.store/original.docx");
    });

    it("passes author name and edits to processDocumentBatch", async () => {
        const docBuffer = makeSmallDocxBuffer();
        setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        const edits = [
            { target_text: "old text", new_text: "new text", comment: "fix" },
        ];

        await handler({
            event: {
                data: {
                    documentId: 42,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test Author",
                    edits,
                },
            },
            step,
        });

        // Preservation: processDocumentBatch receives correct params
        expect(processDocumentBatch).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({
                author_name: "Test Author",
                edits,
            }),
        );
    });

    it("stores modified DOCX via putFile and updates DB with url and updatedAt", async () => {
        const docBuffer = makeSmallDocxBuffer();
        const { mockSet } = setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        await handler({
            event: {
                data: {
                    documentId: 42,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test Author",
                    edits: [{ target_text: "old", new_text: "new" }],
                },
            },
            step,
        });

        // Preservation: putFile is called to store the modified DOCX
        expect(putFile).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: expect.stringContaining("modified-42"),
                contentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
        );

        // Preservation: DB is updated with url and updatedAt
        expect(db.update).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                url: "https://blob.store/documents/modified-42.docx",
                updatedAt: expect.any(Date),
            }),
        );
    });
});

// ===========================================================================
// Preservation: Single-user edit completes with correct result
// ===========================================================================
describe("Preservation: Single-user document edit completes correctly", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("processes edits-only batch (no actions) successfully", async () => {
        const docBuffer = makeSmallDocxBuffer();
        setupSuccessfulPipeline(docBuffer);

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        const result = await handler({
            event: {
                data: {
                    documentId: 10,
                    documentUrl: "https://blob.store/doc.docx",
                    authorName: "Author",
                    edits: [{ target_text: "a", new_text: "b" }],
                },
            },
            step,
        });

        expect(result.success).toBe(true);
        expect(result.documentId).toBe(10);
    });

    it("processes edits with actions successfully", async () => {
        const docBuffer = makeSmallDocxBuffer();

        (fetchBlob as jest.Mock).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () =>
                Promise.resolve(
                    docBuffer.buffer.slice(
                        docBuffer.byteOffset,
                        docBuffer.byteOffset + docBuffer.byteLength,
                    ),
                ),
        });

        const summary = {
            applied_edits: 1,
            skipped_edits: 0,
            applied_actions: 2,
            skipped_actions: 0,
        };
        (processDocumentBatch as jest.Mock).mockResolvedValueOnce({
            summary,
            file: new Blob([Buffer.from("modified")]),
        });

        (putFile as jest.Mock).mockResolvedValueOnce({
            url: "https://blob.store/modified.docx",
            pathname: "modified.docx",
        });

        const mockWhere = jest.fn().mockResolvedValue([]);
        const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        const result = await handler({
            event: {
                data: {
                    documentId: 20,
                    documentUrl: "https://blob.store/doc.docx",
                    authorName: "Author",
                    edits: [{ target_text: "x", new_text: "y" }],
                    actions: [
                        { action: "ACCEPT", target_id: "Chg:1" },
                        { action: "REJECT", target_id: "Chg:2" },
                    ],
                },
            },
            step,
        });

        expect(result.success).toBe(true);
        expect(result.summary).toEqual(summary);
    });

    it("returns validation error without throwing on 422", async () => {
        const docBuffer = makeSmallDocxBuffer();
        const { AdeuServiceError: MockAdeuServiceError } =
            jest.requireMock("~/lib/adeu/client");

        (fetchBlob as jest.Mock).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () =>
                Promise.resolve(
                    docBuffer.buffer.slice(
                        docBuffer.byteOffset,
                        docBuffer.byteOffset + docBuffer.byteLength,
                    ),
                ),
        });

        (processDocumentBatch as jest.Mock).mockRejectedValueOnce(
            new MockAdeuServiceError(422, "Edit target not found"),
        );

        const mockWhere = jest.fn().mockResolvedValue([]);
        const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        const result = await handler({
            event: {
                data: {
                    documentId: 30,
                    documentUrl: "https://blob.store/doc.docx",
                    authorName: "Author",
                    edits: [{ target_text: "nonexistent", new_text: "x" }],
                },
            },
            step,
        });

        // Preservation: 422 errors are caught and returned as validation errors
        expect(result).toEqual({
            success: false,
            error: "Edit target not found",
        });
    });

    it("throws on 500 to allow Inngest retry", async () => {
        const docBuffer = makeSmallDocxBuffer();
        const { AdeuServiceError: MockAdeuServiceError } =
            jest.requireMock("~/lib/adeu/client");

        (fetchBlob as jest.Mock).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () =>
                Promise.resolve(
                    docBuffer.buffer.slice(
                        docBuffer.byteOffset,
                        docBuffer.byteOffset + docBuffer.byteLength,
                    ),
                ),
        });

        (processDocumentBatch as jest.Mock).mockRejectedValueOnce(
            new MockAdeuServiceError(500, "Internal error"),
        );

        const step = createMockStep();
        const handler = (modifyDocument as unknown as { fn: Function }).fn;

        await expect(
            handler({
                event: {
                    data: {
                        documentId: 40,
                        documentUrl: "https://blob.store/doc.docx",
                        authorName: "Author",
                        edits: [{ target_text: "x", new_text: "y" }],
                    },
                },
                step,
            }),
        ).rejects.toThrow("Internal error");
    });
});
