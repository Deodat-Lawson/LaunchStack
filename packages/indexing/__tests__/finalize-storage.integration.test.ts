/**
 * Integration pin for finalizeStorage's version guard (ported intent from
 * the retired web `processDocument` suite): the document-table update is
 * guarded on `document.currentVersionId = versionId`, so finalizing a
 * version that is NOT current must never flip `document.ocrProcessed` (or
 * any other document-level OCR field) for the current version. The
 * per-version row and the job row are always stamped.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import { document, documentMetadata, documentVersions, ocrJobs } from "@launchstack/store/schema";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
} from "@launchstack/orchestration";
import { finalizeStorage } from "@launchstack/conversion/ocr/processor";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * Wraps a query-builder chain so `before` runs just ahead of the statement it
 * ends in: another request's write landing between finalizeStorage's read of
 * the row and its update.
 */
function runningFirst<T extends object>(builder: T, before: () => Promise<unknown>): T {
    return new Proxy(builder, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target) as unknown;
            if (prop === "then") {
                return (
                    onFulfilled?: (value: unknown) => unknown,
                    onRejected?: (reason: unknown) => unknown
                ) =>
                    before().then(() =>
                        (target as unknown as PromiseLike<unknown>).then(onFulfilled, onRejected)
                    );
            }
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                const next = (value as (...a: unknown[]) => unknown).apply(target, args);
                return next && typeof next === "object" ? runningFirst(next, before) : next;
            };
        },
    });
}

