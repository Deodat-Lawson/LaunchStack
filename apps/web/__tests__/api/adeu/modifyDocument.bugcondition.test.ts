/**
 * Behavioral regressions for DOCX modification storage and failure provenance.
 */

import { eq } from "drizzle-orm";
import { company, document } from "@launchstack/store/schema";
import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";
import type { FounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

// ---------------------------------------------------------------------------
// We import the real modifyDocument to inspect its config/structure.
// Mocks are only needed for tests that actually execute the handler.
// ---------------------------------------------------------------------------

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

jest.mock("@launchstack/editing", () => ({
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
import { AdeuServiceError, processDocumentBatch } from "@launchstack/editing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStep(): { run: jest.Mock } {
    return {
        run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => {
            return await fn();
        }),
    };
}

// ===========================================================================
// Fix 1.1 — Step output uses blob storage, NOT full base64
// ===========================================================================
describe("Fix 1.1: Step output uses blob storage — large DOCX stored as blob URL", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("step.run('modify-document') returns blobUrl, not fileBase64", async () => {
        // Create a ~3 MB buffer. Base64 encoding inflates by ~33%, so 3 MB → ~4 MB base64.
        const largeFakeDocx = Buffer.alloc(3 * 1024 * 1024, 0x41); // 3 MB of 'A'

        (fetchBlob as jest.Mock).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () =>
                Promise.resolve(
                    largeFakeDocx.buffer.slice(
                        largeFakeDocx.byteOffset,
                        largeFakeDocx.byteOffset + largeFakeDocx.byteLength
                    )
                ),
        });

        const modifiedBlob = new Blob([largeFakeDocx]);
        (processDocumentBatch as jest.Mock).mockResolvedValueOnce({
            summary: {
                applied_edits: 1,
                skipped_edits: 0,
                applied_actions: 0,
                skipped_actions: 0,
            },
            file: modifiedBlob,
        });

        (putFile as jest.Mock).mockResolvedValueOnce({
            url: "https://blob.store/modified.docx",
            pathname: "modified.docx",
        });

        const mockWhere = jest.fn().mockResolvedValue([]);
        const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        // Capture what step.run("modify-document") returns
        const stepOutputs: Record<string, unknown> = {};
        const step = {
            run: jest.fn(async (name: string, fn: () => Promise<unknown>) => {
                const result = await fn();
                stepOutputs[name] = result;
                return result;
            }),
        };

        const handler = (
            modifyDocument as unknown as {
                fn: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;
            }
        ).fn;
        expect(handler).toBeDefined();

        await handler({
            event: {
                data: {
                    documentId: 1,
                    documentUrl: "https://blob.store/original.docx",
                    authorName: "Test",
                    edits: [{ target_text: "old", new_text: "new" }],
                },
            },
            step,
        });

        // FIX: The "modify-document" step should return a blobUrl, NOT fileBase64.
        // This keeps step output well under the 4 MB Inngest limit.
        const modifyResult = stepOutputs["modify-document"] as Record<string, unknown>;
        expect(modifyResult).toBeDefined();
        // Should have blobUrl, not fileBase64
        expect(modifyResult.blobUrl).toBeDefined();
        expect(modifyResult.fileBase64).toBeUndefined();

        // The output size should be tiny (just a URL string)
        const outputSize = JSON.stringify(modifyResult).length;
        expect(outputSize).toBeLessThan(4 * 1024 * 1024);
    });
});

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("modification failure metadata (Postgres integration)", () => {
    jest.setTimeout(120_000);

    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        const [co] = await test.db
            .insert(company)
            .values({ name: "Editing failure fixture", numberOfEmployees: "1" })
            .returning({ id: company.id });
        companyId = BigInt(co!.id);
    });

    afterAll(async () => {
        await test?.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (db.update as jest.Mock).mockImplementation((table: typeof document) =>
            test.db.update(table)
        );
    });

    describe.each(["terminal", "validation"] as const)("%s failure", failurePath => {
        it.each([
            {
                name: "Call Note",
                metadata: { callNote: { callId: "failed-edit" }, totalPages: 3 },
            },
            { name: "ordinary", metadata: null },
        ])("records an error without losing $name provenance", async ({ metadata }) => {
            const [original] = await test.db
                .insert(document)
                .values({
                    companyId,
                    title: "Failed edit",
                    category: "Calls",
                    url: "local://failed-edit.docx",
                    ocrMetadata: metadata,
                })
                .returning({ id: document.id });
            const documentId = original!.id;
            const errorMessage = "Edit target not found";

            if (failurePath === "terminal") {
                // Inngest exposes the registered callback through its function options.
                const fn = modifyDocument as unknown as {
                    opts: {
                        onFailure: (args: { event: unknown; error: Error }) => Promise<void>;
                    };
                };
                await fn.opts.onFailure({
                    event: { data: { event: { data: { documentId } } } },
                    error: new Error(errorMessage),
                });
            } else {
                (fetchBlob as jest.Mock).mockResolvedValueOnce({
                    ok: true,
                    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
                });
                (processDocumentBatch as jest.Mock).mockRejectedValueOnce(
                    new AdeuServiceError(422, errorMessage)
                );
                // Invoke the registered handler without starting an Inngest worker.
                const callable = modifyDocument as unknown as {
                    fn: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;
                };
                const result = await callable.fn({
                    event: {
                        data: {
                            documentId,
                            documentUrl: "local://failed-edit.docx",
                            authorName: "Reviewer",
                            edits: [{ target_text: "missing", new_text: "replacement" }],
                        },
                    },
                    step: createMockStep(),
                });
                expect(result).toEqual({ success: false, error: errorMessage });
            }

            const [failed] = await test.db
                .select()
                .from(document)
                .where(eq(document.id, documentId));
            expect(failed!.url).toBe("local://failed-edit.docx");
            expect(failed!.ocrMetadata).toEqual({
                ...metadata,
                error: "editing_failed",
                errorMessage,
                failedAt: expect.any(String),
            });
            expect(putFile).not.toHaveBeenCalled();
        });
    });
});
