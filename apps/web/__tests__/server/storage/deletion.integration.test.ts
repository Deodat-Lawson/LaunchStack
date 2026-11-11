import { eq, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbClient } from "@launchstack/store/client";
import {
    company,
    document,
    documentVersions,
    eventOutbox,
    fileUploads,
    ocrJobs,
    uploadBatchFiles,
    uploadBatches,
} from "@launchstack/store/schema";

import { brandMedia } from "~/server/db/schema/brand";
import { collabAgentPersona } from "~/server/db/schema/collab";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
} from "~/server/db/schema/storage";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { deleteStoredObjects } from "~/server/storage/delete-objects";
import { recordStoredObject } from "~/server/storage/ledger";
import { deleteObjects as deleteDatabaseObjects } from "~/server/storage/adapters/database";
import {
    planDocumentDeletion,
    planObjectDeletion,
    planVersionDeletion,
} from "~/server/storage/deletion/plan";
import {
    markStorageDeletionRequestDead,
    processStorageDeletionRequest,
} from "~/server/storage/deletion/worker";
import type { ObjectRef } from "~/server/storage/object-ref";
import {
    findReferencedStorageObjects,
    findStorageObjectPointers,
    type StorageReferenceCandidate,
} from "~/server/storage/deletion/references";
import { storageDeletionOperationalState } from "~/server/storage/deletion/status";
import * as storedUrl from "~/server/storage/stored-url";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient;
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockActiveDb }) }));
jest.mock("~/env", () => ({
    env: {
        server: {
            NEXT_PUBLIC_STORAGE_PROVIDER: "database",
            NEXT_PUBLIC_S3_ENDPOINT: "http://s3:8333",
            S3_PUBLIC_ENDPOINT: "https://objects.example",
            S3_BUCKET_NAME: "files",
            UPLOADTHING_TOKEN: Buffer.from(
                JSON.stringify({ appId: "testapp", apiKey: "test", regions: ["iad1"] })
            ).toString("base64"),
        },
        client: {},
    },
}));
jest.mock("~/server/storage/delete-objects", () => ({ deleteStoredObjects: jest.fn() }));

