/**
 * Integration tests for the document-creation lifecycle under the
 * transactional-outbox contract (ADR-003 §2): creating a document/version/job
 * and enqueueing the `source.version.created` event happen in ONE
 * transaction. Nothing dispatches post-commit anymore — the old
 * `triggerDocumentProcessing` (Inngest send) is gone, so these tests assert
 * against `pdr_ai_v2_event_outbox` rows instead of a dispatch mock:
 * - a new lifecycle leaves exactly one `pending` row keyed
 *   `source.version.created:<jobId>` whose payload carries the routing;
 * - converging on a live (pending/processing) event leaves it untouched;
 * - re-upload after a dead pipeline requeues the failed job and revives the
 *   dead/processed row to `pending` with a fresh attempt budget, all inside
 *   the same transaction (the post-commit CAS loop is gone);
 * - a converged completed job never revives its event.
 */
import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "@launchstack/store/client";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const actualDbModule =
        jest.requireActual<typeof import("@launchstack/store/client")>("@launchstack/store/client");
    const engineDb = databaseUrl ? actualDbModule.createDb({ url: databaseUrl }).db : undefined;
    // The lifecycle now reaches the database through the engine's getDb()
    // slot (ADR-003) rather than the ~/server/db proxy, so the slot must be
    // registered exactly like createEngine would.
    if (engineDb) actualDbModule.configureDatabase(engineDb);

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

import {
    company as companyTable,
    document,
    documentSections,
    documentVersions,
    eventOutbox,
    ocrJobs,
} from "@launchstack/store/schema";
import { eventIds, PROTOCOL_VERSION, type SourceVersionCreatedEvent } from "@launchstack/orchestration/pipeline-events";
import { db } from "~/server/db";
import { getDocumentChunks, RLMRetriever } from "~/lib/tools/rag/retrievers";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    type CreatedDocumentLifecycle,
    type CreatedDocumentVersionLifecycle,
} from "~/server/services/document-creation";

type LifecycleParams = Parameters<typeof createDocumentLifecycle>[0];
type Processing = NonNullable<LifecycleParams["processing"]>;

const CREATION_KEY_NAMESPACE = "launchstack:document-creation:v1:";

function persistedCreationKey(rawCreationKey: string): string {
    return createHash("sha256")
        .update(CREATION_KEY_NAMESPACE, "utf8")
        .update(rawCreationKey, "utf8")
        .digest("hex");
}

/** Unwraps the stored event envelope down to its lifecycle payload. */
function eventPayload(row: { payload: unknown }): SourceVersionCreatedEvent["payload"] {
    return (row.payload as SourceVersionCreatedEvent).payload;
}

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolvePromise: Deferred<T>["resolve"] | undefined;
    let rejectPromise: Deferred<T>["reject"] | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    if (resolvePromise === undefined || rejectPromise === undefined) {
        throw new Error("Deferred promise callbacks were not initialized");
    }
    return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function waitForDocumentLockWait(observerDb: Db, expectedWaiters: number): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
        const waiting = await observerDb.db.execute(sql`
            SELECT DISTINCT activity.pid
            FROM pg_stat_activity AS activity
            JOIN pg_locks AS lock ON lock.pid = activity.pid
            WHERE activity.wait_event_type = 'Lock'
              AND activity.state = 'active'
              AND activity.query ILIKE '%pdr_ai_v2_document%'
              AND activity.query ILIKE '%for update%'
              AND lock.granted = false
              AND (
                  lock.locktype = 'transactionid'
                  OR lock.relation = 'pdr_ai_v2_document'::regclass
              )
        `);
        const waitingPids = new Set<string>();
        if (Array.isArray(waiting)) {
            for (const row of waiting) {
                if (typeof row !== "object" || row === null || !("pid" in row)) continue;
                const pid = row.pid;
                if (typeof pid === "number" || typeof pid === "string") {
                    waitingPids.add(String(pid));
                }
            }
        }
        if (waitingPids.size >= expectedWaiters) return;
        await Promise.resolve();
    }

    throw new Error(
        `Expected ${expectedWaiters} document row-lock waiters, observed fewer before release`
    );
}

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