describe.skipIf(!url)("finalizeStorage version guard (integration)", () => {
    let handle: Db;
    let companyId: bigint;
    let documentId: number;
    let v1: { versionId: number; jobId: string };
    let v2: { versionId: number; jobId: string };

    const meta = {
        totalPages: 1,
        provider: "NATIVE_PDF",
        processingTimeMs: 10,
        confidenceScore: 0.99,
    };

    beforeAll(async () => {
        handle = createDb({ url: url! });
        configureDatabase(handle.db);
        const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('finalize-guard-test-co', '1') RETURNING id
    `;
        companyId = BigInt(rows[0]!.id as number);

        const created = await createDocumentLifecycle({
            companyId,
            userId: "user_test",
            title: "guarded.pdf",
            category: "General",
            url: "/api/files/finalize-guard",
            creationKey: "upload:/api/files/finalize-guard",
            mimeType: "application/pdf",
            processing: { originalFilename: "guarded.pdf" },
        });
        documentId = created.documentId;
        v1 = { versionId: created.versionId, jobId: created.jobId! };

        const superseded = await createDocumentVersionLifecycle({
            documentId,
            companyId,
            userId: "user_test",
            title: "guarded.pdf",
            category: "General",
            url: "/api/files/finalize-guard-v2",
            creationKey: "upload:/api/files/finalize-guard-v2",
            mimeType: "application/pdf",
        });
        v2 = { versionId: superseded.versionId, jobId: superseded.jobId };
    });

    afterAll(async () => {
        if (!handle) return;
        await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}`;
        await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${String(companyId)}`;
        await handle.close();
    });

    async function documentRow() {
        const [row] = await handle.db.select().from(document).where(eq(document.id, documentId));
        return row!;
    }

    async function versionRow(versionId: number) {
        const [row] = await handle.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.id, versionId));
        return row!;
    }

    async function jobRow(jobId: string) {
        const [row] = await handle.db.select().from(ocrJobs).where(eq(ocrJobs.id, jobId));
        return row!;
    }

    it("finalizing a superseded version stamps its version row and job, not the document", async () => {
        // v2 is current (supersession flipped the pointer); v1 finishes late.
        const before = await documentRow();
        expect(before.currentVersionId).toBe(BigInt(v2.versionId));
        expect(before.ocrProcessed).toBe(false);

        await finalizeStorage(
            documentId,
            v1.jobId,
            3,
            "v1 summary",
            meta,
            Date.now() - 10,
            v1.versionId
        );

        // The document-level fields belong to the CURRENT version and stay put
        // exactly as they were before the stale finalize.
        const doc = await documentRow();
        expect(doc.ocrProcessed).toBe(false);
        expect(doc.ocrJobId).toBe(before.ocrJobId);
        expect(doc.ocrJobId).not.toBe(v1.jobId);
        expect(doc.ocrProvider).toBe(before.ocrProvider);
        expect(doc.ocrMetadata).toEqual(before.ocrMetadata);
        expect(doc.currentVersionId).toBe(BigInt(v2.versionId));

        // The stale version still records its own completion provenance.
        const version = await versionRow(v1.versionId);
        expect(version.ocrProcessed).toBe(true);
        expect(version.ocrJobId).toBe(v1.jobId);
        expect(version.ocrProvider).toBe("NATIVE_PDF");

        // The other version is untouched.
        const currentVersion = await versionRow(v2.versionId);
        expect(currentVersion.ocrProcessed).toBe(false);

        // The job for the stale version completes normally.
        const job = await jobRow(v1.jobId);
        expect(job.status).toBe("completed");
        expect(job.confidenceScore).toBe(99);

        // Metadata is written per (document, version) — the stale version's row.
        const metadataRows = await handle.db
            .select()
            .from(documentMetadata)
            .where(eq(documentMetadata.documentId, BigInt(documentId)));
        expect(metadataRows.map(r => r.versionId)).toEqual([BigInt(v1.versionId)]);
    });

    it("finalizing the current version updates the document row", async () => {
        await finalizeStorage(
            documentId,
            v2.jobId,
            5,
            "v2 summary",
            { ...meta, embeddingIndexKey: "legacy-openai-1536" },
            Date.now() - 10,
            v2.versionId
        );

        const doc = await documentRow();
        expect(doc.ocrProcessed).toBe(true);
        expect(doc.ocrJobId).toBe(v2.jobId);
        expect(doc.ocrProvider).toBe("NATIVE_PDF");
        expect(doc.ocrMetadata).toEqual(
            expect.objectContaining({
                totalChunks: 5,
                totalPages: 1,
                embeddingIndexKey: "legacy-openai-1536",
            })
        );

        const version = await versionRow(v2.versionId);
        expect(version.ocrProcessed).toBe(true);
        expect(version.ocrJobId).toBe(v2.jobId);

        const job = await jobRow(v2.jobId);
        expect(job.status).toBe("completed");
    });

    it("clears the previous run's index key when a later run uses the default index", async () => {
        // The run before this one finalized on "legacy-openai-1536".
        expect((await documentRow()).ocrMetadata).toHaveProperty(
            "embeddingIndexKey",
            "legacy-openai-1536"
        );

        await finalizeStorage(
            documentId,
            v2.jobId,
            5,
            "v2 summary",
            meta,
            Date.now() - 10,
            v2.versionId
        );

        for (const metadata of [
            (await documentRow()).ocrMetadata,
            (await versionRow(v2.versionId)).ocrMetadata,
        ]) {
            expect(metadata).toEqual(expect.objectContaining({ totalChunks: 5 }));
            expect(metadata).not.toHaveProperty("embeddingIndexKey");
        }
    });

    it("keeps a key another request merges in while the run is finishing", async () => {
        // A website source's preview is recorded on first open, which can land
        // between this run's read of the row and its write.
        const preview = { url: "/api/files/finalize-preview", source: "/api/files/v2" };
        let raced = false;
        const racing = new Proxy(handle.db, {
            get(target, prop) {
                const value = Reflect.get(target, prop, target) as unknown;
                if (prop !== "update") {
                    return typeof value === "function" ? value.bind(target) : value;
                }
                return (table: typeof document) => {
                    const builder = target.update(table);
                    if (raced || table !== document) return builder;
                    raced = true;
                    return runningFirst(
                        builder,
                        () => handle.client`
                            UPDATE pdr_ai_v2_document
                            SET ocr_metadata = coalesce(ocr_metadata, '{}'::jsonb)
                                || ${JSON.stringify({ websitePreview: preview })}::jsonb
                            WHERE id = ${documentId}`
                    );
                };
            },
        });

        configureDatabase(racing);
        try {
            await finalizeStorage(
                documentId,
                v2.jobId,
                5,
                "v2 summary",
                meta,
                Date.now() - 10,
                v2.versionId
            );
        } finally {
            configureDatabase(handle.db);
        }

        expect(raced).toBe(true);
        expect((await documentRow()).ocrMetadata).toEqual(
            expect.objectContaining({ websitePreview: preview, totalChunks: 5 })
        );
    });

    it("drops a failure stamp when a replayed run succeeds, keeping the row's provenance", async () => {
        // What the dead-event handler leaves, on a row that also carries its own metadata.
        const stamp = {
            marker: "keep-me",
            error: "processing_failed",
            errorMessage: "pipeline event dead: OpenAI API error: 429 - RESOURCE_EXHAUSTED",
            failedAt: "2026-10-23T00:00:00.000Z",
        };
        await handle.db
            .update(document)
            .set({ ocrProcessed: false, ocrMetadata: stamp })
            .where(eq(document.id, documentId));
        await handle.db
            .update(ocrJobs)
            .set({ status: "failed", errorMessage: stamp.errorMessage })
            .where(eq(ocrJobs.id, v2.jobId));

        await finalizeStorage(
            documentId,
            v2.jobId,
            5,
            "v2 summary",
            meta,
            Date.now() - 10,
            v2.versionId
        );

        for (const metadata of [
            (await documentRow()).ocrMetadata,
            (await versionRow(v2.versionId)).ocrMetadata,
        ]) {
            expect(metadata).toEqual(
                expect.objectContaining({ marker: "keep-me", totalChunks: 5 })
            );
            expect(metadata).not.toHaveProperty("error");
            expect(metadata).not.toHaveProperty("errorMessage");
            expect(metadata).not.toHaveProperty("failedAt");
        }
        expect(await jobRow(v2.jobId)).toEqual(
            expect.objectContaining({ status: "completed", errorMessage: null })
        );
    });
});
