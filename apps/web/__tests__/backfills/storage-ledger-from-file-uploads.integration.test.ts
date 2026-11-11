jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));
jest.mock("~/env", () => ({
    env: {
        server: {
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.internal/objects/",
            S3_PUBLIC_ENDPOINT: "https://files.example/objects/",
            S3_BUCKET_NAME: "documents",
        },
        client: {},
    },
}));

import { runBackfill, type Backfill } from "@launchstack/store/backfills";
import { createDb, type Db } from "@launchstack/store/client";
import { company, dataBackfills, fileUploads } from "@launchstack/store/schema";
import { asc, eq } from "drizzle-orm";

import { BACKFILLS } from "~/server/backfills";
import { storageObjects } from "~/server/db/schema/storage";
import { recordStoredObject } from "~/server/storage/ledger";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

describeDb("2026-11-storage-ledger-from-file-uploads backfill (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    let handle: Db;
    let entry: Backfill;
    let companyId: bigint;
    let databaseFileId: number;
    const deletedAt = new Date("2026-01-01T00:00:00Z");

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(process.env.LAUNCHSTACK_TEST_DATABASE_URL!);
        url.pathname = `/${test.databaseName}`;
        handle = createDb({ url: url.toString(), maxConnections: 2 });
        entry = BACKFILLS.find(b => b.id === "2026-11-storage-ledger-from-file-uploads")!;
        const [workspace] = await test.db
            .insert(company)
            .values({
                name: "Ledger backfill",
                numberOfEmployees: "1",
            })
            .returning();
        companyId = BigInt(workspace!.id);
        const pointers = [
            {
                filename: "owned",
                storageProvider: "s3",
                storageUrl: "https://s3.internal/objects/documents/owned%20file.pdf",
            },
            {
                filename: "public",
                storageProvider: "s3",
                storageUrl: "https://files.example/objects/documents/public.pdf",
            },
            {
                filename: "database",
                storageProvider: "database",
                storageUrl: "https://old-app.example/api/files/999",
            },
            {
                filename: "existing",
                storageProvider: "s3",
                storageUrl: "https://files.example/objects/documents/existing.pdf",
            },
            {
                filename: "foreign",
                storageProvider: "s3",
                storageUrl: "https://s3.internal/objects/other-bucket/foreign.pdf",
            },
            { filename: "missing-url", storageProvider: "s3", storageUrl: null },
            {
                filename: "external",
                storageProvider: "s3",
                storageUrl: "https://external.example/file.pdf",
            },
            {
                filename: "wrong-adapter",
                storageProvider: "s3",
                storageUrl: "https://store.public.blob.vercel-storage.com/file.pdf",
            },
            {
                filename: "malformed",
                storageProvider: "s3",
                storageUrl: "https://s3.internal/objects/documents/bad%zz.pdf",
            },
            {
                filename: "unstamped-s3",
                storageProvider: "s3",
                storageUrl: "https://s3.internal/objects/documents/unstamped.pdf",
                companyId: null,
            },
            {
                filename: "unstamped-database",
                storageProvider: "database",
                storageUrl: null,
                companyId: null,
            },
            {
                filename: "other-provider",
                storageProvider: "vercel-blob",
                storageUrl: "https://store.public.blob.vercel-storage.com/file.pdf",
            },
        ];
        const files = await test.db
            .insert(fileUploads)
            .values(
                pointers.map(pointer => ({
                    userId: "ledger-backfill",
                    mimeType: "application/pdf",
                    fileSize: 123,
                    blobChecksum: "pointer-checksum",
                    companyId,
                    ...pointer,
                }))
            )
            .returning();
        databaseFileId = files.find(file => file.filename === "database")!.id;
        await recordStoredObject(test.db, {
            ref: {
                adapter: "s3",
                storageLocationId: "s3:https://s3.internal/objects@documents",
                key: "existing.pdf",
            },
            url: "https://s3.internal/objects/documents/existing.pdf",
            companyId: 999n,
            source: "upload-file",
            contentType: "text/plain",
            sizeBytes: 7,
            checksum: "original",
        });
        await test.db
            .update(storageObjects)
            .set({ deletedAt })
            .where(eq(storageObjects.objectKey, "existing.pdf"));
    });

    afterAll(async () => {
        await handle?.close();
        await test?.close();
    });

    it("supports read-only dry-run, persisted bounded resume, eligibility and insert-only replay", async () => {
        expect(entry).toBeDefined();
        expect(entry.requiresEngine).toBe(false);
        const logs: string[] = [];
        const opts = { batchSize: 2, log: (message: string) => logs.push(message) };
        const before = await test.db.select().from(storageObjects);
        expect(await runBackfill(handle, entry, { ...opts, dryRun: true })).toEqual({
            processed: 0,
            done: false,
        });
        expect(logs).toContain(`${entry.id}: dry run — 9 row(s) remaining`);
        expect(await test.db.select().from(storageObjects)).toEqual(before);
        expect(
            await test.db.select().from(dataBackfills).where(eq(dataBackfills.id, entry.id))
        ).toEqual([]);

        expect(await runBackfill(handle, entry, { ...opts, maxBatches: 1 })).toEqual({
            processed: 2,
            done: false,
        });
        const [checkpoint] = await test.db
            .select()
            .from(dataBackfills)
            .where(eq(dataBackfills.id, entry.id));
        expect(checkpoint).toMatchObject({ status: "running", processed: 2 });
        expect(checkpoint!.cursor).not.toBeNull();
        expect(await entry.estimate!({ db: test.db, cursor: checkpoint!.cursor })).toBe(7);
        expect(await runBackfill(handle, entry, opts)).toEqual({ processed: 9, done: true });

        const rows = await test.db
            .select()
            .from(storageObjects)
            .orderBy(asc(storageObjects.objectKey));
        expect(rows).toHaveLength(4);
        for (const [key, url, adapter] of [
            ["owned file.pdf", "https://s3.internal/objects/documents/owned%20file.pdf", "s3"],
            ["public.pdf", "https://files.example/objects/documents/public.pdf", "s3"],
            [String(databaseFileId), `/api/files/${databaseFileId}`, "database"],
        ]) {
            expect(rows.find(row => row.objectKey === key)).toMatchObject({
                adapter,
                objectKey: key,
                url,
                companyId,
                source: "backfill-file-uploads",
                storageLocationId:
                    adapter === "s3"
                        ? "s3:https://s3.internal/objects@documents"
                        : "database:file_uploads",
                contentType: "application/pdf",
                sizeBytes: 123,
                checksum: "pointer-checksum",
                deletedAt: null,
            });
        }
        expect(rows.find(row => row.objectKey === "existing.pdf")).toMatchObject({
            companyId: 999n,
            url: "https://s3.internal/objects/documents/existing.pdf",
            source: "upload-file",
            sizeBytes: 7,
            contentType: "text/plain",
            checksum: "original",
            deletedAt,
        });

        let result = await entry.step({ db: test.db, cursor: null, batchSize: 2 });
        while (result.cursor !== null) {
            expect(result.processed).toBeLessThanOrEqual(2);
            result = await entry.step({ db: test.db, cursor: result.cursor, batchSize: 2 });
        }
        expect(
            await test.db.select().from(storageObjects).orderBy(asc(storageObjects.objectKey))
        ).toEqual(rows);
        expect(await runBackfill(handle, entry, opts)).toEqual({ processed: 0, done: true });
    });
});
