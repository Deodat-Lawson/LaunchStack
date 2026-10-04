/**
 * Cascade-delete pin against a real Postgres (TEST_DATABASE_URL, falling
 * back to DATABASE_URL): deleting a source in one transaction must cancel
 * its in-flight pipeline events, remove its job rows, and take every row
 * hanging off the document with it — while leaving a sibling document in
 * the same company, and its pending event, untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import {
    document,
    documentContextChunks,
    documentRetrievalChunks,
    documentStructure,
    documentVersions,
    eventOutbox,
    ocrJobs,
} from "@launchstack/store/schema";

import { createDocumentLifecycle, createDocumentVersionLifecycle } from "../src/source-lifecycle";
import { CANCELLED_BY_DELETE, deleteSourceCascade } from "../src/source-lifecycle/delete";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("deleteSourceCascade (integration)", () => {
    let handle: Db;
    let companyId: bigint;

    beforeAll(async () => {
        handle = createDb({ url: url! });
        configureDatabase(handle.db);
        const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('cascade-delete-test-co', '1') RETURNING id
    `;
        companyId = BigInt(rows[0]!.id as number);
    });

    afterAll(async () => {
        if (!handle) return;
        await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}`;
        await handle.client`DELETE FROM pdr_ai_v2_ocr_jobs WHERE company_id = ${String(companyId)}`;
        await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${String(companyId)}`;
        await handle.close();
    });

    async function newSource(name: string) {
        return createDocumentLifecycle({
            companyId,
            userId: "user_test",
            title: name,
            category: "General",
            url: `http://seaweedfs:8333/launchstack/documents/${name}`,
            creationKey: `upload:${name}`,
            mimeType: "application/pdf",
            processing: { originalFilename: name },
        });
    }

    /** A structure node, one context chunk and one retrieval chunk for the version. */
    async function seedIndexRows(documentId: number, versionId: number) {
        const [node] = await handle.db
            .insert(documentStructure)
            .values({
                documentId: BigInt(documentId),
                versionId: BigInt(versionId),
                contentType: "section",
                path: "/",
                level: 0,
                ordering: 0,
            })
            .returning({ id: documentStructure.id });
        const [ctx] = await handle.db
            .insert(documentContextChunks)
            .values({
                documentId: BigInt(documentId),
                versionId: BigInt(versionId),
                structureId: BigInt(node!.id),
                content: `chunk of ${documentId}`,
            })
            .returning({ id: documentContextChunks.id });
        await handle.db.insert(documentRetrievalChunks).values({
            contextChunkId: BigInt(ctx!.id),
            documentId: BigInt(documentId),
            versionId: BigInt(versionId),
            content: `child of ${documentId}`,
        });
    }

    async function countRows(table: typeof documentStructure, documentId: number) {
        const [row] = await handle.db
            .select({ n: sql<number>`count(*)::int` })
            .from(table)
            .where(eq(table.documentId, BigInt(documentId)));
        return row!.n;
    }

    async function outboxStatuses(sourceId: number) {
        const rows = await handle.db
            .select({ status: eventOutbox.status, lastError: eventOutbox.lastError })
            .from(eventOutbox)
            .where(
                sql`${eventOutbox.companyId} = ${Number(companyId)} AND (${eventOutbox.payload} -> 'payload' ->> 'sourceId') = ${String(sourceId)}`
            );
        return rows;
    }

    it("removes the document, its rows and jobs, and cancels its events", async () => {
        const target = await newSource("cascade-target.pdf");
        const sibling = await newSource("cascade-sibling.pdf");
        // A second version: two blobs, two jobs, two events for the target.
        const v2 = await createDocumentVersionLifecycle({
            documentId: target.documentId,
            companyId,
            userId: "user_test",
            title: "cascade-target.pdf",
            category: "General",
            url: "http://seaweedfs:8333/launchstack/documents/cascade-target-v2.pdf",
            creationKey: "upload:cascade-target-v2.pdf",
            mimeType: "application/pdf",
        });
        await seedIndexRows(target.documentId, target.versionId);
        await seedIndexRows(target.documentId, v2.versionId);
        await seedIndexRows(sibling.documentId, sibling.versionId);

        // One of the target's events is mid-flight, as if a worker held it.
        await handle.db
            .update(eventOutbox)
            .set({ status: "processing", claimedAt: new Date() })
            .where(
                sql`${eventOutbox.companyId} = ${Number(companyId)} AND (${eventOutbox.payload} -> 'payload' ->> 'sourceId') = ${String(target.documentId)} AND (${eventOutbox.payload} -> 'payload' ->> 'sourceVersionId') = ${String(v2.versionId)}`
            );
        expect((await outboxStatuses(target.documentId)).map(r => r.status).sort()).toEqual([
            "pending",
            "processing",
        ]);

        const result = await handle.db.transaction(tx =>
            deleteSourceCascade(tx, target.documentId)
        );

        expect(result.found).toBe(true);
        expect(result.deletedVersions).toBe(2);
        expect(result.deletedJobs).toBe(2);
        expect(result.cancelledEvents).toBe(2);
        expect(result.blobUrls.sort()).toEqual([
            "http://seaweedfs:8333/launchstack/documents/cascade-target-v2.pdf",
            "http://seaweedfs:8333/launchstack/documents/cascade-target.pdf",
        ]);

        // The document and everything under it are gone.
        const docs = await handle.db
            .select({ id: document.id })
            .from(document)
            .where(eq(document.id, target.documentId));
        expect(docs).toHaveLength(0);
        expect(
            await countRows(
                documentVersions as unknown as typeof documentStructure,
                target.documentId
            )
        ).toBe(0);
        expect(await countRows(documentStructure, target.documentId)).toBe(0);
        expect(
            await countRows(
                documentContextChunks as unknown as typeof documentStructure,
                target.documentId
            )
        ).toBe(0);
        expect(
            await countRows(
                documentRetrievalChunks as unknown as typeof documentStructure,
                target.documentId
            )
        ).toBe(0);
        expect(
            await countRows(ocrJobs as unknown as typeof documentStructure, target.documentId)
        ).toBe(0);

        // Its events are cancelled with the runbook's marker, not dead and not pending.
        const events = await outboxStatuses(target.documentId);
        expect(events).toHaveLength(2);
        for (const event of events) {
            expect(event.status).toBe("cancelled");
            expect(event.lastError).toBe(CANCELLED_BY_DELETE);
        }

        // The sibling is untouched: rows, job and pending event all still there.
        expect(
            await countRows(
                documentContextChunks as unknown as typeof documentStructure,
                sibling.documentId
            )
        ).toBe(1);
        expect(
            await countRows(ocrJobs as unknown as typeof documentStructure, sibling.documentId)
        ).toBe(1);
        expect((await outboxStatuses(sibling.documentId)).map(r => r.status)).toEqual(["pending"]);
    });

    it("is a no-op for a document that does not exist", async () => {
        const result = await handle.db.transaction(tx => deleteSourceCascade(tx, 2_147_483_000));
        expect(result).toEqual({
            found: false,
            blobUrls: [],
            cancelledEvents: 0,
            deletedJobs: 0,
            deletedVersions: 0,
        });
    });
});
