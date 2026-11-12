import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import { company, fileUploads } from "@launchstack/store/schema";

import { uploadFile, StorageError } from "~/lib/storage";
import { storageObjects } from "~/server/db/schema/storage";
import {
    findStoredObjectsByRefs,
    findStoredObjectsByUrls,
    recordStoredObject,
    removeStoredObject,
    storedObjectRef,
} from "~/server/storage/ledger";
import type { ObjectRef } from "~/server/storage/object-ref";
import { refFromStoredUrl } from "~/server/storage/stored-url";
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
            NEXT_PUBLIC_S3_ENDPOINT: "https://s3.internal/objects/",
            S3_PUBLIC_ENDPOINT: "https://files.example/objects/",
            S3_BUCKET_NAME: "documents",
        },
        client: {},
    },
}));
jest.mock("~/server/storage/delete-objects", () => ({ deleteStoredObjects: jest.fn() }));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const ref: ObjectRef = {
    adapter: "s3",
    storageLocationId: "s3:https://objects.example@files",
    key: "documents/first.pdf",
};

describeDb("stored object ledger (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
    });
    beforeEach(async () => {
        // This suite owns a newly created, disposable database.
        // eslint-disable-next-line drizzle/enforce-delete-with-where
        await test.db.delete(storageObjects);
        // eslint-disable-next-line drizzle/enforce-delete-with-where
        await test.db.delete(fileUploads);
    });
    afterAll(async () => {
        await test?.close();
    });

    it("records the triple once, keeping the original metadata, including a null company", async () => {
        await recordStoredObject(test.db, {
            ref,
            url: "https://objects.example/first",
            companyId: null,
            source: "upload-file",
            contentType: "application/pdf",
            sizeBytes: 123,
            checksum: "first-hash",
        });
        await test.db.transaction(tx =>
            recordStoredObject(tx, {
                ref,
                url: "https://objects.example/replacement",
                companyId: 999,
                source: "vercel-blob",
            })
        );
        const rows = await test.db.select().from(storageObjects);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            url: "https://objects.example/first",
            companyId: null,
            source: "upload-file",
            contentType: "application/pdf",
            sizeBytes: 123,
            checksum: "first-hash",
            deletedAt: null,
        });
        expect(rows[0]!.createdAt).toBeInstanceOf(Date);
        expect(storedObjectRef(rows[0]!)).toEqual(ref);
    });

    it("finds exact URLs, deduplicates inputs, and accepts URLs exceeding btree tuple limits", async () => {
        const url = `https://objects.example/${randomBytes(6000).toString("hex")}`;
        await recordStoredObject(test.db, { ref, url, companyId: 123, source: "upload-file" });
        const rows = await findStoredObjectsByUrls(test.db, ["", url, url, `${url}?other=true`]);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.companyId).toBe(123n);
        expect(rows[0]!.url).toBe(url);
        expect(await findStoredObjectsByUrls(test.db, ["", "https://external.example"])).toEqual(
            []
        );
        expect(await findStoredObjectsByUrls(test.db, [])).toEqual([]);
    });

    it("matches all three ref fields rather than crossing adapter, location or key", async () => {
        const refs: ObjectRef[] = [
            ref,
            { ...ref, storageLocationId: "other-store" },
            { ...ref, key: "another-key" },
            { ...ref, adapter: "uploadthing" },
        ];
        for (const [index, item] of refs.entries()) {
            await recordStoredObject(test.db, {
                ref: item,
                url: `https://objects.example/${index}`,
                companyId: null,
                source: "upload-file",
            });
        }
        const rows = await findStoredObjectsByRefs(test.db, [ref, ref, refs[2]!]);
        expect(rows.map(storedObjectRef)).toEqual(expect.arrayContaining([ref, refs[2]]));
        expect(rows).toHaveLength(2);
        expect(await findStoredObjectsByRefs(test.db, [{ ...ref, key: "missing" }])).toEqual([]);
        expect(await findStoredObjectsByRefs(test.db, [])).toEqual([]);
        await removeStoredObject(test.db, ref);
        await removeStoredObject(test.db, ref);
        const remaining = await test.db.select().from(storageObjects);
        expect(remaining.map(storedObjectRef)).toEqual(expect.arrayContaining(refs.slice(1)));
        expect(remaining).toHaveLength(3);
    });

    it("keeps the inventory after the tenant is deleted", async () => {
        const [tenant] = await test.db
            .insert(company)
            .values({ name: "Ledger tenant", numberOfEmployees: "1" })
            .returning();
        const companyId = BigInt(tenant!.id);
        await recordStoredObject(test.db, {
            ref,
            url: "https://objects.example/tenant",
            companyId,
            source: "upload-file",
        });
        await test.db.delete(company).where(eq(company.id, tenant!.id));
        expect((await findStoredObjectsByRefs(test.db, [ref]))[0]!.companyId).toBe(companyId);
    });

    it("atomically stores database bytes with their numeric-id ref and returned URL", async () => {
        const bytes = Buffer.from("stored bytes");
        const result = await uploadFile({
            filename: "atomic.txt",
            data: bytes,
            userId: "ledger-user",
            contentType: "text/plain",
        });
        const uploads = await test.db.select().from(fileUploads);
        expect(uploads).toHaveLength(1);
        expect(Buffer.from(uploads[0]!.fileData!, "base64")).toEqual(bytes);
        expect(result.ref).toEqual({
            adapter: "database",
            storageLocationId: "database:file_uploads",
            key: String(uploads[0]!.id),
        });
        const rows = await findStoredObjectsByUrls(test.db, [result.url]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            companyId: null,
            source: "upload-file",
            sizeBytes: bytes.length,
            contentType: "text/plain",
        });
        expect(storedObjectRef(rows[0]!)).toEqual(result.ref);
        expect(refFromStoredUrl(result.url)).toEqual({ ok: true, ref: storedObjectRef(rows[0]!) });
    });

    it("rolls back file_uploads when the real ledger insert fails", async () => {
        await test.db.execute(
            sql`ALTER TABLE pdr_ai_v2_storage_objects ADD CONSTRAINT test_reject_upload CHECK (source <> 'upload-file')`
        );
        try {
            await expect(
                uploadFile({
                    filename: "must-rollback.txt",
                    data: Buffer.from("bytes"),
                    userId: "ledger-user",
                })
            ).rejects.toBeInstanceOf(StorageError);
            expect(await test.db.select().from(fileUploads)).toEqual([]);
            expect(await test.db.select().from(storageObjects)).toEqual([]);
        } finally {
            await test.db.execute(
                sql`ALTER TABLE pdr_ai_v2_storage_objects DROP CONSTRAINT test_reject_upload`
            );
        }
    });
});
