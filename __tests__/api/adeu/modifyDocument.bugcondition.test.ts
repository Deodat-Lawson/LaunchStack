/**
 * Bug Condition Exploration Tests — modifyDocument (Inngest function)
 *
 * Property 1: Expected Behavior — ADEU Review Fixes
 * These tests verify the 22 bug conditions identified in the code review are FIXED.
 * They PASS on fixed code, confirming each bug has been resolved.
 *
 * Tests in this file cover bugs: 1.1, 1.2, 1.4, 1.15, 1.19, 1.20
 */

import * as fs from "fs";
import * as path from "path";

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
                        largeFakeDocx.byteOffset + largeFakeDocx.byteLength,
                    ),
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

        const handler = (modifyDocument as unknown as { fn: Function }).fn;
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

// ===========================================================================
// Fix 1.2 — Per-document concurrency key is present
// ===========================================================================
describe("Fix 1.2: Per-document concurrency — concurrency config has key field", () => {
    it("concurrency config has a 'key' field scoped to documentId", () => {
        const fn = modifyDocument as unknown as {
            opts?: { concurrency?: Array<{ limit: number; key?: string }> };
        };
        const concurrency = fn.opts?.concurrency;
        expect(concurrency).toBeDefined();
        expect(concurrency).toHaveLength(1);

        // FIX: The key field is present, scoping concurrency per document.
        const config = concurrency![0]!;
        expect(config.limit).toBe(1);
        expect(config.key).toBeDefined();
        expect(config.key).toContain("documentId");
    });
});

// ===========================================================================
// Fix 1.4 — onFailure sets error metadata on document record
// ===========================================================================
describe("Fix 1.4: Failure status — onFailure sets error metadata on document", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("onFailure handler sets ocrMetadata with error info", async () => {
        const fn = modifyDocument as unknown as {
            opts?: {
                onFailure?: (args: { event: unknown; error: Error }) => Promise<void>;
            };
        };

        expect(fn.opts?.onFailure).toBeDefined();

        const capturedSets: Record<string, unknown>[] = [];
        const mockWhere = jest.fn().mockResolvedValue([]);
        const mockSet = jest.fn().mockImplementation((setArg: Record<string, unknown>) => {
            capturedSets.push(setArg);
            return { where: mockWhere };
        });
        (db.update as jest.Mock).mockReturnValue({ set: mockSet });

        // Simulate onFailure being called
        await fn.opts!.onFailure!({
            event: { data: { event: { data: { documentId: 42 } } } },
            error: new Error("All retries exhausted"),
        });

        expect(db.update).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalled();

        // FIX: The set() call should include error metadata (ocrMetadata).
        const setArg = capturedSets[0]!;
        expect(setArg).toBeDefined();
        expect(setArg.updatedAt).toBeDefined();
        // Confirm the fix: error metadata IS set
        expect(setArg).toHaveProperty("ocrMetadata");
        const meta = setArg.ocrMetadata as Record<string, unknown>;
        expect(meta.error).toBe("editing_failed");
        expect(meta.errorMessage).toBeDefined();
        expect(meta.failedAt).toBeDefined();
    });

    it("422 validation errors are recorded with error metadata in a separate step", async () => {
        // Read the source file and verify the 422 path sets error metadata
        const sourceFile = fs.readFileSync(
            path.resolve(__dirname, "../../../src/server/inngest/functions/modifyDocument.ts"),
            "utf-8",
        );

        // FIX: The 422 path should result in a step that writes error metadata.
        // The source should contain a step that handles validation failures with ocrMetadata.
        expect(sourceFile).toMatch(/record-validation-failure|validationError/);
        expect(sourceFile).toMatch(/ocrMetadata/);
        expect(sourceFile).toMatch(/editing_failed/);
    });
});

