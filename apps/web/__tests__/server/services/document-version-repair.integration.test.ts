import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { eq, sql } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const coreDb = jest.requireActual<{ createDb: typeof createDb }>("@launchstack/core/db");
    const engineDb = databaseUrl
        ? coreDb.createDb({
              url: databaseUrl,
              maxConnections: 10,
          }).db
        : undefined;

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

import { createDb, type Db } from "@launchstack/core/db";
import {
    company as companyTable,
    document,
    documentContextChunks,
    documentMetadata,
    documentPreviews,
    documentRetrievalChunks,
    documentStructure,
    documentVersions,
} from "@launchstack/core/db/schema";
import { db } from "~/server/db";
import { backfill } from "../../../scripts/backfill-document-versions";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;
type TestDb = Db;

type RlmFixtureName =
    | "document_structure"
    | "document_context_chunks"
    | "document_retrieval_chunks"
    | "document_metadata"
    | "document_previews";

type RlmFixtureSeedContext = {
    documentId: bigint;
    versionId: bigint | null;
    ids: ReadonlyMap<RlmFixtureName, number>;
};

type RlmFixture = {
    name: RlmFixtureName;
    insert: (context: RlmFixtureSeedContext) => Promise<number>;
    readVersionId: (id: number) => Promise<bigint | null | undefined>;
};

function requiredFixtureId(ids: ReadonlyMap<RlmFixtureName, number>, name: RlmFixtureName) {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`Missing ${name} RLM fixture dependency`);
    return BigInt(id);
}

const rlmFixtures: readonly RlmFixture[] = [
    {
        name: "document_structure",
        insert: async ({ documentId, versionId }) => {
            const [row] = await db
                .insert(documentStructure)
                .values({
                    documentId,
                    versionId,
                    title: "Legacy root",
                    contentType: "section",
                })
                .returning({ id: documentStructure.id });
            if (!row) throw new Error("Failed to create structure RLM fixture");
            return row.id;
        },
        readVersionId: async id => {
            const [row] = await db
                .select({ versionId: documentStructure.versionId })
                .from(documentStructure)
                .where(eq(documentStructure.id, id));
            return row?.versionId;
        },
    },
    {
        name: "document_context_chunks",
        insert: async ({ documentId, versionId, ids }) => {
            const [row] = await db
                .insert(documentContextChunks)
                .values({
                    documentId,
                    versionId,
                    structureId: requiredFixtureId(ids, "document_structure"),
                    content: "Legacy context chunk",
                })
                .returning({ id: documentContextChunks.id });
            if (!row) throw new Error("Failed to create context-chunk RLM fixture");
            return row.id;
        },
        readVersionId: async id => {
            const [row] = await db
                .select({ versionId: documentContextChunks.versionId })
                .from(documentContextChunks)
                .where(eq(documentContextChunks.id, id));
            return row?.versionId;
        },
    },
    {
        name: "document_retrieval_chunks",
        insert: async ({ documentId, versionId, ids }) => {
            const [row] = await db
                .insert(documentRetrievalChunks)
                .values({
                    documentId,
                    versionId,
                    contextChunkId: requiredFixtureId(ids, "document_context_chunks"),
                    content: "Legacy retrieval chunk",
                })
                .returning({ id: documentRetrievalChunks.id });
            if (!row) throw new Error("Failed to create retrieval-chunk RLM fixture");
            return row.id;
        },
        readVersionId: async id => {
            const [row] = await db
                .select({ versionId: documentRetrievalChunks.versionId })
                .from(documentRetrievalChunks)
                .where(eq(documentRetrievalChunks.id, id));
            return row?.versionId;
        },
    },
    {
        name: "document_metadata",
        insert: async ({ documentId, versionId }) => {
            const [row] = await db
                .insert(documentMetadata)
                .values({ documentId, versionId })
                .returning({ id: documentMetadata.id });
            if (!row) throw new Error("Failed to create metadata RLM fixture");
            return row.id;
        },
        readVersionId: async id => {
            const [row] = await db
                .select({ versionId: documentMetadata.versionId })
                .from(documentMetadata)
                .where(eq(documentMetadata.id, id));
            return row?.versionId;
        },
    },
    {
        name: "document_previews",
        insert: async ({ documentId, versionId, ids }) => {
            const [row] = await db
                .insert(documentPreviews)
                .values({
                    documentId,
                    versionId,
                    sectionId: requiredFixtureId(ids, "document_context_chunks"),
                    structureId: requiredFixtureId(ids, "document_structure"),
                    previewType: "summary",
                    content: "Legacy preview",
                })
                .returning({ id: documentPreviews.id });
            if (!row) throw new Error("Failed to create preview RLM fixture");
            return row.id;
        },
        readVersionId: async id => {
            const [row] = await db
                .select({ versionId: documentPreviews.versionId })
                .from(documentPreviews)
                .where(eq(documentPreviews.id, id));
            return row?.versionId;
        },
    },
];

