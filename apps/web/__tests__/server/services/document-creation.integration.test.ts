import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "@launchstack/core/db";

import type { TriggerOptions } from "@launchstack/core/ocr/trigger";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const actualDbModule = jest.requireActual<{ createDb: typeof createDb }>(
        "@launchstack/core/db"
    );
    const engineDb = databaseUrl ? actualDbModule.createDb({ url: databaseUrl }).db : undefined;

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

jest.mock("@launchstack/core/ocr/trigger", () => {
    const actualTriggerModule = jest.requireActual<Record<string, unknown>>(
        "@launchstack/core/ocr/trigger"
    );

    return {
        ...actualTriggerModule,
        triggerDocumentProcessing: jest.fn(),
    };
});

import {
    company as companyTable,
    document,
    documentSections,
    documentVersions,
    ocrJobs,
} from "@launchstack/core/db/schema";
import { triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
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
type DispatchCall = Parameters<typeof triggerDocumentProcessing>;
type DispatchOptions = TriggerOptions;

const dispatchMock = triggerDocumentProcessing as jest.MockedFunction<
    typeof triggerDocumentProcessing
>;

function getDispatchCall(index: number): DispatchCall {
    const call = dispatchMock.mock.calls[index];
    if (call === undefined) {
        throw new Error(`Expected triggerDocumentProcessing call at index ${index}`);
    }
    return call;
}

function getDispatchOptions(call: DispatchCall): DispatchOptions {
    return call[6];
}

const CREATION_KEY_NAMESPACE = "launchstack:document-creation:v1:";

function persistedCreationKey(rawCreationKey: string): string {
    return createHash("sha256")
        .update(CREATION_KEY_NAMESPACE, "utf8")
        .update(rawCreationKey, "utf8")
        .digest("hex");
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
        dispatchMock.mockReset();
        dispatchMock.mockImplementation(async (...args: DispatchCall) => {
            const options = args[6];
            const jobId = options.jobId ?? `mock-job-${randomUUID()}`;
            return { jobId, eventIds: [`event-${jobId}`] };
        });

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
        // correct even when a test intentionally leaves a failed/queued job.
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

    it("persists one document, v1, current pointer, and linked job before dispatch", async () => {
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

        expect(dispatchMock).toHaveBeenCalledTimes(1);
        const dispatchCall = getDispatchCall(0);
        expect(dispatchCall[6]).toEqual(
            expect.objectContaining({
                jobId: job!.id,
                versionId: version!.id,
                archiveIdentity: input.creationKey,
            })
        );
    });

    it("persists a source-only document and v1 without creating a job", async () => {
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
        expect(dispatchMock).not.toHaveBeenCalled();
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

    it("keeps the linked job and lifecycle when dispatch fails", async () => {
        const input = makeParams({ processing: processing() });
        dispatchMock.mockRejectedValueOnce(new Error("dispatch unavailable"));

        await expect(createDocumentLifecycle(input)).rejects.toThrow("dispatch unavailable");

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
        expect(job?.status).toBe("failed");
    });

    it("retries with persisted URL, name, category, user, and MIME", async () => {
        const input = makeParams({
            title: "Persisted document title",
            category: "persisted-category",
            url: "https://example.test/persisted-source.pdf",
            processingUrl: "https://storage.example.test/persisted-source.pdf",
            processing: processing(),
        });
        dispatchMock.mockRejectedValueOnce(new Error("dispatch unavailable"));

        await expect(createDocumentLifecycle(input)).rejects.toThrow("dispatch unavailable");
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
        expect(dispatchMock).toHaveBeenCalledTimes(2);

        const retryCall = getDispatchCall(1);
        expect(retryCall.slice(0, 6)).toEqual([
            input.processingUrl,
            input.title,
            input.companyId.toString(),
            input.userId,
            firstDocument.id,
            input.category,
        ]);
        expect(retryCall[6]).toEqual({
            ...(firstJob.dispatchOptions ?? {}),
            jobId: firstJob.id,
            versionId: firstVersion.id,
        });
        expect(retryCall[6].archiveIdentity).toBe(input.creationKey);
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

        const persisted = await loadLifecycle(input.creationKey);
        expect(persisted.jobs[0]?.dispatchOptions).toEqual(legacyDispatchOptions);

        const callsBeforeRetry = dispatchMock.mock.calls.length;
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

        expect(dispatchMock).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        const retryCall = getDispatchCall(callsBeforeRetry);
        expect(retryCall[6]).toEqual({
            ...legacyDispatchOptions,
            archiveIdentity: input.creationKey,
            jobId: job.id,
            versionId: initial.version.id,
        });
    });

    it("retries a duplicate creation key with the same job and version, but not completed work", async () => {
        const input = makeParams({ processing: processing() });
        dispatchMock.mockRejectedValueOnce(new Error("first dispatch unavailable"));

        await expect(createDocumentLifecycle(input)).rejects.toThrow("first dispatch unavailable");
        const first = await loadLifecycle(input.creationKey);
        const firstDocument = first.documents[0]!;
        const firstVersion = first.versions[0]!;
        const firstJob = first.jobs[0]!;

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

        expect(dispatchMock).toHaveBeenCalledTimes(2);
        const firstOptions = getDispatchOptions(getDispatchCall(0));
        const retryOptions = getDispatchOptions(getDispatchCall(1));
        expect(retryOptions).toEqual(
            expect.objectContaining({ jobId: firstJob.id, versionId: firstVersion.id })
        );
        expect(retryOptions.jobId).toBe(firstOptions.jobId);

        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, firstJob.id));
        await createDocumentLifecycle(input);
        expect(dispatchMock).toHaveBeenCalledTimes(2);
    });

    it("creates and retries a later version with one linked job and the current pointer on v2", async () => {
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

        expect(dispatchMock).toHaveBeenCalledTimes(3);
        for (const call of dispatchMock.mock.calls.slice(1)) {
            const options = getDispatchOptions(call);
            expect(options).toEqual(
                expect.objectContaining({ jobId: v2Jobs[0]!.id, versionId: v2!.id })
            );
        }

        const retriedCall = getDispatchCall(2);
        expect(retriedCall.slice(0, 6)).toEqual([
            versionInput.url,
            versionInput.title,
            versionInput.companyId.toString(),
            versionInput.userId,
            initial.document.id,
            versionInput.category,
        ]);
        expect(retriedCall[6]).toEqual({
            ...(v2Jobs[0]!.dispatchOptions ?? {}),
            jobId: v2Jobs[0]!.id,
            versionId: v2!.id,
        });
        expect(retriedCall[6].archiveIdentity).toBe(versionInput.creationKey);

        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, v2Jobs[0]!.id));
        await createDocumentVersionLifecycle(versionInput);
        const completedRetry = await loadDocumentLifecycle(initial.document.id);

        expect(completedRetry.versions).toHaveLength(2);
        expect(completedRetry.jobs).toHaveLength(2);
        expect(dispatchMock).toHaveBeenCalledTimes(3);
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

        const persisted = await loadDocumentLifecycle(initial.document.id);
        expect(persisted.jobs.find(candidate => candidate.id === job.id)?.dispatchOptions).toEqual(
            persistedDispatchOptions
        );

        const callsBeforeRetry = dispatchMock.mock.calls.length;
        await createDocumentVersionLifecycle({
            ...versionInput,
            preferredProvider: "AZURE",
            originalFilename: "retry-archive.zip",
            isWebsite: false,
            transcriptionMetadata: { source: "retry-archive" },
            embeddingIndexKey: "retry-archive-index",
        });

        expect(dispatchMock).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        const retryCall = getDispatchCall(callsBeforeRetry);
        expect(retryCall[6]).toEqual({
            ...persistedDispatchOptions,
            jobId: job.id,
            versionId: created.version.id,
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

        const callsBeforeRetry = dispatchMock.mock.calls.length;
        await createDocumentVersionLifecycle({
            ...versionInput,
            preferredProvider: "AZURE",
            originalFilename: "retry-legacy-archive-v2.zip",
            isWebsite: true,
        });

        expect(dispatchMock).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        const retryCall = getDispatchCall(callsBeforeRetry);
        expect(retryCall[6]).toEqual({
            ...legacyDispatchOptions,
            archiveIdentity: versionInput.creationKey,
            jobId: job.id,
            versionId: created.version.id,
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
            expect(dispatchMock).toHaveBeenCalledTimes(4);
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
        await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, v1Job.id));

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

            const callsBeforeRetry = dispatchMock.mock.calls.length;
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
            expect(dispatchMock).toHaveBeenCalledTimes(callsBeforeRetry + 2);

            const retryCall = dispatchMock.mock.calls
                .slice(callsBeforeRetry)
                .find(call => getDispatchOptions(call).jobId === v1Job.id);
            if (!retryCall) throw new Error("Original retry dispatch call is missing");
            expect(retryCall.slice(0, 6)).toEqual([
                initialInput.url,
                initialInput.title,
                initialInput.companyId.toString(),
                initialInput.userId,
                initial.document.id,
                initialInput.category,
            ]);
            expect(retryCall[6]).toEqual(
                expect.objectContaining({ jobId: v1Job.id, versionId: initial.version.id })
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

    it("dispatches a failed retry CAS loser after reloading a queued job", async () => {
        const input = makeParams({ processing: processing() });
        await createDocumentLifecycle(input);
        const lifecycle = await loadLifecycle(input.creationKey);
        const job = lifecycle.jobs[0]!;

        await db.update(ocrJobs).set({ status: "failed" }).where(eq(ocrJobs.id, job.id));
        const callsBeforeRetry = dispatchMock.mock.calls.length;
        dispatchMock.mockImplementation(async (...args: DispatchCall) => {
            const options = args[6];
            if (!options.jobId) throw new Error("Retry dispatch did not receive a job ID");
            return { jobId: options.jobId, eventIds: [`event-${options.jobId}`] };
        });

        const [firstRetry, secondRetry] = await Promise.all([
            createDocumentLifecycle(input),
            createDocumentLifecycle(input),
        ]);
        const afterRetry = await loadLifecycle(input.creationKey);

        expect(dispatchMock).toHaveBeenCalledTimes(callsBeforeRetry + 2);
        expect(firstRetry.jobId).toBe(job.id);
        expect(secondRetry.jobId).toBe(job.id);
        expect(afterRetry.jobs[0]?.status).toBe("queued");
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

    it("collapses concurrent duplicate requests into one document, v1, and job", async () => {
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

        for (const call of dispatchMock.mock.calls) {
            const options = getDispatchOptions(call);
            expect(options).toEqual(
                expect.objectContaining({ jobId: job!.id, versionId: version!.id })
            );
        }
    });
});
