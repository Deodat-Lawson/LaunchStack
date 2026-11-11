import { eq, sql } from "drizzle-orm";
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

    it("snapshots owned document, version, job, batch and preview URLs without owning audio metadata", async () => {
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
            bytes
                .slice(0, 6)
                .map(byte => byte.url)
                .sort()
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
        expect((await test.db.select().from(fileUploads)).map(row => row.id).sort()).toEqual(
            bytes
                .slice(6)
                .map(byte => byte.id)
                .sort()
        );
        expect((await request(requests[0]!.id)).status).toBe("completed");
        expect((await items(requests[0]!.id)).every(item => item.state === "deleted")).toBe(true);
        const ledger = await test.db.select().from(storageObjects);
        expect(ledger.filter(row => row.deletedAt !== null)).toHaveLength(6);
        expect(ledger.filter(row => row.deletedAt === null)).toHaveLength(2);
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
            return id!;
        });
        expect((await items(id)).map(item => item.sourceUrl).sort()).toEqual(
            bytes.map(byte => byte.url).sort()
        );
        await processStorageDeletionRequest(id);
        // A job whose document remains live still protects its input bytes.
        expect((await items(id)).map(item => item.state)).toEqual([
            "deleted",
            "deleted",
            "retained",
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

    it.each(["preview", "audio", "version-preview", "brand", "job", "batch"])(
        "retains a live %s reference",
        async kind => {
            const bytes = await file();
            const source = await doc(
                "https://example.org/page",
                kind === "preview"
                    ? { websitePreview: { url: bytes.url } }
                    : kind === "audio"
                      ? { audioUrl: bytes.url }
                      : null
            );
            if (kind === "version-preview")
                await test.db.insert(documentVersions).values({
                    documentId: BigInt(source.id),
                    versionNumber: 1,
                    url: source.url,
                    mimeType: "text/plain",
                    ocrMetadata: { websitePreview: { url: bytes.url } },
                });
            if (kind === "brand")
                await test.db.insert(brandMedia).values({
                    id: "media",
                    companyId,
                    uploadedByUserId: "user:test",
                    storageUrl: bytes.url,
                    mimeType: "text/plain",
                    size: 5,
                });
            if (kind === "job")
                await test.db.insert(ocrJobs).values({
                    id: "live-job",
                    documentId: BigInt(source.id),
                    companyId,
                    userId: "user:test",
                    documentName: "Live",
                    documentUrl: bytes.url,
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
                    storageUrl: bytes.url,
                });
            }
            const id = (await objectPlan([bytes.url]))!;
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

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
        "resolves %s aliases by ref and retains alternate live spellings",
        async (_adapter, canonical, source, live, identity) => {
            await recordStoredObject(test.db, {
                ref: identity,
                url: canonical,
                companyId,
                source: "upload-file",
            });
            await doc(live);
            const id = (await objectPlan([source]))!;
            expect((await items(id))[0]!.storedObjectId).not.toBeNull();
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(deleteStoredObjects).not.toHaveBeenCalled();
        }
    );

    it("prefilters absolute database aliases by bounded numeric id, including leading zeros", async () => {
        const bytes = await file();
        const alias = `http://app:3000/api/files/00${bytes.id}/?download=1`;
        await doc(alias);
        await doc(`http://app:3000/api/files/${bytes.id}0?download=1`);
        const id = (await objectPlan([bytes.url]))!;
        const parser = jest.spyOn(storedUrl, "refFromStoredUrl");
        try {
            await processStorageDeletionRequest(id);
            expect((await items(id))[0]!.state).toBe("retained");
            expect(parser.mock.calls.map(call => call[0])).toEqual([alias]);
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
    it("prefilters S3 public-endpoint aliases with query strings before parsing live URLs", async () => {
        const key = "documents/93411647-cc8e-48aa-8ffa-a65904d5efe8.pdf";
        const canonical = `http://s3:8333/files/${key}`;
        const alias = `https://objects.example/files/${key}?download=1`;
        await recordStoredObject(test.db, {
            ref: { adapter: "s3", storageLocationId: "s3:http://s3:8333@files", key },
            url: canonical,
            companyId,
            source: "upload-file",
        });
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

    it("deleting a transcript never plans the recording document's audio bytes", async () => {
        const recordingBytes = await file();
        const transcriptBytes = await file();
        const recording = await doc(recordingBytes.url);
        const transcript = await doc(transcriptBytes.url, { audioUrl: recordingBytes.url });
        await test.db.transaction(tx => deleteDocumentCore(tx, transcript.id, context));
        const [row] = await test.db.select().from(storageDeletionRequests);
        expect((await items(row!.id)).map(item => item.sourceUrl)).toEqual([transcriptBytes.url]);
        await processStorageDeletionRequest(row!.id);
        expect((await test.db.select().from(document)).map(row => row.id)).toEqual([recording.id]);
        expect((await test.db.select().from(fileUploads)).map(row => row.id)).toEqual([
            recordingBytes.id,
        ]);
    });

    it("does not overwrite an item blocked while a network provider call is running", async () => {
        const id = (await objectPlan(["https://store.public.blob.vercel-storage.com/unshared"]))!;
        jest.mocked(deleteStoredObjects).mockImplementation(async refs => {
            await markStorageDeletionRequestDead(id);
            return refs.map(ref => ({ ref, outcome: "deleted" }));
        });
        await processStorageDeletionRequest(id);
        expect((await items(id))[0]).toMatchObject({
            state: "blocked",
            attempts: 0,
            errorCode: "retry_budget_exhausted",
        });
        expect((await request(id)).status).toBe("blocked");
    });
});
