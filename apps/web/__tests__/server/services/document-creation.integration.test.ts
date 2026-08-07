import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const engineDb = databaseUrl
        ? jest.requireActual("@launchstack/core/db").createDb({ url: databaseUrl }).db
        : undefined;

    return {
        getEngine: jest.fn(() => ({ db: engineDb })),
    };
});

jest.mock("@launchstack/core/ocr/trigger", () => ({
    ...jest.requireActual("@launchstack/core/ocr/trigger"),
    triggerDocumentProcessing: jest.fn(),
}));

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
} from "~/server/services/document-creation";

type LifecycleParams = Parameters<typeof createDocumentLifecycle>[0];
type Processing = NonNullable<LifecycleParams["processing"]>;
type DispatchOptions = { jobId?: string; versionId?: number };

const dispatchMock = triggerDocumentProcessing as unknown as jest.Mock;
const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

integrationDescribe("createDocumentLifecycle (database)", () => {
    let companyId: bigint | undefined;
    let userId: string;

    beforeEach(async () => {
        dispatchMock.mockReset();
        dispatchMock.mockImplementation(async (...args: unknown[]) => {
            const options = args[6] as DispatchOptions | undefined;
            const jobId = options?.jobId ?? `mock-job-${randomUUID()}`;
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
            .where(and(eq(document.companyId, companyId), eq(document.creationKey, creationKey)));
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
        expect(doc?.creationKey).toBe(input.creationKey);
        expect(version?.creationKey).toBe(input.creationKey);

        expect(result.document.id).toBe(doc!.id);
        expect(result.version.id).toBe(version!.id);
        expect(result.job?.id).toBe(job!.id);

        expect(dispatchMock).toHaveBeenCalledTimes(1);
        const dispatchCall = dispatchMock.mock.calls[0] as unknown[];
        expect(dispatchCall[6]).toEqual(
            expect.objectContaining({ jobId: job!.id, versionId: version!.id })
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
        expect(version?.creationKey).toBe(input.creationKey);
        expect(result.document.id).toBe(doc!.id);
        expect(result.version.id).toBe(version!.id);
        expect(result.job).toBeFalsy();
        expect(dispatchMock).not.toHaveBeenCalled();
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
        const firstOptions = (dispatchMock.mock.calls[0] as unknown[])[6] as DispatchOptions;
        const retryOptions = (dispatchMock.mock.calls[1] as unknown[])[6] as DispatchOptions;
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
            embeddingIndexKey: "integration-test-index",
        };

        const created = await createDocumentVersionLifecycle(versionInput);
        const retried = await createDocumentVersionLifecycle(versionInput);
        const lifecycle = await loadDocumentLifecycle(initial.document.id);
        const [doc] = lifecycle.documents;
        const versions = [...lifecycle.versions].sort(
            (left, right) => left.versionNumber - right.versionNumber
        );
        const [v1, v2] = versions;
        const v2Jobs = lifecycle.jobs.filter(job => job.versionId === BigInt(v2!.id));

        expect(lifecycle.documents).toHaveLength(1);
        expect(versions).toHaveLength(2);
        expect(lifecycle.jobs).toHaveLength(2);
        expect(v1?.versionNumber).toBe(1);
        expect(v2?.versionNumber).toBe(2);
        expect(v2?.creationKey).toBe(versionInput.creationKey);
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
            const options = call[6] as DispatchOptions;
            expect(options).toEqual(
                expect.objectContaining({ jobId: v2Jobs[0]!.id, versionId: v2!.id })
            );
        }

        await db.update(ocrJobs).set({ status: "completed" }).where(eq(ocrJobs.id, v2Jobs[0]!.id));
        await createDocumentVersionLifecycle(versionInput);
        const completedRetry = await loadDocumentLifecycle(initial.document.id);

        expect(completedRetry.versions).toHaveLength(2);
        expect(completedRetry.jobs).toHaveLength(2);
        expect(dispatchMock).toHaveBeenCalledTimes(3);
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
            const options = call[6] as DispatchOptions;
            expect(options).toEqual(
                expect.objectContaining({ jobId: job!.id, versionId: version!.id })
            );
        }
    });
});