const context = { requestedBy: "user:test", reason: "user_delete", traceId: "deletion-test" };
const ref = (id: number): ObjectRef => ({
    adapter: "database",
    storageLocationId: "database:file_uploads",
    key: String(id),
});
const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("durable storage deletion (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
    });
    beforeEach(async () => {
        await test.db.execute(
            sql`TRUNCATE ${company}, ${storageObjects}, ${storageDeletionRequests} RESTART IDENTITY CASCADE`
        );
        const [tenant] = await test.db
            .insert(company)
            .values({ name: "Deletion test", numberOfEmployees: "1" })
            .returning();
        companyId = BigInt(tenant!.id);
        jest.mocked(deleteStoredObjects).mockReset();
        // Exercise the real database provider, not a simulated byte deletion.
        jest.mocked(deleteStoredObjects).mockImplementation(deleteDatabaseObjects);
    });
    afterAll(async () => {
        await test?.close();
    });

    async function file(owner: bigint | null = companyId) {
        const [row] = await test.db
            .insert(fileUploads)
            .values({
                userId: "user:test",
                companyId: owner,
                filename: "test.txt",
                mimeType: "text/plain",
                fileSize: 5,
                fileData: "aGVsbG8=",
            })
            .returning();
        const url = `/api/files/${row!.id}`;
        await recordStoredObject(test.db, {
            ref: ref(row!.id),
            url,
            companyId: owner,
            source: "upload-file",
        });
        return { id: row!.id, url };
    }
    async function doc(url: string, metadata: unknown = null, owner = companyId) {
        const [row] = await test.db
            .insert(document)
            .values({
                companyId: owner,
                url,
                title: "File",
                category: "Test",
                ocrMetadata: metadata,
            })
            .returning();
        return row!;
    }
    async function objectPlan(urls: string[]) {
        return test.db.transaction(tx => planObjectDeletion(tx, { ...context, companyId, urls }));
    }
    async function items(requestId: number) {
        return test.db
            .select()
            .from(storageDeletionItems)
            .where(eq(storageDeletionItems.requestId, requestId))
            .orderBy(storageDeletionItems.id);
    }
    async function request(requestId: number) {
        const [row] = await test.db
            .select()
            .from(storageDeletionRequests)
            .where(eq(storageDeletionRequests.id, requestId));
        return row!;
    }

    it("snapshots document, version, job, batch, preview and audio URLs", async () => {
        const bytes = await Promise.all(Array.from({ length: 8 }, () => file()));
        const source = await doc(bytes[0]!.url, {
            websitePreview: { url: bytes[4]!.url },
            audioUrl: bytes[6]!.url,
        });
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(source.id),
                versionNumber: 1,
                url: bytes[1]!.url,
                mimeType: "text/plain",
                ocrMetadata: { websitePreview: { url: bytes[5]!.url }, audioUrl: bytes[7]!.url },
            })
            .returning();
        await test.db.insert(ocrJobs).values({
            id: "job",
            documentId: BigInt(source.id),
            versionId: BigInt(version!.id),
            companyId,
            userId: "user:test",
            documentName: "File",
            documentUrl: bytes[2]!.url,
        });
        await test.db
            .insert(uploadBatches)
            .values({ id: "batch", companyId, createdByUserId: "user:test" });
        await test.db.insert(uploadBatchFiles).values({
            batchId: "batch",
            companyId,
            userId: "user:test",
            filename: "File",
            documentId: BigInt(source.id),
            storageUrl: bytes[3]!.url,
            status: "complete",
        });
        await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
        expect(await test.db.select().from(document)).toHaveLength(0);
        expect(await test.db.select().from(documentVersions)).toHaveLength(0);
        const requests = await test.db.select().from(storageDeletionRequests);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            companyId,
            scope: "document",
            documentId: source.id,
            ...context,
        });
        expect((await items(requests[0]!.id)).map(item => item.sourceUrl).sort()).toEqual(
            bytes.map(byte => byte.url).sort()
        );
        expect((await items(requests[0]!.id)).every(item => item.storedObjectId !== null)).toBe(
            true
        );
        const events = await test.db.select().from(eventOutbox);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            eventType: "storage.deletion.requested",
            eventId: `storage.deletion.requested:${requests[0]!.id}`,
        });
        await processStorageDeletionRequest(requests[0]!.id);
        expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        expect((await request(requests[0]!.id)).status).toBe("completed");
        expect((await items(requests[0]!.id)).every(item => item.state === "deleted")).toBe(true);
        const ledger = await test.db.select().from(storageObjects);
        expect(ledger.filter(row => row.deletedAt !== null)).toHaveLength(8);
    });

    it("rolls back plans, outbox events and relational deletion together", async () => {
        const source = await doc((await file()).url);
        await expect(
            test.db.transaction(async tx => {
                await deleteDocumentCore(tx, source.id, context);
                throw new Error("rollback");
            })
        ).rejects.toThrow("rollback");
        expect(await test.db.select().from(document)).toHaveLength(1);
        expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(0);
        expect(await test.db.select().from(storageDeletionItems)).toHaveLength(0);
        expect(await test.db.select().from(eventOutbox)).toHaveLength(0);
    });

    it("plans a batch sharing one object and safely converges duplicate cleanup", async () => {
        const shared = await file();
        const a = await doc(shared.url);
        const b = await doc(shared.url);
        await test.db.transaction(async tx => {
            await deleteDocumentCore(tx, a.id, { ...context, reason: "batch_delete" });
            await deleteDocumentCore(tx, b.id, { ...context, reason: "batch_delete" });
        });
        const requests = await test.db.select().from(storageDeletionRequests);
        await Promise.all(requests.map(row => processStorageDeletionRequest(row.id)));
        expect(
            (await Promise.all(requests.map(row => items(row.id))))
                .map(rows => rows[0]!.state)
                .sort()
        ).toEqual(["deleted", "not_found"]);
        expect(await test.db.select().from(fileUploads)).toHaveLength(0);
    });

    it("retains bytes referenced by a document in any tenant", async () => {
        const shared = await file();
        const source = await doc(shared.url);
        const [other] = await test.db
            .insert(company)
            .values({ name: "Other", numberOfEmployees: "1" })
            .returning();
        await doc(shared.url, null, BigInt(other!.id));
        await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
        const [row] = await test.db.select().from(storageDeletionRequests);
        await processStorageDeletionRequest(row!.id);
        expect((await items(row!.id))[0]!.state).toBe("retained");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("matches a ref's ledger URL as well as the historical source URL", async () => {
        const shared = await file();
        await doc(shared.url);
        const id = (await objectPlan([`http://app:3000${shared.url}`]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("retained");
    });

    it("records non-storage external links as skipped", async () => {
        const id = (await objectPlan(["https://example.org/page"]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({
            state: "skipped",
            adapter: null,
            errorCode: "unrecognized",
        });
        expect((await request(id)).status).toBe("completed");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("quarantines a URL claimed by two distinct ledger refs", async () => {
        const url = "https://example.org/collision";
        for (const key of ["one", "two"])
            await recordStoredObject(test.db, {
                ref: { adapter: "s3", storageLocationId: "s3:test", key },
                url,
                companyId,
                source: "upload-file",
            });
        const id = (await objectPlan([url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({
            state: "quarantined",
            adapter: null,
            errorCode: "ambiguous",
        });
        expect((await request(id)).status).toBe("blocked");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("commits retryable outcomes before throwing and retries only pending items", async () => {
        const a = await file();
        const b = await file();
        const id = (await objectPlan([a.url, b.url]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs =>
            refs.map(ref => ({
                ref,
                outcome: ref.key === String(a.id) ? "deleted" : "retryable",
                errorCode: "transient",
                message: "try later",
            }))
        );
        await expect(processStorageDeletionRequest(id)).rejects.toThrow("retryable pending");
        expect((await items(id)).map(item => [item.state, item.attempts])).toEqual([
            ["deleted", 1],
            ["pending", 1],
        ]);
        expect((await request(id)).status).toBe("pending");
        jest.mocked(deleteStoredObjects)
            .mockClear()
            .mockImplementation(async refs => refs.map(ref => ({ ref, outcome: "not_found" })));
        await processStorageDeletionRequest(id);
        expect(deleteStoredObjects).toHaveBeenCalledTimes(1);
        expect((await items(id))[1]).toMatchObject({
            state: "not_found",
            attempts: 2,
            errorCode: null,
            lastError: null,
        });
        expect((await request(id)).status).toBe("completed");
    });

    it("marks refused provider outcomes blocked", async () => {
        const id = (await objectPlan([(await file()).url]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs =>
            refs.map(ref => ({
                ref,
                outcome: "blocked",
                errorCode: "storage_location_mismatch",
                message: "wrong location",
            }))
        );
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({
            state: "blocked",
            attempts: 1,
            errorCode: "storage_location_mismatch",
        });
        expect((await request(id)).status).toBe("blocked");
    });

    it("completed requests are no-ops on redelivery", async () => {
        const id = (await objectPlan([(await file()).url]))!;
        await processStorageDeletionRequest(id);
        const finished = await request(id);
        jest.mocked(deleteStoredObjects).mockClear();
        await processStorageDeletionRequest(id);
        expect(deleteStoredObjects).not.toHaveBeenCalled();
        expect((await request(id)).completedAt).toEqual(finished.completedAt);
    });

    it("dead lettering blocks remaining pending items but preserves terminal audit outcomes", async () => {
        const id = (await objectPlan([(await file()).url, "https://example.org/page"]))!;
        await markStorageDeletionRequestDead(id);
        expect((await items(id)).map(item => item.state)).toEqual(["blocked", "skipped"]);
        expect((await items(id))[0]!.errorCode).toBe("retry_budget_exhausted");
        expect((await request(id)).status).toBe("blocked");
    });

    it("plans version URL, preview and version-scoped job before row deletion", async () => {
        const bytes = await Promise.all([file(), file(), file()]);
        const source = await doc("https://example.org/current");
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(source.id),
                versionNumber: 1,
                url: bytes[0].url,
                mimeType: "text/plain",
                ocrMetadata: { websitePreview: { url: bytes[1].url } },
            })
            .returning();
        await test.db.insert(ocrJobs).values({
            id: "version-job",
            documentId: BigInt(source.id),
            versionId: BigInt(version!.id),
            companyId,
            userId: "user:test",
            documentName: "Version",
            documentUrl: bytes[2].url,
        });
        const id = await test.db.transaction(async tx => {
            const id = await planVersionDeletion(tx, {
                ...context,
                documentId: source.id,
                versionId: version!.id,
                reason: "version_delete",
            });
            await tx.delete(documentVersions).where(eq(documentVersions.id, version!.id));
            await tx.delete(ocrJobs).where(eq(ocrJobs.id, "version-job"));
            return id!;
        });
        expect((await items(id)).map(item => item.sourceUrl).sort()).toEqual(
            bytes.map(byte => byte.url).sort()
        );
        await processStorageDeletionRequest(id);
        expect((await items(id)).map(item => item.state)).toEqual([
            "deleted",
            "deleted",
            "deleted",
        ]);
        expect(await test.db.select().from(document)).toHaveLength(1);
    });

    it("replacement cleanup retains old URL still referenced by immutable history", async () => {
        const old = await file();
        const next = await file();
        const source = await doc(old.url);
        await test.db.insert(documentVersions).values({
            documentId: BigInt(source.id),
            versionNumber: 1,
            url: old.url,
            mimeType: "text/plain",
        });
        const id = await test.db.transaction(async tx => {
            await tx.update(document).set({ url: next.url }).where(eq(document.id, source.id));
            return (await planObjectDeletion(tx, {
                ...context,
                companyId,
                urls: [old.url],
                reason: "replaced_object",
            }))!;
        });
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("retained");
        expect(await test.db.select().from(fileUploads)).toHaveLength(2);
    });

    it.each(
        [
            "document",
            "version",
            "preview",
            "audio",
            "version-preview",
            "version-audio",
            "brand",
            "persona",
            "job",
            "batch",
        ].flatMap(kind => [false, true].map(legacy => ({ kind, legacy })))
    )("retains a live $kind reference (legacy=$legacy)", async ({ kind, legacy }) => {
        const bytes = await file();
        const liveUrl = legacy
            ? `https://old-origin.example/api/files/00${bytes.id}/?download=1`
            : bytes.url;
        const source = await doc(
            kind === "document" ? liveUrl : "https://example.org/page",
            kind === "preview"
                ? { websitePreview: { url: liveUrl } }
                : kind === "audio"
                  ? { audioUrl: liveUrl }
                  : null
        );
        if (kind.startsWith("version"))
            await test.db.insert(documentVersions).values({
                documentId: BigInt(source.id),
                versionNumber: 1,
                url: kind === "version" ? liveUrl : source.url,
                mimeType: "text/plain",
                ocrMetadata:
                    kind === "version-audio"
                        ? { audioUrl: liveUrl }
                        : kind === "version-preview"
                          ? { websitePreview: { url: liveUrl } }
                          : null,
            });
        if (kind === "brand")
            await test.db.insert(brandMedia).values({
                id: "media",
                companyId,
                uploadedByUserId: "user:test",
                storageUrl: liveUrl,
                mimeType: "text/plain",
                size: 5,
            });
        if (kind === "persona")
            await test.db.insert(collabAgentPersona).values({
                id: "persona",
                companyId,
                key: "test",
                displayName: "Test",
                role: "Test",
                systemPrompt: "Test",
                avatarUrl: liveUrl,
            });
        if (kind === "job")
            await test.db.insert(ocrJobs).values({
                id: "live-job",
                documentId: BigInt(source.id),
                companyId,
                userId: "user:test",
                documentName: "Live",
                documentUrl: liveUrl,
            });
        if (kind === "batch") {
            await test.db
                .insert(uploadBatches)
                .values({ id: "live-batch", companyId, createdByUserId: "user:test" });
            await test.db.insert(uploadBatchFiles).values({
                batchId: "live-batch",
                companyId,
                userId: "user:test",
                filename: "Live",
                documentId: BigInt(source.id),
                storageUrl: liveUrl,
            });
        }
        const id = (await objectPlan([bytes.url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("retained");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it.each(["ledger", "file", "unstamped-file"])(
        "blocks foreign ownership from %s",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Foreign", numberOfEmployees: "1" })
                .returning();
            const bytes = await file(kind === "unstamped-file" ? null : BigInt(other!.id));
            if (kind !== "ledger")
                await test.db
                    .update(storageObjects)
                    .set({ companyId })
                    .where(eq(storageObjects.objectKey, String(bytes.id)));
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]).toMatchObject({
                state: "blocked",
                errorCode: "foreign_object",
                attempts: 0,
            });
            expect(deleteStoredObjects).not.toHaveBeenCalled();
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
        }
    );

    it("allows legacy unledgered bytes only when globally unreferenced", async () => {
        const bytes = await file();
        await test.db.delete(storageObjects).where(eq(storageObjects.objectKey, String(bytes.id)));
        const id = (await objectPlan([bytes.url]))!;
        expect((await items(id))[0]!.storedObjectId).toBeNull();
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("deleted");
    });

    it("deduplicates URLs and creates no request/event for empty object candidates", async () => {
        expect(await objectPlan([])).toBeNull();
        expect(
            await test.db.transaction(tx =>
                planDocumentDeletion(tx, { ...context, documentIds: [] })
            )
        ).toEqual([]);
        expect(await test.db.select().from(eventOutbox)).toHaveLength(0);
        const bytes = await file();
        const id = (await objectPlan([bytes.url, bytes.url]))!;
        expect(await items(id)).toHaveLength(1);
    });

    it("keeps requests and items after tenant deletion", async () => {
        const id = (await objectPlan(["https://example.org/page"]))!;
        await test.db.delete(company).where(eq(company.id, Number(companyId)));
        expect(await request(id)).toMatchObject({ companyId });
        expect(await items(id)).toHaveLength(1);
    });
    it.each([
        [
            "uploadthing",
            "https://testapp.ufs.sh/f/shared-key",
            "https://utfs.io/f/shared-key",
            "https://uploadthing.com/f/shared-key",
            { adapter: "uploadthing", storageLocationId: "uploadthing:testapp", key: "shared-key" },
        ],
        [
            "s3",
            "http://s3:8333/files/shared-key",
            "https://objects.example/files/shared-key",
            "http://s3:8333/files/shared-key?download=1",
            { adapter: "s3", storageLocationId: "s3:http://s3:8333@files", key: "shared-key" },
        ],
    ] as const)(
        "uses canonical %s inventory URLs for ledgered reference checks",
        async (_adapter, canonical, source, live, identity) => {
            await recordStoredObject(test.db, {
                ref: identity,
                url: canonical,
                companyId,
                source: "upload-file",
            });
            await doc(canonical);
            const id = (await objectPlan([source]))!;
            expect((await items(id))[0]!.storedObjectId).not.toBeNull();
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
            await test.db.delete(document).where(eq(document.companyId, companyId));
            await doc(live);
            const aliasId = (await objectPlan([source]))!;
            jest.mocked(deleteStoredObjects).mockImplementation(async refs =>
                refs.map(ref => ({ ref, outcome: "deleted" }))
            );
            const parser = jest.spyOn(storedUrl, "refFromStoredUrl");
            try {
                await processStorageDeletionRequest(aliasId);
                expect((await items(aliasId))[0]!.state).toBe("deleted");
                expect(parser).not.toHaveBeenCalled();
            } finally {
                parser.mockRestore();
            }
        }
    );

    it("protects unledgered database aliases on any origin without requiring the parser", async () => {
        const bytes = await file();
        await test.db.delete(storageObjects).where(eq(storageObjects.companyId, companyId));
        const alias = `https://foreign.example/api/files/00${bytes.id}/nested?download=1`;
        await doc(alias);
        await doc(`http://app:3000/api/files/${bytes.id}0?download=1`);
        const id = (await objectPlan([bytes.url]))!;
        const parser = jest.spyOn(storedUrl, "refFromStoredUrl");
        try {
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(parser).not.toHaveBeenCalled();
        } finally {
            parser.mockRestore();
        }
    });

    it("holds no SQL transaction or advisory lock during a network provider call", async () => {
        const url = "https://store.public.blob.vercel-storage.com/unshared";
        const id = (await objectPlan([url]))!;
        const observer = await test.createSession();
        try {
            jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
                const [activity] = await observer.db.execute<{
                    transactionOpen: boolean;
                    advisoryLockHeld: boolean;
                }>(sql`
                    SELECT EXISTS (
                        SELECT 1 FROM pg_stat_activity
                        WHERE datname = current_database() AND pid <> pg_backend_pid()
                            AND xact_start IS NOT NULL
                    ) AS "transactionOpen", EXISTS (
                        SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                        WHERE l.locktype = 'advisory' AND l.granted
                            AND a.datname = current_database()
                    ) AS "advisoryLockHeld"
                `);
                expect(activity).toEqual({ transactionOpen: false, advisoryLockHeld: false });
                return refs.map(ref => ({ ref, outcome: "deleted" }));
            });
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("deleted");
        } finally {
            await observer.close();
        }
    });
    it("persists retryable outcomes even when a real database delete aborts its statement", async () => {
        const bytes = await file();
        const id = (await objectPlan([bytes.url]))!;
        await test.db.execute(sql`
            CREATE FUNCTION reject_storage_delete() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'transient provider failure'; END $$;
            CREATE TRIGGER reject_storage_delete BEFORE DELETE ON ${fileUploads}
            FOR EACH ROW EXECUTE FUNCTION reject_storage_delete();
        `);
        try {
            await expect(processStorageDeletionRequest(id)).rejects.toThrow("retryable pending");
            expect((await items(id))[0]).toMatchObject({
                state: "pending",
                attempts: 1,
                errorCode: "database_delete_failed",
            });
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
        } finally {
            await test.db.execute(
                sql`DROP TRIGGER reject_storage_delete ON ${fileUploads}; DROP FUNCTION reject_storage_delete();`
            );
        }
    });
    it("prefilters legacy S3 aliases by basename and verifies parsed identity", async () => {
        const key = "documents/93411647-cc8e-48aa-8ffa-a65904d5efe8.pdf";
        const canonical = `http://s3:8333/files/${key}`;
        const alias = `https://objects.example/files/doc%75ments/93411647-cc8e-48aa-8ffa-a65904d5efe8%2Epdf?download=1`;
        await test.db.insert(document).values(
            Array.from({ length: 100 }, (_, id) => ({
                companyId,
                title: `Unrelated ${id}`,
                category: "Test",
                url: `https://example.org/unrelated-${id}`,
            }))
        );
        await doc(alias);
        const id = (await objectPlan([canonical]))!;
        const parser = jest.spyOn(storedUrl, "refFromStoredUrl");
        try {
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(parser.mock.calls.map(call => call[0])).toEqual([alias]);
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        } finally {
            parser.mockRestore();
        }
    });

    it.each(
        ["recording-first", "transcript-first"].flatMap(order =>
            ["canonical", "localhost"].map(spelling => ({ order, spelling }))
        )
    )(
        "deletes shared audio after both documents are deleted: $order ($spelling)",
        async ({ order, spelling }) => {
            const recordingBytes = await file();
            const transcriptBytes = await file();
            const recording = await doc(recordingBytes.url);
            const audioUrl =
                spelling === "localhost"
                    ? `http://localhost:3000${recordingBytes.url}`
                    : recordingBytes.url;
            const transcript = await doc(transcriptBytes.url, { audioUrl });
            const first = order === "recording-first" ? recording : transcript;
            const last = order === "recording-first" ? transcript : recording;
            await test.db.transaction(tx => deleteDocumentCore(tx, first.id, context));
            const [firstRequest] = await test.db.select().from(storageDeletionRequests);
            await processStorageDeletionRequest(firstRequest!.id);
            expect(
                await test.db
                    .select()
                    .from(fileUploads)
                    .where(eq(fileUploads.id, recordingBytes.id))
            ).toHaveLength(1);
            expect(
                (await items(firstRequest!.id)).find(
                    item => item.objectKey === String(recordingBytes.id)
                )
            ).toMatchObject({
                state: "retained",
                sourceUrl: first.id === transcript.id ? audioUrl : recordingBytes.url,
            });
            await test.db.transaction(tx => deleteDocumentCore(tx, last.id, context));
            const requests = await test.db.select().from(storageDeletionRequests);
            const lastRequest = requests.find(row => row.id !== firstRequest!.id)!;
            await processStorageDeletionRequest(lastRequest.id);
            expect(
                (await items(lastRequest.id)).find(
                    item => item.objectKey === String(recordingBytes.id)
                )
            ).toMatchObject({
                state: "deleted",
                sourceUrl: last.id === transcript.id ? audioUrl : recordingBytes.url,
            });
            expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        }
    );

    it.each(["deleted", "not_found"] as const)(
        "lets confirmed %s supersede concurrent dead lettering and stamps inventory",
        async outcome => {
            const url = "https://store.public.blob.vercel-storage.com/unshared";
            await recordStoredObject(test.db, {
                ref: {
                    adapter: "vercel-blob",
                    storageLocationId: "vercel-blob:store",
                    key: "unshared",
                },
                url,
                companyId,
                source: "vercel-blob",
            });
            const id = (await objectPlan([url]))!;
            jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
                await markStorageDeletionRequestDead(id);
                return refs.map(ref => ({ ref, outcome }));
            });
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]).toMatchObject({
                state: outcome,
                attempts: 1,
                errorCode: null,
            });
            expect((await request(id)).status).toBe("completed");
            expect((await test.db.select().from(storageObjects))[0]!.deletedAt).not.toBeNull();
        }
    );

    it("redelivery retries exhausted items but leaves other blocked decisions unchanged", async () => {
        const bytes = await file();
        const blockedBytes = await file();
        const id = (await objectPlan([bytes.url, blockedBytes.url]))!;
        const rows = await items(id);
        await test.db
            .update(storageDeletionItems)
            .set({ state: "blocked", errorCode: "foreign_object" })
            .where(eq(storageDeletionItems.id, rows[1]!.id));
        await markStorageDeletionRequestDead(id);
        await processStorageDeletionRequest(id);
        expect((await items(id)).map(row => [row.state, row.errorCode])).toEqual([
            ["deleted", null],
            ["blocked", "foreign_object"],
        ]);
        expect((await request(id)).status).toBe("blocked");
    });

    it.each(
        (["queued", "processing", "completed", "failed", "needs_review"] as const).flatMap(status =>
            [false, true].map(legacy => ({ status, legacy }))
        )
    )("only busy OCR jobs protect bytes: $status (legacy=$legacy)", async ({ status, legacy }) => {
        const bytes = await file();
        const jobUrl = legacy
            ? `https://old-origin.example/api/files/00${bytes.id}?download=1`
            : bytes.url;
        const source = await doc("https://example.org/job-owner");
        await test.db.insert(ocrJobs).values({
            id: "status-job",
            documentId: BigInt(source.id),
            companyId,
            userId: "user:test",
            documentName: "Job",
            documentUrl: jobUrl,
            status,
        });
        const id = (await objectPlan([bytes.url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe(
            status === "queued" || status === "processing" ? "retained" : "deleted"
        );
    });

    it("detached busy OCR history does not protect bytes", async () => {
        const bytes = await file();
        await test.db.insert(ocrJobs).values({
            id: "detached",
            documentId: null,
            companyId,
            userId: "user:test",
            documentName: "Job",
            documentUrl: bytes.url,
            status: "processing",
        });
        const id = (await objectPlan([bytes.url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("deleted");
    });

    it.each(
        (["queued", "uploaded", "processing", "failed", "complete"] as const).flatMap(status =>
            [false, true].flatMap(detached =>
                [false, true].map(legacy => ({ status, detached, legacy }))
            )
        )
    )(
        "batch status $status protects retryable bytes (detached=$detached, legacy=$legacy)",
        async ({ status, detached, legacy }) => {
            const bytes = await file();
            const batchUrl = legacy
                ? `https://old-origin.example/api/files/00${bytes.id}?download=1`
                : bytes.url;
            const source = detached ? null : await doc("https://example.org/batch-owner");
            await test.db.insert(uploadBatches).values({
                id: "status-batch",
                companyId,
                createdByUserId: "user:test",
            });
            await test.db.insert(uploadBatchFiles).values({
                batchId: "status-batch",
                companyId,
                userId: "user:test",
                filename: "Batch",
                documentId: source ? BigInt(source.id) : null,
                storageUrl: batchUrl,
                status,
            });
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe(
                status === "complete" ? "deleted" : "retained"
            );
        }
    );

    it("conservatively protects any-origin database aliases even with inventory", async () => {
        const bytes = await file();
        await doc(`https://foreign.example/api/files/00${bytes.id}?download=1`);
        const id = (await objectPlan([bytes.url]))!;
        const parser = jest.spyOn(storedUrl, "refFromStoredUrl");
        try {
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(parser).not.toHaveBeenCalled();
        } finally {
            parser.mockRestore();
        }
    });

    async function externalPointer(owner: bigint | null = companyId, ledgered = true) {
        const pointer = await file(owner);
        const url = "https://store.public.blob.vercel-storage.com/pointer-bytes";
        await test.db
            .update(fileUploads)
            .set({
                storageProvider: "vercel-blob",
                storageUrl: url,
                fileData: null,
            })
            .where(eq(fileUploads.id, pointer.id));
        if (ledgered)
            await recordStoredObject(test.db, {
                ref: {
                    adapter: "vercel-blob",
                    storageLocationId: "vercel-blob:store",
                    key: "pointer-bytes",
                },
                url,
                companyId,
                source: "vercel-blob",
            });
        jest.mocked(deleteStoredObjects).mockImplementation(async (refs, tx) => {
            if (refs[0]!.adapter === "database") return deleteDatabaseObjects(refs, tx);
            return refs.map(ref => ({ ref, outcome: "deleted" }));
        });
        return { ...pointer, providerUrl: url };
    }

    it.each([true, false])(
        "cleans external bytes and their database pointer (ledgered=%s)",
        async ledgered => {
            const pointer = await externalPointer(companyId, ledgered);
            const source = await doc(pointer.url);
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            const [row] = await test.db.select().from(storageDeletionRequests);
            expect((await items(row!.id)).map(item => item.sourceUrl).sort()).toEqual(
                [pointer.url, pointer.providerUrl].sort()
            );
            await processStorageDeletionRequest(row!.id);
            expect((await items(row!.id)).every(item => item.state === "deleted")).toBe(true);
            expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        }
    );

    it.each(["foreign", "unstamped"] as const)(
        "blocks external expansion through a %s pointer",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Other pointer", numberOfEmployees: "1" })
                .returning();
            const pointer = await externalPointer(kind === "foreign" ? BigInt(other!.id) : null);
            const id = (await objectPlan([pointer.url]))!;
            expect(
                (await items(id)).find(item => item.sourceUrl === pointer.providerUrl)
            ).toMatchObject({ state: "blocked", errorCode: "foreign_object" });
            // The durable block survives even if the pointer disappears before delivery.
            await test.db.delete(fileUploads).where(eq(fileUploads.id, pointer.id));
            await processStorageDeletionRequest(id);
            expect(
                (await items(id)).find(item => item.sourceUrl === pointer.providerUrl)
            ).toMatchObject({ state: "blocked", errorCode: "foreign_object" });
            expect(
                jest
                    .mocked(deleteStoredObjects)
                    .mock.calls.every(([refs]) => refs[0]!.adapter === "database")
            ).toBe(true);
        }
    );

    it.each(["document", "job", "batch"] as const)(
        "protects external bytes through a shared live database pointer: %s",
        async kind => {
            const pointer = await externalPointer();
            const source = await doc(pointer.url);
            const live = await doc(
                kind === "document" ? pointer.url : "https://example.org/live-owner"
            );
            if (kind === "job")
                await test.db.insert(ocrJobs).values({
                    id: "pointer-job",
                    documentId: BigInt(live.id),
                    companyId,
                    userId: "user:test",
                    documentName: "Job",
                    documentUrl: pointer.url,
                    status: "processing",
                });
            if (kind === "batch") {
                await test.db.insert(uploadBatches).values({
                    id: "pointer-batch",
                    companyId,
                    createdByUserId: "user:test",
                });
                await test.db.insert(uploadBatchFiles).values({
                    batchId: "pointer-batch",
                    companyId,
                    userId: "user:test",
                    filename: "Pointer",
                    storageUrl: pointer.url,
                    documentId: null,
                    status: "failed",
                });
            }
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            const [row] = await test.db.select().from(storageDeletionRequests);
            await processStorageDeletionRequest(row!.id);
            expect((await items(row!.id)).map(item => item.state)).toEqual([
                "retained",
                "retained",
            ]);
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it("does not treat an id prefix as a legacy database reference", async () => {
        const bytes = await file();
        await test.db.delete(storageObjects).where(eq(storageObjects.companyId, companyId));
        await doc(`https://foreign.example/api/files/${bytes.id}0?download=1`);
        const id = (await objectPlan([bytes.url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("deleted");
    });

    it("does not protect legacy provider keys by substring or foreign location alone", async () => {
        const url = "https://testapp.ufs.sh/f/full-key";
        await doc("https://testapp.ufs.sh/f/full-key-suffix");
        await doc("https://foreignapp.ufs.sh/f/full-key");
        const id = (await objectPlan([url]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs =>
            refs.map(ref => ({ ref, outcome: "deleted" }))
        );
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("deleted");
    });

    it("uses ledger identity for an opaque external pointer target and deduplicates direct targets", async () => {
        const pointer = await externalPointer();
        const opaque = "https://legacy.example/opaque";
        await test.db
            .update(fileUploads)
            .set({ storageUrl: opaque })
            .where(eq(fileUploads.id, pointer.id));
        await test.db
            .update(storageObjects)
            .set({ url: opaque })
            .where(eq(storageObjects.adapter, "vercel-blob"));
        const id = (await objectPlan([pointer.url, opaque]))!;
        expect((await items(id)).map(item => item.sourceUrl).sort()).toEqual(
            [opaque, pointer.url].sort()
        );
        expect((await items(id)).find(item => item.sourceUrl === opaque)).toMatchObject({
            adapter: "vercel-blob",
            objectKey: "pointer-bytes",
        });
        await processStorageDeletionRequest(id);
        expect((await items(id)).every(item => item.state === "deleted")).toBe(true);
    });

    it("retains provider bytes used through a different shared pointer", async () => {
        const pointer = await externalPointer();
        const shared = await file();
        await test.db
            .update(fileUploads)
            .set({
                storageProvider: "vercel-blob",
                storageUrl: pointer.providerUrl,
                fileData: null,
            })
            .where(eq(fileUploads.id, shared.id));
        await doc(shared.url);
        const id = (await objectPlan([pointer.url]))!;
        await processStorageDeletionRequest(id);
        expect(
            (await items(id)).find(item => item.sourceUrl === pointer.providerUrl)
        ).toMatchObject({ state: "retained" });
        expect((await items(id)).find(item => item.sourceUrl === pointer.url)).toMatchObject({
            state: "deleted",
        });
        expect((await test.db.select().from(fileUploads)).map(row => row.id)).toEqual([shared.id]);
    });

    it("does not overwrite other concurrent blocked outcomes with provider success", async () => {
        const id = (await objectPlan(["https://store.public.blob.vercel-storage.com/unshared"]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
            await test.db
                .update(storageDeletionItems)
                .set({ state: "blocked", errorCode: "foreign_object" })
                .where(eq(storageDeletionItems.requestId, id));
            return refs.map(ref => ({ ref, outcome: "deleted" }));
        });
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({
            state: "blocked",
            errorCode: "foreign_object",
            attempts: 0,
        });
    });

    it.each(["foreign", "unstamped"] as const)(
        "preserves file ownership checks for historical audio URLs: %s",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Audio owner", numberOfEmployees: "1" })
                .returning();
            const bytes = await file(kind === "foreign" ? BigInt(other!.id) : null);
            const audioUrl = `http://localhost:3000/api/files/00${bytes.id}?download=1`;
            const transcript = await doc("https://example.org/transcript", { audioUrl });
            await test.db.transaction(tx => deleteDocumentCore(tx, transcript.id, context));
            const [row] = await test.db.select().from(storageDeletionRequests);
            const candidate = (await items(row!.id)).find(item => item.sourceUrl === audioUrl)!;
            expect(candidate).toMatchObject({ adapter: "database", objectKey: String(bytes.id) });
            await processStorageDeletionRequest(row!.id);
            expect((await items(row!.id)).find(item => item.id === candidate.id)).toMatchObject({
                state: "blocked",
                errorCode: "foreign_object",
            });
            expect(deleteStoredObjects).not.toHaveBeenCalled();
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
        }
    );
    it("records unrecognized external pointer URLs without inventing a blocked null ref", async () => {
        const bytes = await file();
        const external = "https://external.example/not-an-object";
        await test.db
            .update(fileUploads)
            .set({
                companyId: null,
                storageProvider: "s3",
                storageUrl: external,
            })
            .where(eq(fileUploads.id, bytes.id));
        const id = (await objectPlan([bytes.url]))!;
        expect((await items(id)).find(item => item.sourceUrl === external)).toMatchObject({
            state: "skipped",
            adapter: null,
            errorCode: "unrecognized",
        });
        await processStorageDeletionRequest(id);
        expect((await request(id)).status).toBe("blocked");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });
    it.each(["canonical", "legacy-origin"] as const)(
        "retains a deleted document's bytes used by a session attachment: %s",
        async kind => {
            const bytes = await file();
            const source = await doc(bytes.url);
            await test.db.insert(workspaceSessions).values({
                id: "chat",
                companyId,
                userId: "user:test",
                title: "Retain attachments",
            });
            await test.db.insert(workspaceSessionMessages).values({
                sessionId: "chat",
                seq: 1,
                role: "user",
                text: "Ask again",
                attachments: [
                    {
                        url:
                            kind === "canonical"
                                ? bytes.url
                                : `http://localhost:3000/api/files/00${bytes.id}`,
                        filename: "original.txt",
                    },
                ],
            });
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            const [row] = await test.db.select().from(storageDeletionRequests);
            await processStorageDeletionRequest(row!.id);
            expect((await items(row!.id))[0]!.state).toBe("retained");
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );
    it.each([
        ["metadata", "canonical"],
        ["metadata", "legacy-origin"],
        ["queue", "canonical"],
        ["queue", "legacy-origin"],
    ] as const)("retains bytes kept only in chat %s with %s URL", async (owner, form) => {
        const bytes = await file();
        const source = await doc(bytes.url);
        const send = {
            text: "Ask again",
            refs: [],
            webSearch: false,
            thinking: false,
            agentKey: null,
            attachments: [
                {
                    id: "attachment",
                    name: "original.txt",
                    mimeType: "text/plain",
                    size: 5,
                    kind: "text" as const,
                    url:
                        form === "canonical"
                            ? bytes.url
                            : `http://localhost:3000/api/files/${bytes.id}`,
                },
            ],
        };
        await test.db.insert(workspaceSessions).values({
            id: "chat",
            companyId,
            userId: "user:test",
            title: "Saved chat controls",
            queuedMessages: owner === "queue" ? [{ id: "queued", send }] : [],
        });
        if (owner === "metadata")
            await test.db.insert(workspaceSessionMessages).values({
                sessionId: "chat",
                seq: 1,
                role: "user",
                text: "Ask again",
                metadata: { send },
            });
        await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
        const [row] = await test.db.select().from(storageDeletionRequests);
        await processStorageDeletionRequest(row!.id);
        expect((await items(row!.id))[0]!.state).toBe("retained");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it.each(["document", "version", "preview", "version-preview", "job", "batch"] as const)(
        "recovers any-origin database refs in %s and enforces ownership",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Foreign", numberOfEmployees: "1" })
                .returning();
            const own = await file();
            const foreign = await file(BigInt(other!.id));
            const source = await doc("https://example.org/owner");
            const ownUrl = `https://historical.example/api/files/00${own.id}`;
            const foreignUrl = `https://historical.example/api/files/00${foreign.id}?download=1`;
            if (kind === "document")
                await test.db
                    .update(document)
                    .set({ url: ownUrl, ocrMetadata: { websitePreview: { url: foreignUrl } } })
                    .where(eq(document.id, source.id));
            if (kind === "preview")
                await test.db
                    .update(document)
                    .set({ url: foreignUrl, ocrMetadata: { websitePreview: { url: ownUrl } } })
                    .where(eq(document.id, source.id));
            if (kind === "version" || kind === "version-preview")
                await test.db.insert(documentVersions).values({
                    documentId: BigInt(source.id),
                    versionNumber: 1,
                    mimeType: "text/plain",
                    url: kind === "version" ? ownUrl : foreignUrl,
                    ocrMetadata: {
                        websitePreview: { url: kind === "version" ? foreignUrl : ownUrl },
                    },
                });
            if (kind === "job") {
                for (const [index, url] of [ownUrl, foreignUrl].entries())
                    await test.db.insert(ocrJobs).values({
                        id: `historical-${index}`,
                        companyId,
                        userId: "user:test",
                        documentId: BigInt(source.id),
                        documentName: "Historical",
                        documentUrl: url,
                    });
            }
            if (kind === "batch") {
                await test.db
                    .insert(uploadBatches)
                    .values({ id: "historical", companyId, createdByUserId: "user:test" });
                for (const url of [ownUrl, foreignUrl])
                    await test.db.insert(uploadBatchFiles).values({
                        batchId: "historical",
                        companyId,
                        userId: "user:test",
                        documentId: BigInt(source.id),
                        filename: "Historical",
                        storageUrl: url,
                        status: "complete",
                    });
            }
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            const [planned] = await test.db.select().from(storageDeletionRequests);
            expect(
                (await items(planned!.id)).find(item => item.sourceUrl === ownUrl)
            ).toMatchObject({ adapter: "database", objectKey: String(own.id) });
            await processStorageDeletionRequest(planned!.id);
            expect(
                (await items(planned!.id)).find(item => item.sourceUrl === ownUrl)
            ).toMatchObject({ state: "deleted" });
            expect(
                (await items(planned!.id)).find(item => item.sourceUrl === foreignUrl)
            ).toMatchObject({ state: "blocked", errorCode: "foreign_object" });
        }
    );

    it.each(["foreign", "unstamped"] as const)(
        "rechecks %s pointer provenance after forced requeue",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Pointer owner", numberOfEmployees: "1" })
                .returning();
            const pointer = await externalPointer(kind === "foreign" ? BigInt(other!.id) : null);
            const id = (await objectPlan([pointer.url]))!;
            const provider = (await items(id)).find(
                item => item.sourceUrl === pointer.providerUrl
            )!;
            expect(provider).toMatchObject({ state: "blocked", errorCode: "foreign_object" });
            await test.db
                .update(storageDeletionItems)
                .set({ state: "pending", errorCode: null })
                .where(eq(storageDeletionItems.id, provider.id));
            await processStorageDeletionRequest(id);
            expect((await items(id)).find(item => item.id === provider.id)).toMatchObject({
                state: "blocked",
                errorCode: "foreign_object",
                attempts: 0,
            });
            expect(deleteStoredObjects).not.toHaveBeenCalled();
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
        }
    );

    it.each(["deleted", "not_found"] as const)(
        "removes same-company S3 pointers after confirmed %s",
        async outcome => {
            const url = "http://s3:8333/files/dangling-object";
            const pointer = await file();
            await test.db
                .update(fileUploads)
                .set({ storageProvider: "s3", storageUrl: url, fileData: null })
                .where(eq(fileUploads.id, pointer.id));
            const id = (await objectPlan([url]))!;
            jest.mocked(deleteStoredObjects).mockImplementation(async refs =>
                refs.map(ref => ({ ref, outcome }))
            );
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]).toMatchObject({ state: outcome });
            expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        }
    );

    it("retains mixed-encoded legacy provider bytes through a database pointer", async () => {
        const pointer = await file();
        await test.db
            .update(fileUploads)
            .set({
                storageProvider: "s3",
                storageUrl: "https://objects.example/files/a%2Fb%2Epdf",
                fileData: null,
            })
            .where(eq(fileUploads.id, pointer.id));
        await doc(`https://old.example/api/files/00${pointer.id}`);
        const id = (await objectPlan(["http://s3:8333/files/a/b.pdf"]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({ state: "retained" });
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("surfaces missing and dead delivery as operationally blocked", async () => {
        const id = (await objectPlan([(await file()).url]))!;
        expect(await storageDeletionOperationalState(test.db, await request(id))).toEqual({
            status: "pending",
            errorCode: null,
        });
        await test.db
            .update(eventOutbox)
            .set({ status: "dead" })
            .where(eq(eventOutbox.eventId, `storage.deletion.requested:${id}`));
        expect(await storageDeletionOperationalState(test.db, await request(id))).toEqual({
            status: "blocked",
            errorCode: "event_dead",
        });
        await test.db.delete(company).where(eq(company.id, Number(companyId)));
        expect(await test.db.select().from(eventOutbox)).toHaveLength(0);
        expect(await storageDeletionOperationalState(test.db, await request(id))).toEqual({
            status: "blocked",
            errorCode: "event_missing",
        });
    });

    it("uses indexes for extracted file ids and exact provider pointer lookup", async () => {
        await test.db.execute(sql`
            INSERT INTO pdr_ai_v2_document(company_id, title, category, url)
            SELECT ${companyId}, 'explain', 'Test', 'https://old.example/api/files/' || n FROM generate_series(1, 20000) n;
        `);
        await test.db.execute(sql`
            INSERT INTO pdr_ai_v2_file_uploads(user_id, company_id, filename, mime_type, file_size, storage_provider, storage_url)
            SELECT 'user:test', ${companyId}, 'explain', 'text/plain', 5, 's3', 'http://s3:8333/files/object-' || n FROM generate_series(1, 20000) n;
        `);
        await test.db.execute(sql`ANALYZE pdr_ai_v2_document`);
        await test.db.execute(sql`ANALYZE pdr_ai_v2_file_uploads`);
        const statements: { query: SQL; text: string }[] = [];
        // Capture real emitted SQL while retaining the real executor.
        const execute = jest.spyOn(test.db, "execute");
        const retained = await findReferencedStorageObjects(
            test.db,
            [{ id: "database", ref: ref(19999), urls: ["/api/files/19999"], ledgered: true }],
            [],
            true
        );
        await findStorageObjectPointers(test.db, [
            {
                id: "pointer",
                ref: {
                    adapter: "s3",
                    storageLocationId: "s3:http://s3:8333@files",
                    key: "object-19999",
                },
                urls: ["http://s3:8333/files/object-19999"],
                ledgered: true,
            },
        ]);
        for (const [query] of execute.mock.calls) {
            if (typeof query !== "string") {
                statements.push({
                    query: query.getSQL(),
                    text: new PgDialect().sqlToQuery(query.getSQL()).sql,
                });
            }
        }
        execute.mockRestore();
        const databaseQuery = statements.find(statement => statement.text.includes("regexp_match"));
        const pointerQuery = statements.find(statement => statement.text.includes("AS pointer_id"));
        expect(databaseQuery).toBeDefined();
        expect(pointerQuery).toBeDefined();
        for (const [path, statement, indexName] of [
            ["database", databaseQuery!, "document_file_id_idx"],
            ["pointer", pointerQuery!, "file_uploads_storage_url_idx"],
        ] as const) {
            const plan = await test.db.execute<{ "QUERY PLAN": string }>(
                sql`EXPLAIN (COSTS OFF) ${statement.query}`
            );
            const output = plan.map(row => row["QUERY PLAN"]).join("\n");
            console.info(`[storage-deletion emitted EXPLAIN ${path}]\n${output}`);
            expect(output).toContain(indexName);
            expect(output).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
            // Empty protected tables may correctly choose sequential scans.
            expect(output).not.toMatch(/Seq Scan on pdr_ai_v2_(document|file_uploads)\b/);
        }
        expect(retained.has("database")).toBe(true);
    });

    it("preserves mixed-encoded historical references to backfilled ledger objects", async () => {
        const canonical = "http://s3:8333/files/history/object.pdf";
        await test.db.insert(storageObjects).values({
            adapter: "s3",
            storageLocationId: "s3:http://s3:8333@files",
            objectKey: "history/object.pdf",
            url: canonical,
            companyId,
            source: "backfill-file-uploads",
        });
        await doc("https://objects.example/files/hist%6Fry%2Fobject%2epdf");
        const id = (await objectPlan([canonical]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({ state: "retained" });
        expect(deleteStoredObjects).not.toHaveBeenCalled();
    });

    it("runs one legacy protected-source scan for all request items", async () => {
        const urls = ["http://s3:8333/files/one.pdf", "http://s3:8333/files/two.pdf"];
        await doc("https://objects.example/files/%6Fne.pdf");
        await doc("https://objects.example/files/tw%6F.pdf");
        const id = (await objectPlan(urls))!;
        const execute = jest.spyOn(test.db, "execute");
        try {
            await processStorageDeletionRequest(id);
            const scans = execute.mock.calls.filter(([query]) => {
                const text =
                    typeof query === "string"
                        ? query
                        : new PgDialect().sqlToQuery(query.getSQL()).sql;
                return text.includes("storage-reference legacy batch");
            });
            expect(scans).toHaveLength(1);
            expect((await items(id)).map(item => item.state)).toEqual(["retained", "retained"]);
        } finally {
            execute.mockRestore();
        }
    });

    it.each(["dot", "encoded", "prefix", "backslash", "whitespace", "first-match"] as const)(
        "retains a historical normalization-aware database avatar: %s",
        async form => {
            const bytes = await file();
            const url =
                form === "dot"
                    ? `/api/files/unused/../${bytes.id}`
                    : form === "encoded"
                      ? `/api/files/unused/%2e%2e/${bytes.id}`
                      : form === "prefix"
                        ? `/api/./files/${bytes.id}`
                        : form === "backslash"
                          ? `\\api\\files\\${bytes.id}`
                          : form === "whitespace"
                            ? ` /api/fi\tles/${bytes.id} `
                            : `/api/files/999/../../../api/files/${bytes.id}`;
            await test.db.insert(collabAgentPersona).values({
                id: "alias-persona",
                companyId,
                key: "test",
                displayName: "Alias",
                role: "Test",
                systemPrompt: "Test",
                avatarUrl: url,
            });
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it.each(["api/files/", "./api/files/"])(
        "retains a live same-company document with historical path-relative URL %s",
        async prefix => {
            const bytes = await file();
            await doc(`${prefix}${bytes.id}`);
            const candidates = [
                { id: "relative", ref: ref(bytes.id), urls: [bytes.url], ledgered: true },
            ];
            expect(await findReferencedStorageObjects(test.db, candidates, [])).toEqual(
                new Set(["relative"])
            );
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
            expect(await test.db.select().from(fileUploads)).toHaveLength(1);
        }
    );

    it.each(["api/files/", "./api/files/"])(
        "does not let a foreign-company path-relative document URL %s pin bytes",
        async prefix => {
            const bytes = await file();
            const [other] = await test.db
                .insert(company)
                .values({ name: "Relative foreign ref", numberOfEmployees: "1" })
                .returning();
            await doc(`${prefix}${bytes.id}`, null, BigInt(other!.id));
            const candidates = [
                { id: "relative", ref: ref(bytes.id), urls: [bytes.url], ledgered: true },
            ];
            expect(await findReferencedStorageObjects(test.db, candidates, [])).toEqual(new Set());
            expect(await findReferencedStorageObjects(test.db, candidates, [], true)).toEqual(
                new Set()
            );
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("deleted");
            expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        }
    );

    it("retains a historical URL normalized by trimming a trailing control character", async () => {
        const bytes = await file();
        await doc(`${bytes.url}\u0001`);
        const id = (await objectPlan([bytes.url]))!;
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]!.state).toBe("retained");
        expect(deleteStoredObjects).not.toHaveBeenCalled();
        expect(await test.db.select().from(fileUploads)).toHaveLength(1);
    });

    it("keeps historical chat array scans request-wide while refreshing canonical containment", async () => {
        const bytes = await file();
        await test.db.insert(workspaceSessions).values({
            id: "bounded-chat",
            companyId,
            userId: "user:test",
            title: "Bounded chat scan",
        });
        await test.db.insert(workspaceSessionMessages).values({
            sessionId: "bounded-chat",
            seq: 0,
            role: "user",
            text: "Replay",
            attachments: [{ url: `https://old.example/api/files/00${bytes.id}` }],
        });
        const candidates = [{ id: "chat", ref: ref(bytes.id), urls: [bytes.url], ledgered: true }];
        expect(await findReferencedStorageObjects(test.db, candidates, [])).toEqual(
            new Set(["chat"])
        );
        const execute = jest.spyOn(test.db, "execute");
        try {
            expect(await findReferencedStorageObjects(test.db, candidates, [], true)).toEqual(
                new Set()
            );
            const statements = execute.mock.calls.map(([query]) =>
                typeof query === "string" ? query : new PgDialect().sqlToQuery(query.getSQL()).sql
            );
            expect(statements.some(statement => statement.includes("regexp_match"))).toBe(true);
            expect(statements.some(statement => statement.includes("@>"))).toBe(true);
            expect(statements.join("\n")).not.toContain("jsonb_array_elements");
        } finally {
            execute.mockRestore();
        }
        await test.db
            .update(workspaceSessionMessages)
            .set({ attachments: [{ url: bytes.url }] })
            .where(eq(workspaceSessionMessages.sessionId, "bounded-chat"));
        expect(await findReferencedStorageObjects(test.db, candidates, [], true)).toEqual(
            new Set(["chat"])
        );
    });

    it.each(["2147483648", "99999999999", "9007199254740992", "9223372036854775808"])(
        "deletes a document with a nonexistent or unrepresentable external file id %s as skipped",
        async id => {
            const sourceUrl = `https://x.example/api/files/${id}`;
            const source = await doc(sourceUrl);
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            expect(await test.db.select().from(document)).toHaveLength(0);
            const [request] = await test.db.select().from(storageDeletionRequests);
            expect(await items(request!.id)).toEqual([
                expect.objectContaining({
                    sourceUrl,
                    state: "skipped",
                    errorCode: "unrecognized",
                    adapter: null,
                    objectKey: null,
                }),
            ]);
            await processStorageDeletionRequest(request!.id);
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it.each(["owned", "foreign", "unstamped"] as const)(
        "recovers an existing bigint file id on an any-origin URL with %s provenance",
        async kind => {
            const [other] = await test.db
                .insert(company)
                .values({ name: "Bigint owner", numberOfEmployees: "1" })
                .returning();
            const owner =
                kind === "owned" ? companyId : kind === "foreign" ? BigInt(other!.id) : null;
            const fileId = 99999999999;
            await test.db.insert(fileUploads).values({
                id: fileId,
                userId: "user:test",
                companyId: owner,
                filename: "bigint.txt",
                mimeType: "text/plain",
                fileSize: 5,
                fileData: "aGVsbG8=",
            });
            await recordStoredObject(test.db, {
                ref: ref(fileId),
                url: `/api/files/${fileId}`,
                companyId: owner,
                source: "upload-file",
            });
            const source = await doc(`https://x.example/api/files/${fileId}`);
            await test.db.transaction(tx => deleteDocumentCore(tx, source.id, context));
            const [request] = await test.db.select().from(storageDeletionRequests);
            expect((await items(request!.id))[0]).toMatchObject({
                adapter: "database",
                objectKey: String(fileId),
            });
            await processStorageDeletionRequest(request!.id);
            expect((await items(request!.id))[0]).toMatchObject({
                state: kind === "owned" ? "deleted" : "blocked",
                errorCode: kind === "owned" ? null : "foreign_object",
            });
            expect(await test.db.select().from(fileUploads)).toHaveLength(kind === "owned" ? 0 : 1);
        }
    );

    it.each(["direct", "pointer"] as const)(
        "retains a dot-segment legacy provider alias via %s",
        async kind => {
            const canonical = "http://s3:8333/files/a/b.pdf";
            const alias = "https://objects.example/files/a/unused/../b.pdf";
            if (kind === "direct") await doc(alias);
            else {
                const pointer = await file();
                await test.db
                    .update(fileUploads)
                    .set({ storageProvider: "s3", storageUrl: alias, fileData: null })
                    .where(eq(fileUploads.id, pointer.id));
                await doc(pointer.url);
            }
            const id = (await objectPlan([canonical]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it.each(["avatar", "attachment", "version", "job", "batch"] as const)(
        "does not let a foreign tenant pin database bytes with an any-origin %s alias",
        async kind => {
            const bytes = await file();
            const [other] = await test.db
                .insert(company)
                .values({ name: "Foreign ref", numberOfEmployees: "1" })
                .returning();
            const owner = BigInt(other!.id);
            const url = `https://external.example/api/files/${bytes.id}`;
            if (kind === "avatar")
                await test.db.insert(collabAgentPersona).values({
                    id: "foreign-persona",
                    companyId: owner,
                    key: "test",
                    displayName: "Foreign",
                    role: "Test",
                    systemPrompt: "Test",
                    avatarUrl: url,
                });
            if (kind === "attachment") {
                await test.db.insert(workspaceSessions).values({
                    id: "foreign-chat",
                    companyId: owner,
                    userId: "other",
                    title: "Foreign",
                });
                await test.db.insert(workspaceSessionMessages).values({
                    sessionId: "foreign-chat",
                    seq: 0,
                    role: "user",
                    text: "Remote",
                    attachments: [{ url }],
                });
            }
            if (kind === "version" || kind === "job") {
                const parent = await doc("https://example.org/owner", null, owner);
                if (kind === "version")
                    await test.db.insert(documentVersions).values({
                        documentId: BigInt(parent.id),
                        versionNumber: 1,
                        url,
                        mimeType: "text/plain",
                    });
                else
                    await test.db.insert(ocrJobs).values({
                        id: "foreign-job",
                        documentId: BigInt(parent.id),
                        companyId: owner,
                        userId: "other",
                        documentName: "Foreign",
                        documentUrl: url,
                        status: "queued",
                    });
            }
            if (kind === "batch") {
                await test.db
                    .insert(uploadBatches)
                    .values({ id: "foreign-batch", companyId: owner, createdByUserId: "other" });
                await test.db.insert(uploadBatchFiles).values({
                    batchId: "foreign-batch",
                    companyId: owner,
                    userId: "other",
                    filename: "Remote",
                    storageUrl: url,
                });
            }
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("deleted");
            expect(await test.db.select().from(fileUploads)).toHaveLength(0);
        }
    );

    it("rechecks indexed references created after the request-wide scan", async () => {
        const urls = ["http://s3:8333/files/first", "http://s3:8333/files/second"];
        for (const url of urls)
            await recordStoredObject(test.db, {
                ref: {
                    adapter: "s3",
                    storageLocationId: "s3:http://s3:8333@files",
                    key: url.split("/").at(-1)!,
                },
                url,
                companyId,
                source: "upload-file",
            });
        const id = (await objectPlan(urls))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
            if (refs[0]!.key === "first") await doc(urls[1]!);
            return refs.map(ref => ({ ref, outcome: "deleted" }));
        });
        await processStorageDeletionRequest(id);
        expect((await items(id)).map(item => item.state)).toEqual(["deleted", "retained"]);
        expect(deleteStoredObjects).toHaveBeenCalledTimes(1);
    });

    it("rechecks extracted-id references created after the request-wide scan", async () => {
        const bytes = await file();
        const first = "http://s3:8333/files/first";
        await recordStoredObject(test.db, {
            ref: { adapter: "s3", storageLocationId: "s3:http://s3:8333@files", key: "first" },
            url: first,
            companyId,
            source: "upload-file",
        });
        const id = (await objectPlan([first, bytes.url]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
            if (refs[0]!.adapter === "s3") await doc(`https://old.example/api/files/00${bytes.id}`);
            return refs.map(ref => ({ ref, outcome: "deleted" }));
        });
        await processStorageDeletionRequest(id);
        expect((await items(id)).map(item => item.state)).toEqual(["deleted", "retained"]);
        expect(deleteStoredObjects).toHaveBeenCalledTimes(1);
    });

    it("maps 100 legacy candidates with constant-regex batches over populated pointers", async () => {
        await test.db.execute(sql`
            INSERT INTO pdr_ai_v2_file_uploads(user_id, company_id, filename, mime_type, file_size, storage_provider, storage_url)
            SELECT 'user:test', ${companyId}, 'legacy', 'text/plain', 5, 's3', 'https://objects.example/files/a/unused/../object-' || n || '.pdf'
            FROM generate_series(1, 4000) n
        `);
        const candidates: StorageReferenceCandidate[] = Array.from({ length: 100 }, (_, index) => ({
            id: String(index + 1),
            ref: {
                adapter: "s3",
                storageLocationId: "s3:http://s3:8333@files",
                key: `a/object-${index + 1}.pdf`,
            },
            urls: [`http://s3:8333/files/a/object-${index + 1}.pdf`],
            ledgered: false,
        }));
        const execute = jest.spyOn(test.db, "execute");
        try {
            const pointers = await findStorageObjectPointers(test.db, candidates);
            expect(pointers).toHaveLength(100);
            expect(new Set(pointers.map(pointer => pointer.id))).toEqual(
                new Set(candidates.map(candidate => candidate.id))
            );
            const queries = execute.mock.calls.flatMap(([query]) => {
                if (typeof query === "string") return [];
                const compiled = new PgDialect().sqlToQuery(query.getSQL());
                return compiled.sql.includes("storage-pointer legacy batch")
                    ? [{ query: query.getSQL(), ...compiled }]
                    : [];
            });
            expect(queries).toHaveLength(2);
            for (const query of queries) {
                expect(query.sql).not.toContain("candidate.key_pattern");
                expect(query.params).toHaveLength(1);
                const plan = await test.db.execute<{ "QUERY PLAN": string }>(
                    sql`EXPLAIN (COSTS OFF) ${query.query}`
                );
                const output = plan.map(row => row["QUERY PLAN"]).join("\n");
                console.info(`[storage-deletion emitted EXPLAIN legacy batch]\n${output}`);
                expect(output).toContain("Seq Scan on pdr_ai_v2_file_uploads");
                expect(output).not.toMatch(/Nested Loop|Join/);
            }
            await test.db.insert(document).values(
                candidates.map((candidate, index) => ({
                    companyId,
                    title: "Legacy",
                    category: "Test",
                    url: `https://objects.example/files/a/unused/../object-${index + 1}.pdf`,
                }))
            );
            const retained = await findReferencedStorageObjects(test.db, candidates, []);
            expect(retained).toEqual(new Set(candidates.map(candidate => candidate.id)));
            const directQueries = execute.mock.calls.flatMap(([query]) => {
                if (typeof query === "string") return [];
                const compiled = new PgDialect().sqlToQuery(query.getSQL());
                return compiled.sql.includes("storage-reference legacy batch")
                    ? [{ ...compiled, query: query.getSQL() }]
                    : [];
            });
            expect(directQueries).toHaveLength(2);
            for (const query of directQueries) {
                expect(query.sql).not.toContain("candidate.key_pattern");
                const patterns = [...query.sql.matchAll(/~\* \$(\d+)/g)].map(
                    match => query.params[Number(match[1]) - 1]
                );
                expect(new Set(patterns).size).toBe(1);
                const plan = await test.db.execute<{ "QUERY PLAN": string }>(
                    sql`EXPLAIN (COSTS OFF) ${query.query}`
                );
                const output = plan.map(row => row["QUERY PLAN"]).join("\n");
                console.info(`[storage-deletion emitted EXPLAIN legacy references]\n${output}`);
                expect(output).not.toContain("candidate.key_pattern");
            }
        } finally {
            execute.mockRestore();
        }
    }, 15_000);
});
