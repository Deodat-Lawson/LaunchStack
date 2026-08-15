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

import { configureDatabase, createDb, type Db } from "../src/db";
import { document, documentMetadata, documentVersions, ocrJobs } from "../src/db/schema";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
} from "../src/ingestion/source-lifecycle";
import { finalizeStorage } from "../src/ocr/processor";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

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
});