// ===========================================================================
// Fix 1.15 — DB update is in its own step.run, separate from blob storage
// ===========================================================================
describe("Fix 1.15: Idempotent replay — db.update is in a separate step.run", () => {
    it("db.update() is in its own dedicated step.run, not inside the modify-document step", () => {
        const sourceFile = fs.readFileSync(
            path.resolve(__dirname, "../../../src/server/inngest/functions/modifyDocument.ts"),
            "utf-8",
        );

        // FIX: There should be a dedicated step for the DB update.
        // The step name should be "update-document-record" or similar.
        const hasUpdateStep =
            sourceFile.includes('step.run("update-document-record"') ||
            sourceFile.includes("step.run('update-document-record'");
        expect(hasUpdateStep).toBe(true);

        // FIX: The modify-document step should NOT contain db.update.
        const modifyStepStart = sourceFile.indexOf('step.run("modify-document"');
        expect(modifyStepStart).toBeGreaterThan(-1);

        // Find the closing of the modify-document step by looking for the next step.run
        const afterModifyStep = sourceFile.slice(modifyStepStart);
        const nextStepStart = afterModifyStep.indexOf('step.run(', 10); // skip the current one
        const modifyStepChunk = nextStepStart > -1
            ? afterModifyStep.slice(0, nextStepStart)
            : afterModifyStep.slice(0, 1200);

        // The modify-document step should NOT have db.update (it's in its own step)
        expect(modifyStepChunk).not.toMatch(/db\s*\.\s*update\s*\(/);
    });

    it("update-document-record step contains the db.update call", () => {
        const sourceFile = fs.readFileSync(
            path.resolve(__dirname, "../../../src/server/inngest/functions/modifyDocument.ts"),
            "utf-8",
        );

        // FIX: The dedicated update step should contain db.update
        const updateStepStart = sourceFile.indexOf('step.run("update-document-record"');
        expect(updateStepStart).toBeGreaterThan(-1);

        const updateStepChunk = sourceFile.slice(updateStepStart, updateStepStart + 400);
        expect(updateStepChunk).toMatch(/db\s*\.\s*update\s*\(/);
    });
});

// ===========================================================================
// Fix 1.19 — Handler lookup uses explicit assertion, not if(handler) guard
// ===========================================================================
describe("Fix 1.19: Explicit handler assertion — no silent skip on handler lookup failure", () => {
    it("test file uses expect(handler).toBeDefined() instead of if(handler) guard", () => {
        const testFile = fs.readFileSync(
            path.resolve(__dirname, "modifyDocument.test.ts"),
            "utf-8",
        );

        // FIX: The test should use expect(handler).toBeDefined() so it fails
        // explicitly when the handler lookup fails, instead of silently skipping.
        expect(testFile).toContain("expect(handler).toBeDefined()");

        // Confirm the old if(handler) guard pattern is gone
        const handlerGuardPattern = /const\s+handler\s*=.*\.fn;?\s*\n\s*if\s*\(\s*handler\s*\)/;
        expect(testFile).not.toMatch(handlerGuardPattern);
    });
});

// ===========================================================================
// Fix 1.20 — Route registration test has meaningful assertion
// ===========================================================================
describe("Fix 1.20: Meaningful route registration test — no tautological assertion", () => {
    it("route registration test does NOT use expect(true).toBe(true)", () => {
        const testFile = fs.readFileSync(
            path.resolve(__dirname, "modifyDocument.test.ts"),
            "utf-8",
        );

        // FIX: The tautological assertion should be replaced with a real check.
        expect(testFile).not.toContain("expect(true).toBe(true)");
    });

    it("route registration test makes a meaningful assertion about modifyDocument", () => {
        const testFile = fs.readFileSync(
            path.resolve(__dirname, "modifyDocument.test.ts"),
            "utf-8",
        );

        // FIX: The test should assert something meaningful about the actual import.
        expect(testFile).toMatch(/expect\(.*modifyDocument.*\)\.toBeDefined\(\)|expect\(.*opts.*id.*\)\.toBe\("modify-document"\)/);
    });
});