type SeededRlmFixture = {
    fixture: RlmFixture;
    id: number;
};

async function seedRlmFixtures(
    documentId: bigint,
    versionId: bigint | null
): Promise<readonly SeededRlmFixture[]> {
    const ids = new Map<RlmFixtureName, number>();
    const seededRows: SeededRlmFixture[] = [];
    for (const fixture of rlmFixtures) {
        const id = await fixture.insert({ documentId, versionId, ids });
        ids.set(fixture.name, id);
        seededRows.push({ fixture, id });
    }
    return seededRows;
}

const rlmCleanupTables = [
    "pdr_ai_v2_document_previews",
    "pdr_ai_v2_document_retrieval_chunks",
    "pdr_ai_v2_document_context_chunks",
    "pdr_ai_v2_document_structure",
    "pdr_ai_v2_document_metadata",
] as const;

const repairCloneTables = [
    "pdr_ai_v2_document",
    "pdr_ai_v2_document_versions",
    "pdr_ai_v2_ocr_jobs",
    ...rlmCleanupTables,
] as const;

const repairCloneVersionIndexes = [
    "doc_structure_version_id_idx",
    "doc_ctx_chunks_version_id_idx",
    "doc_ret_chunks_version_id_idx",
    "doc_metadata_version_id_idx",
    "doc_previews_version_id_idx",
] as const;

async function cleanupRlmRows(documentId: number): Promise<void> {
    for (const table of rlmCleanupTables) {
        await db.execute(
            sql`DELETE FROM ${sql.raw(table)} WHERE document_id = ${BigInt(documentId)}`
        );
    }
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitForRepairLock(observerDb: TestDb, lockHolderPid: number): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
        const waiting = await observerDb.db.execute(sql`
            SELECT activity.pid
            FROM pg_stat_activity AS activity
            WHERE activity.wait_event_type = 'Lock'
              AND activity.state = 'active'
              AND ${lockHolderPid} = ANY (pg_blocking_pids(activity.pid))
            LIMIT 1
        `);

        if (Array.isArray(waiting) && waiting.length > 0) return;
        await Promise.resolve();
    }

    throw new Error("document version repair never reached its row-lock wait");
}

type RepairRunner = readonly [string, (repairDb: TestDb) => Promise<void>];

const repairRunners: readonly RepairRunner[] = [
    ["TypeScript backfill", async () => backfill()],
    [
        "0017 SQL migration",
        async repairDb => {
            const migrationSql = await readFile(
                resolve(__dirname, "../../../drizzle/0017_document_version_repair.sql"),
                "utf8"
            );
            await repairDb.client.begin(async tx => {
                await tx.unsafe(migrationSql);
            });
        },
    ],
];

