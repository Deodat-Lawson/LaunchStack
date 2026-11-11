import type { S3Client } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { company, document, eventOutbox, fileUploads } from "@launchstack/store/schema";

import { env } from "~/env";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import {
    storageDeletionItems,
    storageDeletionRequests,
    storageObjects,
} from "~/server/db/schema/storage";
import { auditStorageOrphans } from "~/server/storage/audit";
import { planObjectDeletion } from "~/server/storage/deletion/plan";
import { getS3Client } from "~/server/storage/s3-client";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

jest.mock("~/env", () => ({
    env: {
        server: {
            NEXT_PUBLIC_S3_ENDPOINT: "http://s3:8333",
            S3_PUBLIC_ENDPOINT: "https://objects.example",
            S3_BUCKET_NAME: "files",
            S3_ACCESS_KEY: "test",
            S3_SECRET_KEY: "test",
        },
        client: {},
    },
}));
jest.mock("~/server/storage/s3-client", () => ({
    getS3Client: jest.fn(),
    getS3BucketName: () => "files",
    getObjectUrl: (key: string) => `http://s3:8333/files/${key}`,
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;
const old = new Date("2026-10-01T00:00:00Z");
const now = new Date("2026-11-10T00:00:00Z");

describeDb("storage orphan audit (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
    });
    beforeEach(async () => {
        await test.db.execute(
            sql`TRUNCATE ${company}, ${fileUploads}, ${storageObjects}, ${storageDeletionRequests}, ${eventOutbox} RESTART IDENTITY CASCADE`
        );
        const [tenant] = await test.db
            .insert(company)
            .values({ name: "Audit test", numberOfEmployees: "1" })
            .returning();
        companyId = BigInt(tenant!.id);
        jest.mocked(getS3Client).mockReset();
    });
    afterAll(async () => {
        await test?.close();
    });

    async function ledger(
        key: string,
        overrides: Partial<typeof storageObjects.$inferInsert> = {}
    ) {
        const [row] = await test.db
            .insert(storageObjects)
            .values({
                adapter: "s3",
                storageLocationId: "s3:http://s3:8333@files",
                objectKey: key,
                url: `http://s3:8333/files/${key}`,
                companyId,
                source: "upload-file",
                sizeBytes: 12,
                createdAt: old,
                ...overrides,
            })
            .returning();
        return row!;
    }
    async function doc(url: string, ocrMetadata: unknown = null) {
        await test.db.insert(document).values({
            companyId,
            url,
            ocrMetadata,
            title: "Live",
            category: "Test",
        });
    }
    async function legacyFile(createdAt = old, storageProvider = "database") {
        const [row] = await test.db
            .insert(fileUploads)
            .values({
                userId: "audit:test",
                companyId,
                filename: "legacy.txt",
                mimeType: "text/plain",
                fileSize: 5,
                fileData: "aGVsbG8=",
                createdAt,
                storageProvider,
            })
            .returning();
        return row!;
    }

    it("finds aged undeleted ledger rows and excludes exact live URLs, metadata, young and planned refs", async () => {
        const orphan = await ledger("documents/orphan");
        await ledger("documents/live");
        await doc("http://s3:8333/files/documents/live");
        await ledger("documents/preview");
        await ledger("documents/audio");
        await doc("https://external.example/page", {
            websitePreview: { url: "http://s3:8333/files/documents/preview" },
            audioUrl: "http://s3:8333/files/documents/audio",
        });
        await ledger("documents/young", { createdAt: now });
        await ledger("documents/deleted", { deletedAt: old });
        await ledger("documents/planned");
        const plannedId = await test.db.transaction(tx =>
            planObjectDeletion(tx, {
                companyId,
                requestedBy: "test",
                reason: "test",
                traceId: "test",
                urls: ["https://objects.example/files/documents/planned?alias=1"],
            })
        );
        // Canonical-ref protection must not depend on the optional ledger FK.
        await test.db
            .update(storageDeletionItems)
            .set({ storedObjectId: null })
            .where(eq(storageDeletionItems.requestId, plannedId!));
        const report = await auditStorageOrphans(test.db, { now, pageSize: 2 });
        expect(report.ledger).toMatchObject({ count: 1, bytes: 12, requestIds: [] });
        expect(report.ledger.sampleKeys).toEqual([
            {
                adapter: orphan.adapter,
                storageLocationId: orphan.storageLocationId,
                key: orphan.objectKey,
            },
        ]);
        expect(report.inventory.enabled).toBe(false);
        expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(1);
    });

    it("uses exact canonical ledger URLs rather than the legacy inventory alias fallback", async () => {
        await ledger("documents/ledger-alias");
        await doc("https://objects.example/files/documents/ledger-alias?download=1");
        const report = await auditStorageOrphans(test.db, { now });
        expect(report.ledger.count).toBe(1);
        expect(report.ledger.sampleKeys[0]?.key).toBe("documents/ledger-alias");
    });

    it("excludes active work by original URL or ledger id, not only ref", async () => {
        const byId = await ledger("documents/by-id");
        const byUrl = await ledger("documents/by-url");
        const [request] = await test.db
            .insert(storageDeletionRequests)
            .values({
                companyId,
                scope: "object",
                requestedBy: "test",
                reason: "test",
                traceId: "test",
                status: "blocked",
            })
            .returning();
        await test.db.insert(storageDeletionItems).values([
            {
                requestId: request!.id,
                storedObjectId: byId.id,
                sourceUrl: "unknown:id",
                state: "quarantined",
            },
            { requestId: request!.id, sourceUrl: byUrl.url, state: "quarantined" },
        ]);
        expect((await auditStorageOrphans(test.db, { now })).ledger.count).toBe(0);
    });

    it("keyset-pages all candidates while capping samples and aggregating bytes by location", async () => {
        for (let index = 0; index < 7; index++) await ledger(`documents/page-${index}`);
        const report = await auditStorageOrphans(test.db, { now, pageSize: 2, sampleLimit: 2 });
        expect(report.ledger).toMatchObject({ count: 7, bytes: 84, unknownSizeCount: 0 });
        expect(report.ledger.sampleKeys).toHaveLength(2);
        expect(report.ledger.groups).toEqual([
            {
                adapter: "s3",
                storageLocationId: "s3:http://s3:8333@files",
                source: "upload-file",
                count: 7,
                bytes: 84,
                unknownSizeCount: 0,
            },
        ]);
        expect(await test.db.select().from(eventOutbox)).toHaveLength(0);
    });

    it("enqueues only stamped ledger candidates through planner/outbox and does not duplicate repeat work", async () => {
        const candidate = await ledger("documents/enqueue");
        await ledger("documents/unstamped", { companyId: null });
        const report = await auditStorageOrphans(test.db, {
            now,
            enqueue: true,
            actor: "operator:test",
            pageSize: 1,
        });
        expect(report.ledger.count).toBe(2);
        expect(report.ledger.notEnqueueable).toEqual({
            count: 1,
            reason: "company_id is null; no tenant can be inferred",
        });
        expect(report.ledger.requestIds).toHaveLength(1);
        const [request] = await test.db.select().from(storageDeletionRequests);
        expect(request).toMatchObject({
            id: report.ledger.requestIds[0],
            companyId,
            scope: "object",
            reason: "orphan_audit",
            requestedBy: "operator:test",
        });
        const [item] = await test.db.select().from(storageDeletionItems);
        expect(item).toMatchObject({ storedObjectId: candidate.id, state: "pending" });
        expect(await test.db.select().from(eventOutbox)).toEqual([
            expect.objectContaining({
                eventType: "storage.deletion.requested",
                eventId: `storage.deletion.requested:${request!.id}`,
            }),
        ]);
        const repeat = await auditStorageOrphans(test.db, {
            now,
            enqueue: true,
            actor: "operator:test",
        });
        expect(repeat.ledger).toMatchObject({ count: 1, requestIds: [] });
        expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(1);
        expect(await test.db.select().from(storageObjects)).toHaveLength(2);
    });

    it("serializes concurrent enqueue audits and requires an explicit actor", async () => {
        await ledger("documents/concurrent");
        await expect(auditStorageOrphans(test.db, { now, enqueue: true })).rejects.toThrow("actor");
        const second = await test.createSession();
        try {
            const reports = await Promise.all([
                auditStorageOrphans(test.db, { now, enqueue: true, actor: "one" }),
                auditStorageOrphans(second.db, { now, enqueue: true, actor: "two" }),
            ]);
            expect(reports.flatMap(report => report.ledger.requestIds)).toHaveLength(1);
            expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(1);
        } finally {
            await second.close();
        }
    });

    it("scans legacy database uploads in keyset pages, ignoring ledger, live, young and non-database bytes", async () => {
        const orphan = await legacyFile();
        const referenced = await legacyFile();
        await doc(`http://app:3000/api/files/${referenced.id}?download=1`);
        const recorded = await legacyFile();
        await ledger(String(recorded.id), {
            adapter: "database",
            storageLocationId: "database:file_uploads",
            url: `/api/files/${recorded.id}`,
        });
        await legacyFile(now);
        await legacyFile(old, "s3");
        const orphan2 = await legacyFile();
        jest.mocked(getS3Client).mockReturnValue({
            send: jest.fn().mockResolvedValue({ Contents: [] }),
        } as unknown as S3Client);
        const report = await auditStorageOrphans(test.db, { now, inventory: true, pageSize: 1 });
        expect(report.inventory).toMatchObject({
            count: 2,
            bytes: 10,
            database: { status: "scanned" },
        });
        expect(report.inventory.sampleKeys.map(ref => ref.key)).toEqual([
            String(orphan.id),
            String(orphan2.id),
        ]);
        expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(0);
    });

    it("never enqueues unledgered inventory candidates even when enqueue and inventory are combined", async () => {
        const recorded = await ledger("documents/recorded-orphan");
        const legacy = await legacyFile();
        jest.mocked(getS3Client).mockReturnValue({
            send: jest.fn().mockResolvedValue({ Contents: [] }),
        } as unknown as S3Client);
        const report = await auditStorageOrphans(test.db, {
            now,
            inventory: true,
            enqueue: true,
            actor: "operator:test",
        });
        expect(report.ledger.requestIds).toHaveLength(1);
        expect(report.inventory.sampleKeys.map(ref => ref.key)).toEqual([String(legacy.id)]);
        const items = await test.db.select().from(storageDeletionItems);
        expect(items).toEqual([expect.objectContaining({ sourceUrl: recorded.url })]);
        expect(await test.db.select().from(fileUploads)).toHaveLength(1);
    });

    it("paginates S3 inventory and applies batched ledger, alias references and LastModified grace", async () => {
        await ledger("documents/recorded");
        await doc("https://objects.example/files/documents/referenced?download=1");
        const send = jest
            .fn()
            .mockResolvedValueOnce({
                Contents: [
                    { Key: "documents/orphan", Size: 20, LastModified: old },
                    { Key: "documents/recorded", Size: 12, LastModified: old },
                ],
                IsTruncated: true,
                NextContinuationToken: "page-two",
            })
            .mockResolvedValueOnce({
                Contents: [
                    { Key: "documents/referenced", Size: 30, LastModified: old },
                    { Key: "documents/young", Size: 40, LastModified: now },
                ],
                IsTruncated: true,
                NextContinuationToken: "page-three",
            })
            .mockResolvedValueOnce({
                Contents: [{ Key: "documents/unknown-age", Size: 50 }],
                IsTruncated: false,
            });
        jest.mocked(getS3Client).mockReturnValue({ send } as unknown as S3Client);
        const report = await auditStorageOrphans(test.db, { now, inventory: true, pageSize: 2 });
        expect(report.inventory).toMatchObject({ count: 2, bytes: 70, s3: { status: "scanned" } });
        expect(report.inventory.sampleKeys.map(ref => ref.key)).toEqual([
            "documents/orphan",
            "documents/unknown-age",
        ]);
        expect(send.mock.calls.map(([command]) => command.input)).toEqual([
            { Bucket: "files", Prefix: "documents/", MaxKeys: 2, ContinuationToken: undefined },
            { Bucket: "files", Prefix: "documents/", MaxKeys: 2, ContinuationToken: "page-two" },
            { Bucket: "files", Prefix: "documents/", MaxKeys: 2, ContinuationToken: "page-three" },
        ]);
    });

    it("reports S3 as not scanned when configuration is missing, rather than claiming an empty scan", async () => {
        const key = env.server.S3_ACCESS_KEY;
        env.server.S3_ACCESS_KEY = undefined;
        try {
            const report = await auditStorageOrphans(test.db, { now, inventory: true });
            expect(report.inventory.s3).toEqual({
                status: "not_scanned",
                reason: "S3 location or credentials are not configured",
            });
            expect(getS3Client).not.toHaveBeenCalled();
        } finally {
            env.server.S3_ACCESS_KEY = key;
        }
    });

    it.each(["attachments", "metadata", "queue"] as const)(
        "protects ledgered chat %s owners through the shared worker definition",
        async owner => {
            const object = await ledger(`documents/chat-${owner}`, { source: "chat-upload" });
            const send = {
                text: "Ask again",
                refs: [],
                webSearch: false,
                thinking: false,
                agentKey: null,
                attachments: [
                    {
                        id: "file",
                        name: "chat.txt",
                        mimeType: "text/plain",
                        size: 12,
                        kind: "text" as const,
                        url: object.url,
                    },
                ],
            };
            await test.db.insert(workspaceSessions).values({
                id: "audit-chat",
                companyId,
                userId: "audit:test",
                title: "Chat",
                queuedMessages: owner === "queue" ? [{ id: "queued", send }] : [],
            });
            if (owner !== "queue")
                await test.db.insert(workspaceSessionMessages).values({
                    sessionId: "audit-chat",
                    seq: 1,
                    role: "user",
                    text: "Ask again",
                    attachments:
                        owner === "attachments" ? [{ url: object.url, filename: "chat.txt" }] : [],
                    metadata: owner === "metadata" ? { send } : null,
                });
            expect((await auditStorageOrphans(test.db, { now })).ledger.count).toBe(0);
        }
    );

    it("protects historical any-origin database chat aliases even when ledgered", async () => {
        const bytes = await legacyFile();
        await ledger(String(bytes.id), {
            adapter: "database",
            storageLocationId: "database:file_uploads",
            url: `/api/files/${bytes.id}`,
        });
        await test.db
            .insert(workspaceSessions)
            .values({ id: "legacy-chat", companyId, userId: "audit:test", title: "Legacy" });
        await test.db.insert(workspaceSessionMessages).values({
            sessionId: "legacy-chat",
            seq: 1,
            role: "user",
            text: "Ask again",
            attachments: [
                {
                    url: `http://historical-host/api/files/00${bytes.id}?download=1`,
                    filename: "chat.txt",
                },
            ],
        });
        expect((await auditStorageOrphans(test.db, { now })).ledger.count).toBe(0);
    });

    it("protects provider bytes behind a live database pointer", async () => {
        const object = await ledger("documents/pointer");
        const pointer = await legacyFile(old, "s3");
        await test.db
            .update(fileUploads)
            .set({ storageUrl: object.url })
            .where(eq(fileUploads.id, pointer.id));
        await doc(`/api/files/${pointer.id}`);
        expect((await auditStorageOrphans(test.db, { now })).ledger.count).toBe(0);
    });

    it("groups ledger candidates by source as well as adapter and location", async () => {
        await ledger("documents/doc", { source: "upload-file" });
        await ledger("documents/chat", { source: "chat-upload" });
        const report = await auditStorageOrphans(test.db, { now });
        expect(report.ledger.groups.map(group => [group.source, group.count, group.bytes])).toEqual(
            [
                ["upload-file", 1, 12],
                ["chat-upload", 1, 12],
            ]
        );
    });

    it("requires at least one day of grace and a valid actor before enqueue", async () => {
        await expect(
            auditStorageOrphans(test.db, { enqueue: true, actor: "operator", graceDays: 0 })
        ).rejects.toThrow("at least 1 day");
        await expect(auditStorageOrphans(test.db, { graceDays: 0.5 })).rejects.toThrow("integer");
        await expect(
            auditStorageOrphans(test.db, { enqueue: true, actor: "x".repeat(257) })
        ).rejects.toThrow("1 to 256");
        expect(await test.db.select().from(storageDeletionRequests)).toHaveLength(0);
    });

    it("prints committed planner ids when a later CLI enqueue page fails", async () => {
        await test.db.insert(storageObjects).values(
            Array.from({ length: 501 }, (_, index) => ({
                adapter: "s3" as const,
                storageLocationId: "s3:http://s3:8333@files",
                objectKey: `documents/cli-${index}`,
                url: `http://s3:8333/files/documents/cli-${index}`,
                companyId,
                source: "upload-file",
                createdAt: old,
                sizeBytes: 1,
            }))
        );
        await test.db
            .execute(sql`CREATE FUNCTION reject_later_audit_page() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.source_url LIKE '%cli-500' THEN RAISE EXCEPTION 'later audit page rejected'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER reject_later_audit_page BEFORE INSERT ON ${storageDeletionItems} FOR EACH ROW EXECUTE FUNCTION reject_later_audit_page();`);
        try {
            const url = new URL(
                process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL!
            );
            url.pathname = `/${test.databaseName}`;
            const cli = spawnSync(
                "pnpm",
                [
                    "exec",
                    "tsx",
                    "scripts/storage-orphan-audit.ts",
                    "--enqueue",
                    "--actor",
                    " operator:cli ",
                    "--grace-days",
                    "7",
                ],
                {
                    cwd: join(__dirname, "../../.."),
                    encoding: "utf8",
                    timeout: 30_000,
                    env: {
                        ...process.env,
                        DATABASE_URL: url.toString(),
                        NEXT_PUBLIC_S3_ENDPOINT: "http://s3:8333",
                        S3_BUCKET_NAME: "files",
                        DOTENV_CONFIG_QUIET: "true",
                    },
                }
            );
            expect(cli.status).toBe(1);
            const output = JSON.parse(cli.stdout) as { committedRequestIds: number[] };
            const requests = await test.db.select().from(storageDeletionRequests);
            expect(requests).toHaveLength(1);
            expect(output.committedRequestIds).toEqual([requests[0]!.id]);
            expect(requests[0]!.requestedBy).toBe("operator:cli");
            expect(cli.stderr).toContain("committedRequestIds");
        } finally {
            await test.db.execute(
                sql`DROP TRIGGER reject_later_audit_page ON ${storageDeletionItems}; DROP FUNCTION reject_later_audit_page();`
            );
        }
    });
});