integrationDescribe("createDocumentLifecycle (database)", () => {
    let companyId: bigint | undefined;
    let userId: string;

    beforeEach(async () => {
        const suffix = randomUUID();
        const [row] = await db
            .insert(companyTable)
            .values({
                name: `document-creation-test-${suffix}`,
                slug: `document-creation-${suffix.slice(0, 24)}`,
                numberOfEmployees: "1",
            })
            .returning({ id: companyTable.id });

        if (!row) throw new Error("Failed to create integration-test company");
        companyId = BigInt(row.id);
        userId = `document-creation-test-user-${suffix}`;
    });

    afterEach(async () => {
        if (companyId === undefined) return;

        // Remove children explicitly before their parent rows. This keeps cleanup
        // correct even when a test intentionally leaves a failed/queued job or a
        // pending/dead outbox event.
        await db.delete(eventOutbox).where(eq(eventOutbox.companyId, Number(companyId)));
        await db.delete(ocrJobs).where(eq(ocrJobs.companyId, companyId));

        const docs = await db
            .select({ id: document.id })
            .from(document)
            .where(eq(document.companyId, companyId));
        for (const row of docs) {
            await db
                .delete(documentVersions)
                .where(eq(documentVersions.documentId, BigInt(row.id)));
        }

        await db.delete(document).where(eq(document.companyId, companyId));
        await db.delete(companyTable).where(eq(companyTable.id, Number(companyId)));
        companyId = undefined;
    });

    function makeParams(overrides: Partial<LifecycleParams> = {}): LifecycleParams {
        if (companyId === undefined) throw new Error("Test company is not initialized");
        return {
            companyId,
            userId,
            title: "Integration document",
            category: "integration",
            url: "https://example.test/document.pdf",
            creationKey: `creation-${randomUUID()}`,
            mimeType: "application/pdf",
            ...overrides,
        };
    }

    function processing(): Processing {
        return {
            preferredProvider: "NATIVE_PDF",
            originalFilename: "document.pdf",
            isWebsite: false,
            transcriptionMetadata: { source: "integration-test" },
            embeddingIndexKey: "integration-test-index",
        };
    }

    async function loadLifecycle(creationKey: string) {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const documents = await db
            .select()
            .from(document)
            .where(
                and(
                    eq(document.companyId, companyId),
                    eq(document.creationKey, persistedCreationKey(creationKey))
                )
            );
        const versions = documents[0]
            ? await db
                  .select()
                  .from(documentVersions)
                  .where(eq(documentVersions.documentId, BigInt(documents[0].id)))
            : [];
        const jobs = documents[0]
            ? await db
                  .select()
                  .from(ocrJobs)
                  .where(eq(ocrJobs.documentId, BigInt(documents[0].id)))
            : [];

        return { documents, versions, jobs };
    }

    async function loadDocumentLifecycle(documentId: number) {
        const documents = await db.select().from(document).where(eq(document.id, documentId));
        const versions = await db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, BigInt(documentId)));
        const jobs = await db
            .select()
            .from(ocrJobs)
            .where(eq(ocrJobs.documentId, BigInt(documentId)));

        return { documents, versions, jobs };
    }

    async function loadOutboxRows() {
        if (companyId === undefined) throw new Error("Test company is not initialized");
        return db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.companyId, Number(companyId)))
            .orderBy(eventOutbox.id);
    }

    async function loadOutboxRowForJob(jobId: string) {
        const [row] = await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.eventId, eventIds.sourceVersionCreated(jobId)));
        if (!row) throw new Error(`Expected an outbox row for job ${jobId}`);
        return row;
    }

    async function markOutboxRowDead(jobId: string): Promise<void> {
        await db
            .update(eventOutbox)
            .set({ status: "dead", attemptCount: 8, lastError: "gave up" })
            .where(eq(eventOutbox.eventId, eventIds.sourceVersionCreated(jobId)));
    }

    it("persists one document, v1, current pointer, linked job, and pending outbox event atomically", async () => {
        const input = makeParams({ processing: processing() });

        const result = await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(input.creationKey);
        const [doc] = lifecycle.documents;
        const [version] = lifecycle.versions;
        const [job] = lifecycle.jobs;

        expect(lifecycle.documents).toHaveLength(1);
        expect(lifecycle.versions).toHaveLength(1);
        expect(lifecycle.jobs).toHaveLength(1);
        expect(version?.versionNumber).toBe(1);
        expect(doc?.currentVersionId).toBe(BigInt(version!.id));
        expect(job?.documentId).toBe(BigInt(doc!.id));
        expect(job?.versionId).toBe(BigInt(version!.id));
        expect(doc?.creationKey).toBe(persistedCreationKey(input.creationKey));
        expect(version?.creationKey).toBe(persistedCreationKey(input.creationKey));

        expect(result.document.id).toBe(doc!.id);
        expect(result.version.id).toBe(version!.id);
        expect(result.job?.id).toBe(job!.id);
        // Inngest event ids are gone; the returned shape keeps the field empty.
        expect(result.eventIds).toEqual([]);
        expect(result.job?.eventIds).toEqual([]);

        const rows = await loadOutboxRows();
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.eventId).toBe(eventIds.sourceVersionCreated(job!.id));
        expect(row.eventType).toBe("source.version.created");
        expect(row.status).toBe("pending");
        expect(row.schemaVersion).toBe(PROTOCOL_VERSION);
        expect(row.companyId).toBe(Number(input.companyId));
        expect(row.attemptCount).toBe(0);
        expect(row.traceId).toBe(job!.id);
        expect(eventPayload(row)).toEqual({
            sourceId: doc!.id,
            sourceVersionId: version!.id,
            ocrJobId: job!.id,
            documentUrl: input.url,
            documentName: input.title,
            category: input.category,
            userId,
            mimeType: "application/pdf",
            originalFilename: "document.pdf",
            isWebsite: false,
            archiveIdentity: input.creationKey,
            transcriptionMetadata: { source: "integration-test" },
            options: {
                preferredProvider: "NATIVE_PDF",
                embeddingIndexKey: "integration-test-index",
            },
        });
    });

    it("persists a source-only document and v1 without creating a job or event", async () => {
        const input = makeParams({
            mimeType: "text/html",
            sourceArchiveName: "website.zip",
            sourceArchiveEntry: "nested/page.html",
        });

        const result = await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(input.creationKey);
        const [doc] = lifecycle.documents;
        const [version] = lifecycle.versions;

        expect(lifecycle.documents).toHaveLength(1);
        expect(lifecycle.versions).toHaveLength(1);
        expect(lifecycle.jobs).toHaveLength(0);
        expect(version?.versionNumber).toBe(1);
        expect(doc?.currentVersionId).toBe(BigInt(version!.id));
        expect(doc?.sourceArchiveName).toBe(input.sourceArchiveName);
        expect(doc?.sourceArchiveEntry).toBe(input.sourceArchiveEntry);
        expect(version?.creationKey).toBe(persistedCreationKey(input.creationKey));
        expect(result.document.id).toBe(doc!.id);
        expect(result.version.id).toBe(version!.id);
        expect(result.job).toBeFalsy();
        expect(await loadOutboxRows()).toHaveLength(0);
    });

    it("rejects a legacy current-version fallback from another document", async () => {
        const sourceInput = makeParams();
        const source = await createDocumentLifecycle(sourceInput);
        const foreign = await createDocumentLifecycle(makeParams());

        await db
            .update(documentVersions)
            .set({ creationKey: persistedCreationKey(`legacy-missing-${randomUUID()}`) })
            .where(eq(documentVersions.id, source.version.id));
        await db
            .update(document)
            .set({ currentVersionId: BigInt(foreign.version.id) })
            .where(eq(document.id, source.document.id));

        await expect(createDocumentLifecycle(sourceInput)).rejects.toThrow(
            `Document ${source.document.id} has no version for creation key`
        );

        const persisted = await loadDocumentLifecycle(source.document.id);
        expect(persisted.documents[0]?.currentVersionId).toBe(BigInt(foreign.version.id));
    });

    it("repairs only the historical version link when the document points to a later version", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const initialInput = makeParams({ processing: processing() });
        const initial = await createDocumentLifecycle(initialInput);
        const initialLifecycle = await loadDocumentLifecycle(initial.document.id);
        const v1Job = initialLifecycle.jobs.find(
            job => job.versionId === BigInt(initial.version.id)
        );
        if (!v1Job) throw new Error("Initial version job is missing");

        const later = await createDocumentVersionLifecycle({
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration document v2",
            category: "integration",
            url: "https://example.test/document-v2.pdf",
            creationKey: `legacy-link-v2-${randomUUID()}`,
            mimeType: "application/pdf",
            originalFilename: "document-v2.pdf",
        });
        const beforeRetry = await loadDocumentLifecycle(initial.document.id);
        const v2Job = beforeRetry.jobs.find(job => job.id === later.jobId);
        if (!v2Job) throw new Error("Later version job is missing");

        await db
            .update(documentVersions)
            .set({ ocrJobId: null })
            .where(eq(documentVersions.id, initial.version.id));
        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, v1Job.id));

        const retried = await createDocumentLifecycle(initialInput);
        const afterRetry = await loadDocumentLifecycle(initial.document.id);
        const currentDocument = afterRetry.documents[0];
        const v1 = afterRetry.versions.find(version => version.id === initial.version.id);

        expect(retried.version.id).toBe(initial.version.id);
        expect(retried.job?.id).toBe(v1Job.id);
        expect(currentDocument?.currentVersionId).toBe(BigInt(later.version.id));
        expect(currentDocument?.ocrJobId).toBe(v2Job.id);
        expect(v1?.ocrJobId).toBe(v1Job.id);
    });

    it("repairs missing version and current document job links from their matching job", async () => {
        const input = makeParams({ processing: processing() });
        const initial = await createDocumentLifecycle(input);
        const job = initial.job;
        if (!job) throw new Error("Initial version job is missing");

        await db
            .update(documentVersions)
            .set({ ocrJobId: null })
            .where(eq(documentVersions.id, initial.version.id));
        await db
            .update(document)
            .set({ ocrJobId: null })
            .where(eq(document.id, initial.document.id));
        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, job.id));

        const retried = await createDocumentLifecycle(input);
        const persisted = await loadDocumentLifecycle(initial.document.id);
        const persistedDocument = persisted.documents[0];
        const persistedVersion = persisted.versions.find(
            version => version.id === initial.version.id
        );

        expect(retried.job?.id).toBe(job.id);
        expect(persistedDocument?.currentVersionId).toBe(BigInt(initial.version.id));
        expect(persistedDocument?.ocrJobId).toBe(job.id);
        expect(persistedVersion?.ocrJobId).toBe(job.id);
    });

    it("converges non-null foreign and wrong-version pointers to the owned current job", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const input = makeParams({ processing: processing() });
        const initial = await createDocumentLifecycle(input);
        const ownedJob = initial.job;
        if (!ownedJob) throw new Error("Initial version job is missing");

        const foreign = await createDocumentLifecycle(makeParams({ processing: processing() }));
        const foreignJob = foreign.job;
        if (!foreignJob) throw new Error("Foreign document job is missing");

        const later = await createDocumentVersionLifecycle({
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration document v2",
            category: "integration",
            url: "https://example.test/document-v2.pdf",
            creationKey: `mismatched-pointer-v2-${randomUUID()}`,
            mimeType: "application/pdf",
            originalFilename: "document-v2.pdf",
        });
        const beforeRetry = await loadDocumentLifecycle(initial.document.id);
        const wrongVersionJob = beforeRetry.jobs.find(job => job.id === later.jobId);
        if (!wrongVersionJob) throw new Error("Wrong-version job is missing");

        expect(foreignJob.documentId).not.toBe(BigInt(initial.document.id));
        expect(wrongVersionJob.documentId).toBe(BigInt(initial.document.id));
        await db
            .update(documentVersions)
            .set({ ocrJobId: wrongVersionJob.id })
            .where(eq(documentVersions.id, initial.version.id));
        await db
            .update(document)
            .set({
                currentVersionId: BigInt(initial.version.id),
                ocrJobId: foreignJob.id,
            })
            .where(eq(document.id, initial.document.id));
        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, ownedJob.id));

        const retried = await createDocumentLifecycle(input);
        const persisted = await loadDocumentLifecycle(initial.document.id);
        const persistedDocument = persisted.documents[0];
        const persistedVersion = persisted.versions.find(
            version => version.id === initial.version.id
        );
        const persistedOwnedJob = persisted.jobs.find(job => job.id === ownedJob.id);

        expect(retried.document.id).toBe(initial.document.id);
        expect(retried.version.id).toBe(initial.version.id);
        expect(retried.job?.id).toBe(ownedJob.id);
        expect(retried.document.ocrJobId).toBe(ownedJob.id);
        expect(retried.version.ocrJobId).toBe(ownedJob.id);
        expect(retried.job?.documentId).toBe(BigInt(retried.document.id));
        expect(retried.job?.versionId).toBe(BigInt(retried.version.id));

        expect(persistedDocument?.currentVersionId).toBe(BigInt(initial.version.id));
        expect(persistedDocument?.ocrJobId).toBe(ownedJob.id);
        expect(persistedVersion?.ocrJobId).toBe(ownedJob.id);
        expect(persistedOwnedJob?.documentId).toBe(BigInt(initial.document.id));
        expect(persistedOwnedJob?.versionId).toBe(BigInt(initial.version.id));
    });

    it("rolls back the document, version, and job when the outbox event cannot be enqueued", async () => {
        // The event envelope is validated inside the creating transaction
        // (ADR-003 §2: command rows and their outbox event commit together or
        // not at all). An unenqueueable event — here an empty documentUrl that
        // fails protocol validation — must abort the entire lifecycle instead
        // of leaving a stranded queued job with no event.
        const input = makeParams({ url: "", processing: processing() });

        await expect(createDocumentLifecycle(input)).rejects.toThrow();

        const lifecycle = await loadLifecycle(input.creationKey);
        expect(lifecycle.documents).toHaveLength(0);
        expect(lifecycle.versions).toHaveLength(0);
        expect(lifecycle.jobs).toHaveLength(0);
        expect(await loadOutboxRows()).toHaveLength(0);
    });

    it("revives a dead event with persisted URL, name, category, and MIME on re-upload", async () => {
        const input = makeParams({
            title: "Persisted document title",
            category: "persisted-category",
            url: "https://example.test/persisted-source.pdf",
            processingUrl: "https://storage.example.test/persisted-source.pdf",
            processing: processing(),
        });

        await createDocumentLifecycle(input);
        const first = await loadLifecycle(input.creationKey);
        const firstDocument = first.documents[0]!;
        const firstVersion = first.versions[0]!;
        const firstJob = first.jobs[0]!;
        expect(firstJob.dispatchOptions).toEqual({
            archiveIdentity: input.creationKey,
            preferredProvider: "NATIVE_PDF",
            originalFilename: "document.pdf",
            isWebsite: false,
            transcriptionMetadata: { source: "integration-test" },
            embeddingIndexKey: "integration-test-index",
            mimeType: firstVersion.mimeType,
        });

        // Simulate the pipeline giving up after commit: job failed, event dead.
        await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, firstJob.id));
        await markOutboxRowDead(firstJob.id);

        const retried = await createDocumentLifecycle({
            ...input,
            title: "Retry-only title",
            category: "retry-only-category",
            url: "https://example.test/retry-source.pdf",
            processingUrl: "https://storage.example.test/retry-source.pdf",
            userId: "retry-only-user",
            mimeType: "text/plain",
            processing: {
                preferredProvider: "AZURE",
                originalFilename: "retry.txt",
                isWebsite: true,
                transcriptionMetadata: { source: "retry" },
                embeddingIndexKey: "retry-index",
            },
        });

        expect(retried.document.id).toBe(firstDocument.id);
        expect(retried.version.id).toBe(firstVersion.id);
        expect(retried.job?.id).toBe(firstJob.id);
        // The failed→queued requeue now happens inside the transaction.
        expect(retried.job?.status).toBe("queued");
        const afterRetry = await loadLifecycle(input.creationKey);
        expect(afterRetry.jobs[0]?.status).toBe("queued");
        expect(afterRetry.jobs[0]?.errorMessage).toBeNull();

        const rows = await loadOutboxRows();
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.eventId).toBe(eventIds.sourceVersionCreated(firstJob.id));
        expect(row.status).toBe("pending");
        expect(row.attemptCount).toBe(0);
        expect(row.claimedAt).toBeNull();
        expect(row.lastError).toBeNull();
        expect(row.traceId).toBe(firstJob.id);
        expect(eventPayload(row)).toEqual({
            sourceId: firstDocument.id,
            sourceVersionId: firstVersion.id,
            ocrJobId: firstJob.id,
            // The persisted job identity wins over the changed retry params...
            documentUrl: "https://storage.example.test/persisted-source.pdf",
            documentName: input.title,
            category: input.category,
            // ...while provenance records the user who actually retried.
            userId: "retry-only-user",
            mimeType: firstVersion.mimeType,
            originalFilename: "document.pdf",
            isWebsite: false,
            archiveIdentity: input.creationKey,
            transcriptionMetadata: { source: "integration-test" },
            options: {
                preferredProvider: "NATIVE_PDF",
                embeddingIndexKey: "integration-test-index",
            },
        });
    });

    it("backfills a missing archive identity for a legacy initial ZIP retry", async () => {
        const input = makeParams({
            mimeType: "application/zip",
            processing: {
                ...processing(),
                originalFilename: "legacy.zip",
            },
        });
        const initial = await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(input.creationKey);
        const job = lifecycle.jobs[0]!;
        const legacyDispatchOptions = {
            preferredProvider: "NATIVE_PDF",
            originalFilename: "legacy.zip",
            isWebsite: false,
            mimeType: "application/zip",
            legacyRoute: "preserve",
        };

        await db
            .update(ocrJobs)
            .set({ status: "failed", dispatchOptions: legacyDispatchOptions })
            .where(eq(ocrJobs.id, job.id));
        await markOutboxRowDead(job.id);

        const persisted = await loadLifecycle(input.creationKey);
        expect(persisted.jobs[0]?.dispatchOptions).toEqual(legacyDispatchOptions);

        await createDocumentLifecycle({
            ...input,
            processing: {
                ...processing(),
                preferredProvider: "AZURE",
                originalFilename: "retry.zip",
                isWebsite: true,
                transcriptionMetadata: { source: "retry" },
                embeddingIndexKey: "retry-index",
            },
        });

        const afterRetry = await loadLifecycle(input.creationKey);
        expect(afterRetry.jobs[0]?.status).toBe("queued");

        const rows = await loadOutboxRows();
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.status).toBe("pending");
        expect(row.attemptCount).toBe(0);
        // The legacy persisted routing wins over the changed retry processing,
        // with only the missing archive identity backfilled from the creation
        // key. Fields outside the event vocabulary (legacyRoute) are dropped.
        expect(eventPayload(row)).toEqual({
            sourceId: initial.document.id,
            sourceVersionId: initial.version.id,
            ocrJobId: job.id,
            documentUrl: input.url,
            documentName: input.title,
            category: input.category,
            userId,
            mimeType: "application/zip",
            originalFilename: "legacy.zip",
            isWebsite: false,
            archiveIdentity: input.creationKey,
            options: { preferredProvider: "NATIVE_PDF" },
        });
    });

    it("retries a duplicate creation key with the same job, version, and event, but not completed work", async () => {
        const input = makeParams({ processing: processing() });

        await createDocumentLifecycle(input);
        const first = await loadLifecycle(input.creationKey);
        const firstDocument = first.documents[0]!;
        const firstVersion = first.versions[0]!;
        const firstJob = first.jobs[0]!;
        const rowsAfterCreate = await loadOutboxRows();
        expect(rowsAfterCreate).toHaveLength(1);
        expect(rowsAfterCreate[0]!.eventId).toBe(eventIds.sourceVersionCreated(firstJob.id));
        expect(rowsAfterCreate[0]!.status).toBe("pending");

        const retryResult = await createDocumentLifecycle(input);
        const retried = await loadLifecycle(input.creationKey);

        expect(retried.documents).toHaveLength(1);
        expect(retried.versions).toHaveLength(1);
        expect(retried.jobs).toHaveLength(1);
        expect(retried.documents[0]!.id).toBe(firstDocument.id);
        expect(retried.versions[0]!.id).toBe(firstVersion.id);
        expect(retried.jobs[0]!.id).toBe(firstJob.id);
        expect(retryResult.document.id).toBe(firstDocument.id);
        expect(retryResult.version.id).toBe(firstVersion.id);
        expect(retryResult.job?.id).toBe(firstJob.id);

        // The retry converged on the live pending event without duplicating
        // or disturbing it.
        expect(await loadOutboxRows()).toEqual(rowsAfterCreate);

        // Completed work stays completed: a converged completed job neither
        // requeues nor revives its processed event.
        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, firstJob.id));
        await db
            .update(eventOutbox)
            .set({ status: "processed", attemptCount: 3 })
            .where(eq(eventOutbox.id, rowsAfterCreate[0]!.id));
        await createDocumentLifecycle(input);

        const afterCompleted = await loadOutboxRows();
        expect(afterCompleted).toHaveLength(1);
        expect(afterCompleted[0]!.status).toBe("processed");
        expect(afterCompleted[0]!.attemptCount).toBe(3);
        const completedLifecycle = await loadLifecycle(input.creationKey);
        expect(completedLifecycle.jobs[0]?.status).toBe("completed");
    });

    it("creates and retries a later version with one linked job, event, and the current pointer on v2", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const initialInput = makeParams({ processing: processing() });
        const initial = await createDocumentLifecycle(initialInput);
        const versionInput = {
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration document v2",
            category: "integration",
            url: "https://example.test/document-v2.pdf",
            creationKey: `version-${randomUUID()}`,
            mimeType: "application/pdf",
            fileSize: 2048,
            changelog: "Second integration version",
            preferredProvider: "NATIVE_PDF",
            originalFilename: "document-v2.pdf",
            isWebsite: true,
            transcriptionMetadata: { source: "integration-v2" },
            embeddingIndexKey: "integration-test-index",
        };

        const created = await createDocumentVersionLifecycle(versionInput);
        const rowsAfterCreate = await loadOutboxRows();
        expect(rowsAfterCreate.map(row => row.eventId)).toEqual([
            eventIds.sourceVersionCreated(initial.jobId!),
            eventIds.sourceVersionCreated(created.jobId),
        ]);
        const v2Row = rowsAfterCreate[1]!;
        expect(v2Row.eventType).toBe("source.version.created");
        expect(v2Row.status).toBe("pending");
        expect(v2Row.traceId).toBe(created.jobId);
        expect(eventPayload(v2Row)).toEqual({
            sourceId: initial.document.id,
            sourceVersionId: created.version.id,
            ocrJobId: created.jobId,
            documentUrl: versionInput.url,
            documentName: versionInput.title,
            category: versionInput.category,
            userId: versionInput.userId,
            mimeType: versionInput.mimeType,
            originalFilename: "document-v2.pdf",
            isWebsite: true,
            archiveIdentity: versionInput.creationKey,
            transcriptionMetadata: { source: "integration-v2" },
            options: {
                preferredProvider: "NATIVE_PDF",
                embeddingIndexKey: "integration-test-index",
            },
        });

        const retried = await createDocumentVersionLifecycle({
            ...versionInput,
            title: "Retry-only title",
            category: "retry-only-category",
            url: "https://example.test/retry-only-v2.pdf",
            userId: "retry-only-user",
            mimeType: "text/plain",
            preferredProvider: "AZURE",
            originalFilename: "retry-only-v2.txt",
            isWebsite: false,
            transcriptionMetadata: { source: "retry-v2" },
            embeddingIndexKey: "retry-only-index",
        });
        const lifecycle = await loadDocumentLifecycle(initial.document.id);
        const [doc] = lifecycle.documents;
        const versions = [...lifecycle.versions].sort(
            (left, right) => left.versionNumber - right.versionNumber
        );
        const [v1, v2] = versions;
        const v2Jobs = lifecycle.jobs.filter(job => job.versionId === BigInt(v2!.id));

        expect(lifecycle.documents).toHaveLength(1);
        expect(lifecycle.jobs).toHaveLength(2);
        expect(v1?.versionNumber).toBe(1);
        expect(v2?.versionNumber).toBe(2);

        expect(v2Jobs[0]?.dispatchOptions).toEqual({
            archiveIdentity: versionInput.creationKey,
            preferredProvider: "NATIVE_PDF",
            originalFilename: "document-v2.pdf",
            isWebsite: true,
            transcriptionMetadata: { source: "integration-v2" },
            embeddingIndexKey: "integration-test-index",
            mimeType: v2!.mimeType,
        });
        expect(v2?.creationKey).toBe(persistedCreationKey(versionInput.creationKey));
        expect(doc?.currentVersionId).toBe(BigInt(v2!.id));
        expect(doc?.ocrJobId).toBe(created.jobId);
        expect(v2?.ocrJobId).toBe(created.jobId);
        expect(v2Jobs).toHaveLength(1);
        expect(v2Jobs[0]?.documentId).toBe(BigInt(initial.document.id));
        expect(v2Jobs[0]?.versionId).toBe(BigInt(v2!.id));
        expect(created.document.id).toBe(initial.document.id);
        expect(created.version.id).toBe(v2!.id);
        expect(created.jobId).toBe(v2Jobs[0]!.id);
        expect(retried.document.id).toBe(initial.document.id);
        expect(retried.version.id).toBe(v2!.id);
        expect(retried.jobId).toBe(v2Jobs[0]!.id);

        // Retrying a queued v2 job converges on its live pending event: the
        // persisted routing wins over the changed retry parameters and the
        // rows are left byte-identical.
        expect(await loadOutboxRows()).toEqual(rowsAfterCreate);

        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, v2Jobs[0]!.id));
        await createDocumentVersionLifecycle(versionInput);
        const completedRetry = await loadDocumentLifecycle(initial.document.id);

        expect(completedRetry.versions).toHaveLength(2);
        expect(completedRetry.jobs).toHaveLength(2);
        // A converged completed job enqueues nothing new.
        expect(await loadOutboxRows()).toEqual(rowsAfterCreate);
    });

    it("preserves persisted archive identity over changed later-version retry routing", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const initial = await createDocumentLifecycle(makeParams({ processing: processing() }));
        const versionInput = {
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration archive v2",
            category: "integration",
            url: "https://example.test/archive-v2.zip",
            creationKey: `version-${randomUUID()}`,
            mimeType: "application/zip",
            fileSize: 2048,
            changelog: "Archive integration version",
            preferredProvider: "NATIVE_PDF",
            originalFilename: "archive-v2.zip",
            isWebsite: false,
            transcriptionMetadata: { source: "archive-v2" },
            embeddingIndexKey: "archive-index",
        };
        const created = await createDocumentVersionLifecycle(versionInput);
        const lifecycle = await loadDocumentLifecycle(initial.document.id);
        const job = lifecycle.jobs.find(candidate => candidate.id === created.jobId);

        if (!job) throw new Error("Later version job is missing");

        const persistedDispatchOptions = {
            archiveIdentity: "persisted-archive-identity",
            preferredProvider: "NATIVE_PDF",
            originalFilename: "persisted-archive.zip",
            isWebsite: true,
            mimeType: "application/zip",
            legacyRoute: "preserve",
        };
        await db
            .update(ocrJobs)
            .set({ status: "failed", dispatchOptions: persistedDispatchOptions })
            .where(eq(ocrJobs.id, job.id));
        await markOutboxRowDead(job.id);

        const persisted = await loadDocumentLifecycle(initial.document.id);
        expect(persisted.jobs.find(candidate => candidate.id === job.id)?.dispatchOptions).toEqual(
            persistedDispatchOptions
        );

        await createDocumentVersionLifecycle({
            ...versionInput,
            preferredProvider: "AZURE",
            originalFilename: "retry-archive.zip",
            isWebsite: false,
            transcriptionMetadata: { source: "retry-archive" },
            embeddingIndexKey: "retry-archive-index",
        });

        const afterRetry = await loadDocumentLifecycle(initial.document.id);
        expect(afterRetry.jobs.find(candidate => candidate.id === job.id)?.status).toBe("queued");

        const row = await loadOutboxRowForJob(job.id);
        expect(row.status).toBe("pending");
        expect(row.attemptCount).toBe(0);
        expect(eventPayload(row)).toEqual({
            sourceId: initial.document.id,
            sourceVersionId: created.version.id,
            ocrJobId: job.id,
            documentUrl: versionInput.url,
            documentName: versionInput.title,
            category: versionInput.category,
            userId,
            mimeType: "application/zip",
            originalFilename: "persisted-archive.zip",
            isWebsite: true,
            archiveIdentity: "persisted-archive-identity",
            options: { preferredProvider: "NATIVE_PDF" },
        });
    });
    it("backfills a missing archive identity for a legacy later-version retry", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const initial = await createDocumentLifecycle(makeParams({ processing: processing() }));
        const versionInput = {
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration legacy archive v2",
            category: "integration",
            url: "https://example.test/legacy-archive-v2.zip",
            creationKey: `legacy-version-${randomUUID()}`,
            mimeType: "application/zip",
            fileSize: 2048,
            changelog: "Legacy archive integration version",
            preferredProvider: "NATIVE_PDF",
            originalFilename: "legacy-archive-v2.zip",
            isWebsite: false,
        };
        const created = await createDocumentVersionLifecycle(versionInput);
        const lifecycle = await loadDocumentLifecycle(initial.document.id);
        const job = lifecycle.jobs.find(candidate => candidate.id === created.jobId);

        if (!job) throw new Error("Later version job is missing");

        const legacyDispatchOptions = {
            preferredProvider: "NATIVE_PDF",
            originalFilename: "legacy-archive-v2.zip",
            isWebsite: false,
            mimeType: "application/zip",
            legacyRoute: "preserve",
        };
        await db
            .update(ocrJobs)
            .set({ status: "failed", dispatchOptions: legacyDispatchOptions })
            .where(eq(ocrJobs.id, job.id));
        await markOutboxRowDead(job.id);

        await createDocumentVersionLifecycle({
            ...versionInput,
            preferredProvider: "AZURE",
            originalFilename: "retry-legacy-archive-v2.zip",
            isWebsite: true,
        });

        const afterRetry = await loadDocumentLifecycle(initial.document.id);
        expect(afterRetry.jobs.find(candidate => candidate.id === job.id)?.status).toBe("queued");

        const row = await loadOutboxRowForJob(job.id);
        expect(row.status).toBe("pending");
        expect(row.attemptCount).toBe(0);
        expect(eventPayload(row)).toEqual({
            sourceId: initial.document.id,
            sourceVersionId: created.version.id,
            ocrJobId: job.id,
            documentUrl: versionInput.url,
            documentName: versionInput.title,
            category: versionInput.category,
            userId,
            mimeType: "application/zip",
            originalFilename: "legacy-archive-v2.zip",
            isWebsite: false,
            archiveIdentity: versionInput.creationKey,
            options: { preferredProvider: "NATIVE_PDF" },
        });
    });

    it("serializes concurrent distinct later-version allocation on the parent document row", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error("DATABASE_URL is required for this integration test");

        const testCompanyId = companyId;
        const initial = await createDocumentLifecycle(makeParams({ processing: processing() }));
        const versionInputs = [0, 1, 2].map(index => ({
            documentId: initial.document.id,
            companyId: testCompanyId,
            userId,
            title: `Integration document v${index + 2}`,
            category: "integration",
            url: `https://example.test/document-v${index + 2}.pdf`,
            creationKey: `concurrent-version-${index}-${randomUUID()}`,
            mimeType: "application/pdf",
            fileSize: 2048 + index,
            changelog: `Concurrent version ${index + 2}`,
            preferredProvider: "NATIVE_PDF",
            originalFilename: `document-v${index + 2}.pdf`,
        }));

        const lockDb = createDb({ url: databaseUrl, maxConnections: 1 });
        const observerDb = createDb({ url: databaseUrl, maxConnections: 1 });
        const releaseLock = createDeferred<void>();
        const lockReady = createDeferred<void>();
        const lockTransaction = lockDb.db
            .transaction(async tx => {
                await tx.execute(sql`
                    SELECT id
                    FROM pdr_ai_v2_document
                    WHERE id = ${initial.document.id}
                      AND company_id = ${testCompanyId}
                    FOR UPDATE
                `);
                lockReady.resolve(undefined);
                await releaseLock.promise;
            })
            .catch(error => {
                lockReady.reject(error);
                throw error;
            });
        let resultsPromiseForCleanup: Promise<CreatedDocumentVersionLifecycle[]> | undefined;

        try {
            await lockReady.promise;
            const resultsPromise = Promise.all(
                versionInputs.map(versionInput => createDocumentVersionLifecycle(versionInput))
            );
            resultsPromiseForCleanup = resultsPromise;
            await waitForDocumentLockWait(observerDb, 3);
            releaseLock.resolve(undefined);
            const results = await resultsPromise;

            await lockTransaction;
            const lifecycle = await loadDocumentLifecycle(initial.document.id);
            const versions = [...lifecycle.versions].sort(
                (left, right) => left.versionNumber - right.versionNumber
            );
            const laterVersions = versions.filter(version => version.versionNumber > 1);

            expect(results).toHaveLength(3);
            expect(new Set(results.map(result => result.version.id)).size).toBe(3);
            expect(laterVersions.map(version => version.versionNumber)).toEqual([2, 3, 4]);
            expect(lifecycle.jobs).toHaveLength(4);

            for (const version of laterVersions) {
                const linkedJobs = lifecycle.jobs.filter(
                    job => job.versionId === BigInt(version.id)
                );
                expect(linkedJobs).toHaveLength(1);
                expect(linkedJobs[0]?.documentId).toBe(BigInt(initial.document.id));
                expect(linkedJobs[0]?.id).toBe(version.ocrJobId);
            }

            const currentDocument = lifecycle.documents[0];
            const highestVersion = laterVersions.at(-1);
            expect(currentDocument?.currentVersionId).toBe(BigInt(highestVersion!.id));

            // Every job — v1 and the three concurrently allocated later
            // versions — committed exactly one pending outbox event.
            const outboxRows = await loadOutboxRows();
            expect(outboxRows).toHaveLength(4);
            expect(outboxRows.every(row => row.status === "pending")).toBe(true);
            expect(new Set(outboxRows.map(row => row.eventId))).toEqual(
                new Set(lifecycle.jobs.map(job => eventIds.sourceVersionCreated(job.id)))
            );
        } finally {
            releaseLock.resolve(undefined);
            await Promise.allSettled([
                lockTransaction,
                resultsPromiseForCleanup ?? Promise.resolve(),
            ]);
            await Promise.all([lockDb.close(), observerDb.close()]);
        }
    });

    it("does not roll the current pointer back when an original retry contends with v2", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error("DATABASE_URL is required for this integration test");

        const initialInput = makeParams({ processing: processing() });
        const initial = await createDocumentLifecycle(initialInput);
        const initialLifecycle = await loadDocumentLifecycle(initial.document.id);
        const v1Job = initialLifecycle.jobs.find(
            job => job.versionId === BigInt(initial.version.id)
        );

        if (!v1Job) throw new Error("Initial version job is missing");
        // Simulate the pipeline giving up on v1: job failed, event dead.
        await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, v1Job.id));
        await markOutboxRowDead(v1Job.id);

        const laterInput = {
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration document v2",
            category: "integration",
            url: "https://example.test/document-v2.pdf",
            creationKey: `version-${randomUUID()}`,
            mimeType: "application/pdf",
            originalFilename: "document-v2.pdf",
        };
        const lockDb = createDb({ url: databaseUrl, maxConnections: 1 });
        const observerDb = createDb({ url: databaseUrl, maxConnections: 1 });
        const releaseLock = createDeferred<void>();
        const lockReady = createDeferred<void>();
        const lockTransaction = lockDb.db
            .transaction(async tx => {
                await tx.execute(sql`
                    SELECT id
                    FROM pdr_ai_v2_document
                    WHERE id = ${initial.document.id}
                      AND company_id = ${companyId}
                    FOR UPDATE
                `);
                lockReady.resolve(undefined);
                await releaseLock.promise;
            })
            .catch(error => {
                lockReady.reject(error);
                throw error;
            });

        let laterPromiseForCleanup: Promise<CreatedDocumentVersionLifecycle> | undefined;
        let retryPromiseForCleanup: Promise<CreatedDocumentLifecycle> | undefined;
        try {
            await lockReady.promise;
            const laterPromise = createDocumentVersionLifecycle(laterInput);
            laterPromiseForCleanup = laterPromise;
            await waitForDocumentLockWait(observerDb, 1);
            const retryPromise = createDocumentLifecycle({
                ...initialInput,
                title: "Retry-only title",
                category: "retry-only-category",
                url: "https://example.test/retry-only.pdf",
                processingUrl: "https://storage.example.test/retry-only.pdf",
                userId: "retry-only-user",
                mimeType: "text/plain",
            });
            retryPromiseForCleanup = retryPromise;
            await waitForDocumentLockWait(observerDb, 2);

            releaseLock.resolve(undefined);
            const [later, retried] = await Promise.all([laterPromise, retryPromise]);
            await lockTransaction;
            const lifecycle = await loadDocumentLifecycle(initial.document.id);
            const currentDocument = lifecycle.documents[0];
            const currentVersion = lifecycle.versions.find(
                version => BigInt(version.id) === currentDocument?.currentVersionId
            );

            expect(later.version.versionNumber).toBe(2);
            expect(retried.version.id).toBe(initial.version.id);
            expect(currentVersion?.id).toBe(later.version.id);
            expect(currentDocument?.currentVersionId).toBe(BigInt(later.version.id));

            // The contended retry requeued the failed v1 job and revived its
            // dead event in the same transaction; the v2 creation committed
            // its own event. Neither disturbed the other.
            const persistedV1Job = lifecycle.jobs.find(job => job.id === v1Job.id);
            expect(persistedV1Job?.status).toBe("queued");
            expect(await loadOutboxRows()).toHaveLength(2);

            const v1Row = await loadOutboxRowForJob(v1Job.id);
            expect(v1Row.status).toBe("pending");
            expect(v1Row.attemptCount).toBe(0);
            expect(eventPayload(v1Row)).toEqual(
                expect.objectContaining({
                    ocrJobId: v1Job.id,
                    sourceId: initial.document.id,
                    sourceVersionId: initial.version.id,
                    // The persisted v1 identity wins over the changed retry
                    // params; the acting user is the retry caller.
                    documentUrl: initialInput.url,
                    documentName: initialInput.title,
                    category: initialInput.category,
                    userId: "retry-only-user",
                    archiveIdentity: initialInput.creationKey,
                })
            );

            const v2Row = await loadOutboxRowForJob(later.jobId);
            expect(v2Row.status).toBe("pending");
            expect(eventPayload(v2Row)).toEqual(
                expect.objectContaining({
                    ocrJobId: later.jobId,
                    sourceVersionId: later.version.id,
                })
            );
        } finally {
            releaseLock.resolve(undefined);
            await Promise.allSettled([
                lockTransaction,
                laterPromiseForCleanup ?? Promise.resolve(),
                retryPromiseForCleanup ?? Promise.resolve(),
            ]);
            await Promise.all([lockDb.close(), observerDb.close()]);
        }
    });

    it("requeues a failed job and revives its dead event once under concurrent duplicate retries", async () => {
        const input = makeParams({ processing: processing() });
        await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(input.creationKey);
        const job = lifecycle.jobs[0]!;

        await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, job.id));
        await markOutboxRowDead(job.id);

        const [firstRetry, secondRetry] = await Promise.all([
            createDocumentLifecycle(input),
            createDocumentLifecycle(input),
        ]);
        const afterRetry = await loadLifecycle(input.creationKey);

        expect(firstRetry.jobId).toBe(job.id);
        expect(secondRetry.jobId).toBe(job.id);
        // The requeue happens inside the transaction under the document row
        // lock, so the loser of the race converges on the already-queued job
        // instead of racing a post-commit CAS.
        expect(afterRetry.jobs[0]?.status).toBe("queued");

        const rows = await loadOutboxRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.eventId).toBe(eventIds.sourceVersionCreated(job.id));
        expect(rows[0]!.status).toBe("pending");
        expect(rows[0]!.attemptCount).toBe(0);
        expect(rows[0]!.lastError).toBeNull();
    });

    it("converges a long creation key to one fixed-length persisted key", async () => {
        const creationKey = `long-${"creation-key/".repeat(1024)}`;
        const input = makeParams({ creationKey, processing: processing() });

        const first = await createDocumentLifecycle(input);
        const second = await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(creationKey);
        const [doc] = lifecycle.documents;
        const [version] = lifecycle.versions;
        const [job] = lifecycle.jobs;

        expect(lifecycle.documents).toHaveLength(1);
        expect(lifecycle.versions).toHaveLength(1);
        expect(lifecycle.jobs).toHaveLength(1);
        expect(doc?.creationKey).toBe(persistedCreationKey(creationKey));
        expect(version?.creationKey).toBe(persistedCreationKey(creationKey));
        expect(doc?.creationKey).toHaveLength(64);
        expect(first.document.id).toBe(second.document.id);
        expect(first.version.id).toBe(second.version.id);
        expect(first.jobId).toBe(job?.id);
        expect(second.jobId).toBe(job?.id);
    });

    it("retrieves only chunks from the current version after creating v2", async () => {
        if (companyId === undefined) throw new Error("Test company is not initialized");

        const initial = await createDocumentLifecycle(makeParams({ processing: processing() }));
        const later = await createDocumentVersionLifecycle({
            documentId: initial.document.id,
            companyId,
            userId,
            title: "Integration document v2",
            category: "integration",
            url: "https://example.test/document-v2.pdf",
            creationKey: `retrieval-version-${randomUUID()}`,
            mimeType: "application/pdf",
            originalFilename: "document-v2.pdf",
        });

        await db.insert(documentSections).values([
            {
                documentId: BigInt(initial.document.id),
                versionId: BigInt(initial.version.id),
                content: "legacy v1 retrieval marker",
                tokenCount: 4,
                charCount: 27,
                pageNumber: 1,
            },
            {
                documentId: BigInt(initial.document.id),
                versionId: BigInt(later.version.id),
                content: "current v2 retrieval marker",
                tokenCount: 4,
                charCount: 27,
                pageNumber: 1,
            },
        ]);

        const chunks = await getDocumentChunks(initial.document.id);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.content).toBe("current v2 retrieval marker");

        const sections = await new RLMRetriever().getSectionsWithinBudget(initial.document.id, {
            maxTokens: 100,
        });
        expect(sections).toHaveLength(1);
        expect(sections[0]?.content).toBe("current v2 retrieval marker");
    });

    it("collapses concurrent duplicate requests into one document, v1, job, and event", async () => {
        const input = makeParams({ processing: processing() });

        const results = await Promise.all([
            createDocumentLifecycle(input),
            createDocumentLifecycle(input),
        ]);
        const lifecycle = await loadLifecycle(input.creationKey);
        const [doc] = lifecycle.documents;
        const [version] = lifecycle.versions;
        const [job] = lifecycle.jobs;

        expect(lifecycle.documents).toHaveLength(1);
        expect(lifecycle.versions).toHaveLength(1);
        expect(lifecycle.jobs).toHaveLength(1);
        expect(doc?.currentVersionId).toBe(BigInt(version!.id));
        expect(job?.documentId).toBe(BigInt(doc!.id));
        expect(job?.versionId).toBe(BigInt(version!.id));
        expect(results[0].document.id).toBe(doc!.id);
        expect(results[1].document.id).toBe(doc!.id);
        expect(results[0].version.id).toBe(version!.id);
        expect(results[1].version.id).toBe(version!.id);
        expect(results[0].job?.id).toBe(job!.id);
        expect(results[1].job?.id).toBe(job!.id);

        const outboxRows = await loadOutboxRows();
        expect(outboxRows).toHaveLength(1);
        expect(outboxRows[0]!.eventId).toBe(eventIds.sourceVersionCreated(job!.id));
        expect(outboxRows[0]!.status).toBe("pending");
        expect(eventPayload(outboxRows[0]!)).toEqual(
            expect.objectContaining({ ocrJobId: job!.id, sourceVersionId: version!.id })
        );
    });
});