integrationDescribe("document version repair (database)", () => {
    let lockDb: TestDb | undefined;
    let observerDb: TestDb | undefined;
    let repairDb: TestDb | undefined;
    let companyId: number | undefined;
    let documentId: number | undefined;
    let extraDocumentId: number | undefined;

    beforeEach(async () => {
        if (!process.env.DATABASE_URL) return;

        lockDb = createDb({ url: process.env.DATABASE_URL, maxConnections: 1 });
        observerDb = createDb({ url: process.env.DATABASE_URL, maxConnections: 1 });
        repairDb = createDb({ url: process.env.DATABASE_URL, maxConnections: 1 });
        const suffix = randomUUID();
        const [companyRow] = await db
            .insert(companyTable)
            .values({
                name: `document-version-repair-test-${suffix}`,
                slug: `version-repair-${suffix.slice(0, 24)}`,
                numberOfEmployees: "1",
            })
            .returning({ id: companyTable.id });

        if (!companyRow) throw new Error("Failed to create repair integration-test company");
        companyId = companyRow.id;

        const [documentRow] = await db
            .insert(document)
            .values({
                url: "https://example.test/document.pdf",
                category: "integration",
                title: "Document version repair concurrency",
                companyId: BigInt(companyId),
                mimeType: null,
                fileType: null,
                creationKey: `repair-${suffix}`,
            })
            .returning({ id: document.id });

        if (!documentRow) throw new Error("Failed to create repair integration-test document");
        documentId = documentRow.id;

        const [v1] = await db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentId),
                versionNumber: 1,
                url: "https://example.test/document-v1.pdf",
                mimeType: "application/pdf",
            })
            .returning({ id: documentVersions.id });
        const [v2] = await db
            .insert(documentVersions)
            .values({
                documentId: BigInt(documentId),
                versionNumber: 2,
                url: "https://example.test/document-v2.pdf",
                mimeType: "application/pdf",
            })
            .returning({ id: documentVersions.id });

        if (!v1 || !v2) throw new Error("Failed to create repair integration-test versions");

        await db
            .update(document)
            .set({ currentVersionId: BigInt(v1.id) })
            .where(eq(document.id, documentId));
    });

    afterEach(async () => {
        await Promise.all([lockDb?.close(), observerDb?.close(), repairDb?.close()]);
        lockDb = undefined;
        observerDb = undefined;
        repairDb = undefined;

        for (const cleanupDocumentId of [documentId, extraDocumentId]) {
            if (cleanupDocumentId === undefined) continue;
            await cleanupRlmRows(cleanupDocumentId);
            await db
                .delete(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(cleanupDocumentId)));
            await db.delete(document).where(eq(document.id, cleanupDocumentId));
        }
        documentId = undefined;
        extraDocumentId = undefined;

        if (companyId !== undefined) {
            await db.delete(companyTable).where(eq(companyTable.id, companyId));
            companyId = undefined;
        }
    });

    it("0017 SQL migration creates absent RLM version columns and repairs a legacy clone", async () => {
        if (!repairDb || companyId === undefined) {
            throw new Error("DATABASE_URL is required for this integration test");
        }

        const cloneCompanyId = companyId;
        const migrationSql = await readFile(
            resolve(__dirname, "../../../drizzle/0017_document_version_repair.sql"),
            "utf8"
        );

        await repairDb.client.begin(async tx => {
            await tx.unsafe("SET LOCAL search_path TO pg_temp, public");

            for (const table of repairCloneTables) {
                await tx.unsafe(`DROP TABLE IF EXISTS pg_temp."${table}" CASCADE`);
            }
            for (const table of repairCloneTables) {
                await tx.unsafe(
                    `CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING DEFAULTS) ON COMMIT DROP`
                );
            }
            await tx.unsafe(`
                    CREATE UNIQUE INDEX "repair_clone_document_versions_unique"
                    ON "pdr_ai_v2_document_versions" ("document_id", "version_number")
                `);
            await tx.unsafe(`
                    CREATE UNIQUE INDEX "repair_clone_document_versions_id_unique"
                    ON "pdr_ai_v2_document_versions" ("id")
                `);
            for (const table of rlmCleanupTables) {
                await tx.unsafe(
                    `ALTER TABLE pg_temp."${table}" DROP COLUMN IF EXISTS "version_id" CASCADE`
                );
            }

            const missingColumns = await tx.unsafe<{ table_name: string }[]>(`
                    SELECT c.relname AS table_name
                    FROM pg_catalog.pg_class AS c
                    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
                    WHERE c.relnamespace = pg_my_temp_schema()
                      AND c.relname IN (
                          'pdr_ai_v2_document_structure',
                          'pdr_ai_v2_document_context_chunks',
                          'pdr_ai_v2_document_retrieval_chunks',
                          'pdr_ai_v2_document_metadata',
                          'pdr_ai_v2_document_previews'
                      )
                      AND a.attname = 'version_id'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                `);
            expect(missingColumns).toHaveLength(0);

            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document" (
                        "id",
                        "url",
                        "category",
                        "title",
                        "company_id",
                        "mime_type",
                        "file_type",
                        "current_version_id",
                        "creation_key"
                    )
                    VALUES (
                        900000001,
                        'https://example.test/legacy-clone.pdf',
                        'integration',
                        'Legacy clone',
                        ${cloneCompanyId},
                        NULL,
                        NULL,
                        NULL,
                        'legacy-version-repair-clone'
                    )
                `);
            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document_structure" (
                        "id",
                        "document_id",
                        "title",
                        "content_type"
                    )
                    VALUES (900000001, 900000001, 'Legacy root', 'section')
                `);
            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document_context_chunks" (
                        "id",
                        "document_id",
                        "structure_id",
                        "content"
                    )
                    VALUES (900000002, 900000001, 900000001, 'Legacy context chunk')
                `);
            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document_retrieval_chunks" (
                        "id",
                        "context_chunk_id",
                        "document_id",
                        "content"
                    )
                    VALUES (900000003, 900000002, 900000001, 'Legacy retrieval chunk')
                `);
            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document_metadata" ("id", "document_id")
                    VALUES (900000004, 900000001)
                `);
            await tx.unsafe(`
                    INSERT INTO "pdr_ai_v2_document_previews" (
                        "id",
                        "document_id",
                        "section_id",
                        "structure_id",
                        "preview_type",
                        "content"
                    )
                    VALUES (
                        900000005,
                        900000001,
                        900000002,
                        900000001,
                        'summary',
                        'Legacy preview'
                    )
                `);

            await tx.unsafe(migrationSql);
            await tx.unsafe(migrationSql);

            const [versionRow] = await tx.unsafe<{ id: string }[]>(`
                    SELECT "id"::text AS "id"
                    FROM "pdr_ai_v2_document_versions"
                    WHERE "document_id" = 900000001
                      AND "version_number" = 1
                `);
            if (!versionRow) throw new Error("Clone migration did not create a v1 version");

            const [repairedDocument] = await tx.unsafe<
                {
                    current_version_id: string | null;
                }[]
            >(`
                    SELECT "current_version_id"::text AS "current_version_id"
                    FROM "pdr_ai_v2_document"
                    WHERE "id" = 900000001
                `);
            expect(repairedDocument?.current_version_id).toBe(versionRow.id);

            const repairedRlmRows = await tx.unsafe<
                {
                    table_name: string;
                    version_id: string | null;
                }[]
            >(`
                    SELECT 'document_structure' AS table_name, "version_id"::text AS version_id
                    FROM "pdr_ai_v2_document_structure"
                    WHERE "id" = 900000001
                    UNION ALL
                    SELECT 'document_context_chunks', "version_id"::text
                    FROM "pdr_ai_v2_document_context_chunks"
                    WHERE "id" = 900000002
                    UNION ALL
                    SELECT 'document_retrieval_chunks', "version_id"::text
                    FROM "pdr_ai_v2_document_retrieval_chunks"
                    WHERE "id" = 900000003
                    UNION ALL
                    SELECT 'document_metadata', "version_id"::text
                    FROM "pdr_ai_v2_document_metadata"
                    WHERE "id" = 900000004
                    UNION ALL
                    SELECT 'document_previews', "version_id"::text
                    FROM "pdr_ai_v2_document_previews"
                    WHERE "id" = 900000005
                `);
            expect(repairedRlmRows).toHaveLength(rlmCleanupTables.length);
            expect(repairedRlmRows.map(row => row.table_name).sort()).toEqual(
                [
                    "document_context_chunks",
                    "document_metadata",
                    "document_previews",
                    "document_retrieval_chunks",
                    "document_structure",
                ].sort()
            );
            for (const row of repairedRlmRows) {
                expect(row.version_id).toBe(versionRow.id);
            }

            const columns = await tx.unsafe<
                {
                    table_name: string;
                    data_type: string;
                    is_nullable: string;
                }[]
            >(`
                    SELECT
                        c.relname AS table_name,
                        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                        CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
                    FROM pg_catalog.pg_class AS c
                    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
                    WHERE c.relnamespace = pg_my_temp_schema()
                      AND c.relname IN (
                          'pdr_ai_v2_document_structure',
                          'pdr_ai_v2_document_context_chunks',
                          'pdr_ai_v2_document_retrieval_chunks',
                          'pdr_ai_v2_document_metadata',
                          'pdr_ai_v2_document_previews'
                      )
                      AND a.attname = 'version_id'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                `);
            expect(columns).toHaveLength(rlmCleanupTables.length);
            expect(columns.map(row => row.table_name).sort()).toEqual([...rlmCleanupTables].sort());
            for (const column of columns) {
                expect(column.data_type).toBe("bigint");
                expect(column.is_nullable).toBe("YES");
            }

            const foreignKeys = await tx.unsafe<
                {
                    table_name: string;
                    delete_action: string;
                }[]
            >(`
                    SELECT source.relname AS table_name, constraint_row.confdeltype AS delete_action
                    FROM pg_catalog.pg_constraint AS constraint_row
                    JOIN pg_catalog.pg_class AS source
                        ON source.oid = constraint_row.conrelid
                    WHERE source.relnamespace = pg_my_temp_schema()
                      AND constraint_row.contype = 'f'
                      AND constraint_row.confrelid = to_regclass('"pdr_ai_v2_document_versions"')
                      AND constraint_row.conkey = ARRAY[
                          (
                              SELECT attnum
                              FROM pg_catalog.pg_attribute
                              WHERE attrelid = source.oid
                                AND attname = 'version_id'
                          )
                      ]::smallint[]
                `);
            expect(foreignKeys).toHaveLength(rlmCleanupTables.length);
            expect(foreignKeys.map(row => row.table_name).sort()).toEqual(
                [...rlmCleanupTables].sort()
            );
            for (const foreignKey of foreignKeys) {
                expect(foreignKey.delete_action).toBe("c");
            }

            const indexes = await tx.unsafe<
                {
                    table_name: string;
                    index_name: string;
                }[]
            >(`
                    SELECT table_row.relname AS table_name, index_row.relname AS index_name
                    FROM pg_catalog.pg_index AS index_catalog
                    JOIN pg_catalog.pg_class AS table_row
                        ON table_row.oid = index_catalog.indrelid
                    JOIN pg_catalog.pg_class AS index_row
                        ON index_row.oid = index_catalog.indexrelid
                    WHERE table_row.relnamespace = pg_my_temp_schema()
                      AND index_row.relnamespace = pg_my_temp_schema()
                      AND index_row.relname IN (
                          'doc_structure_version_id_idx',
                          'doc_ctx_chunks_version_id_idx',
                          'doc_ret_chunks_version_id_idx',
                          'doc_metadata_version_id_idx',
                          'doc_previews_version_id_idx'
                      )
                `);
            expect(indexes).toHaveLength(repairCloneVersionIndexes.length);
            expect(indexes.map(row => `${row.table_name}:${row.index_name}`).sort()).toEqual(
                [
                    "pdr_ai_v2_document_context_chunks:doc_ctx_chunks_version_id_idx",
                    "pdr_ai_v2_document_metadata:doc_metadata_version_id_idx",
                    "pdr_ai_v2_document_previews:doc_previews_version_id_idx",
                    "pdr_ai_v2_document_retrieval_chunks:doc_ret_chunks_version_id_idx",
                    "pdr_ai_v2_document_structure:doc_structure_version_id_idx",
                ].sort()
            );
        });
    }, 30_000);

    it.each(repairRunners)(
        "%s does not restore v1 over a concurrent pointer advance",
        async (_runnerName, runRepair) => {
            if (!lockDb || !observerDb || !repairDb || documentId === undefined) {
                throw new Error("DATABASE_URL is required for this integration test");
            }

            const versionRows = await db
                .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));
            const v2 = versionRows.find(row => row.versionNumber === 2);
            if (!v2) throw new Error("Failed to load v2 for repair integration test");

            const lockGate = createDeferred<void>();
            const readyGate = createDeferred<void>();
            let lockHolderPid: number | undefined;
            let lockTransaction: Promise<void> | undefined;
            let repairPromise: Promise<void> | undefined;

            try {
                lockTransaction = lockDb.db
                    .transaction(async tx => {
                        await tx.execute(sql`
                            SELECT id
                            FROM pdr_ai_v2_document
                            WHERE id = ${documentId}
                            FOR UPDATE
                        `);
                        const [lockHolderPidRow] = await tx.execute(sql<{ pid: number }>`
                            SELECT pg_backend_pid() AS pid
                        `);
                        const observedLockHolderPid = Number(lockHolderPidRow?.pid);
                        if (!Number.isInteger(observedLockHolderPid)) {
                            throw new Error("Failed to capture repair lock holder backend PID");
                        }
                        lockHolderPid = observedLockHolderPid;
                        readyGate.resolve(undefined);
                        await lockGate.promise;
                        await tx.execute(sql`
                            UPDATE pdr_ai_v2_document
                            SET current_version_id = ${BigInt(v2.id)}
                            WHERE id = ${documentId}
                        `);
                    })
                    .catch(error => {
                        readyGate.reject(error);
                        throw error;
                    });

                await readyGate.promise;
                if (lockHolderPid === undefined) {
                    throw new Error("Repair lock holder backend PID was not captured");
                }
                repairPromise = runRepair(repairDb);
                await waitForRepairLock(observerDb, lockHolderPid);
                lockGate.resolve(undefined);
                await repairPromise;
                await lockTransaction;
            } finally {
                readyGate.resolve(undefined);
                lockGate.resolve(undefined);
                await Promise.allSettled([
                    lockTransaction ?? Promise.resolve(),
                    repairPromise ?? Promise.resolve(),
                ]);
            }

            const [repairedDocument] = await db
                .select({ currentVersionId: document.currentVersionId })
                .from(document)
                .where(eq(document.id, documentId));

            expect(repairedDocument?.currentVersionId).toBe(BigInt(v2.id));
        },
        30_000
    );
    it.each(repairRunners)(
        "%s repairs a missing v1/current pointer and null-version RLM rows",
        async (_runnerName, runRepair) => {
            if (!repairDb || documentId === undefined) {
                throw new Error("DATABASE_URL is required for this integration test");
            }

            await db
                .update(document)
                .set({ currentVersionId: null, mimeType: null, fileType: null })
                .where(eq(document.id, documentId));
            await db
                .delete(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));
            const seededRlmRows = await seedRlmFixtures(BigInt(documentId), null);
            expect(seededRlmRows).toHaveLength(rlmFixtures.length);

            const [legacyDocument] = await db
                .select({ currentVersionId: document.currentVersionId })
                .from(document)
                .where(eq(document.id, documentId));
            const legacyVersions = await db
                .select({ id: documentVersions.id })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));
            expect(legacyDocument?.currentVersionId).toBeNull();
            expect(legacyVersions).toHaveLength(0);
            for (const { fixture, id } of seededRlmRows) {
                expect(await fixture.readVersionId(id)).toBeNull();
            }

            await runRepair(repairDb);

            const repairedVersions = await db
                .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));
            const v1 = repairedVersions.find(row => row.versionNumber === 1);
            if (!v1) throw new Error("Repair did not create a v1 version");

            const [repairedDocument] = await db
                .select({ currentVersionId: document.currentVersionId })
                .from(document)
                .where(eq(document.id, documentId));
            expect(repairedDocument?.currentVersionId).toBe(BigInt(v1.id));
            for (const { fixture, id } of seededRlmRows) {
                expect(await fixture.readVersionId(id)).toBe(BigInt(v1.id));
            }
        }
    );

    it.each(repairRunners)(
        "%s fails closed and rolls back when an RLM version link is unresolved",
        async (_runnerName, runRepair) => {
            if (!repairDb || companyId === undefined || documentId === undefined) {
                throw new Error("DATABASE_URL is required for this integration test");
            }

            await db
                .update(document)
                .set({ currentVersionId: null, mimeType: null, fileType: null })
                .where(eq(document.id, documentId));
            await db
                .delete(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));

            const [extraDocument] = await db
                .insert(document)
                .values({
                    url: "https://example.test/unresolved-document.pdf",
                    category: "integration",
                    title: "Unresolved document version repair reference",
                    companyId: BigInt(companyId),
                    mimeType: "application/pdf",
                    fileType: "pdf",
                    creationKey: `repair-unresolved-${randomUUID()}`,
                })
                .returning({ id: document.id });
            if (!extraDocument) throw new Error("Failed to create unresolved-reference document");
            extraDocumentId = extraDocument.id;

            const [extraVersion] = await db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(extraDocument.id),
                    versionNumber: 1,
                    url: "https://example.test/unresolved-document-v1.pdf",
                    mimeType: "application/pdf",
                })
                .returning({ id: documentVersions.id });
            if (!extraVersion) throw new Error("Failed to create unresolved-reference version");

            const unresolvedRlmRows = await seedRlmFixtures(
                BigInt(documentId),
                BigInt(extraVersion.id)
            );
            expect(unresolvedRlmRows).toHaveLength(rlmFixtures.length);

            for (const { fixture, id } of unresolvedRlmRows) {
                expect(await fixture.readVersionId(id)).toBe(BigInt(extraVersion.id));
            }

            await expect(runRepair(repairDb)).rejects.toThrow("document version repair incomplete");

            const [rolledBackDocument] = await db
                .select({ currentVersionId: document.currentVersionId })
                .from(document)
                .where(eq(document.id, documentId));
            const rolledBackPrimaryVersions = await db
                .select({ id: documentVersions.id })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(documentId)));
            const [rolledBackExtraDocument] = await db
                .select({ currentVersionId: document.currentVersionId })
                .from(document)
                .where(eq(document.id, extraDocument.id));

            expect(rolledBackDocument?.currentVersionId).toBeNull();
            expect(rolledBackPrimaryVersions).toHaveLength(0);
            for (const { fixture, id } of unresolvedRlmRows) {
                expect(await fixture.readVersionId(id)).toBe(BigInt(extraVersion.id));
            }
            expect(rolledBackExtraDocument?.currentVersionId).toBeNull();
        }
    );
});
