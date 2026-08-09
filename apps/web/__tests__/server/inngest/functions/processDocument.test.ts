/**
 * Unit tests for processDocument failure and archive lifecycle contracts.
 * Verifies failed runs are marked honestly and archive-derived work keeps
 * stable provenance and lifecycle dispatch inputs.
 */
import JSZip from "jszip";
import { uploadDocument } from "~/server/inngest/functions/processDocument";
import { handleProcessDocumentFailure } from "~/server/inngest/functions/processDocumentFailure";
import {
    createDocumentLifecycle,
    type CreatedDocumentLifecycle,
} from "~/server/services/document-creation";
import { fetchFile } from "~/lib/storage";
import { putFile } from "~/server/storage/vercel-blob";
import { db } from "~/server/db";
import { runDocIngestionTool } from "~/lib/tools";
import { getDb, type DbClient } from "@launchstack/core/db";
import { finalizeStorage } from "@launchstack/core/ocr/processor";
import { document as documentTable, documentVersions, ocrJobs } from "@launchstack/core/db/schema";
import type { ProcessDocumentEventData } from "@launchstack/core/ocr/types";

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn((_options: unknown, _trigger: unknown, handler: unknown) => ({
            fn: handler,
        })),
    },
}));

jest.mock("~/lib/tools", () => ({
    runDocIngestionTool: jest.fn(),
}));

jest.mock("~/lib/storage", () => ({
    fetchFile: jest.fn(),
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    putFile: jest.fn(),
}));

jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
}));

jest.mock("~/server/db", () => ({
    db: { update: jest.fn(), delete: jest.fn() },
}));
jest.mock("@launchstack/core/db", () => ({
    getDb: jest.fn(),
}));
type UnknownMock = jest.Mock<unknown, unknown[]>;
type LifecycleResult = CreatedDocumentLifecycle;
type StoredBlobResult = Awaited<ReturnType<typeof putFile>>;
type FailureEvent = Parameters<typeof handleProcessDocumentFailure>[0]["event"];
type ArchiveResult = {
    success: true;
    extracted: number;
};

const mockDb = db as unknown as { update: UnknownMock; delete: UnknownMock };
const mockCreateDocumentLifecycle = createDocumentLifecycle as jest.MockedFunction<
    typeof createDocumentLifecycle
>;
const mockFetchFile = fetchFile as jest.MockedFunction<typeof fetchFile>;
const mockRunDocIngestionTool = runDocIngestionTool as jest.MockedFunction<
    typeof runDocIngestionTool
>;
const mockPutFile = putFile as jest.MockedFunction<typeof putFile>;
const mockGetDb = getDb as jest.MockedFunction<typeof getDb>;

type PredicateDetails = {
    columnNames: string[];
    params: unknown[];
};

function inspectPredicate(
    value: unknown,
    details: PredicateDetails = { columnNames: [], params: [] }
): PredicateDetails {
    if (!value || typeof value !== "object") return details;

    const candidate = value as {
        config?: { name?: unknown };
        value?: unknown;
        queryChunks?: unknown[];
    };
    if (typeof candidate.config?.name === "string") {
        details.columnNames.push(candidate.config.name);
    }
    const prototype = Object.getPrototypeOf(value) as {
        constructor?: { name?: unknown };
    } | null;
    if (prototype?.constructor?.name === "Param" && "value" in candidate) {
        details.params.push(candidate.value);
    }
    if (Array.isArray(candidate.queryChunks)) {
        for (const chunk of candidate.queryChunks) inspectPredicate(chunk, details);
    }
    return details;
}

type FinalizeState = {
    document: Record<string, unknown> & { id: number; currentVersionId: bigint };
    version: Record<string, unknown> & { id: number; documentId: bigint };
    job: Record<string, unknown>;
};

function configureFinalizeDb(state: FinalizeState): void {
    const coreDb = {
        insert: jest.fn(() => ({
            values: jest.fn(() => Promise.resolve(undefined)),
        })),
        update: jest.fn((table: unknown) => ({
            set: jest.fn((patch: unknown) => ({
                where: jest.fn(async (condition: unknown) => {
                    const details = inspectPredicate(condition);
                    if (
                        table === documentTable &&
                        details.columnNames.includes("current_version_id") &&
                        details.params.includes(state.document.id) &&
                        details.params.includes(state.document.currentVersionId)
                    ) {
                        Object.assign(state.document, patch);
                    } else if (
                        table === documentVersions &&
                        details.columnNames.includes("document_id") &&
                        details.params.includes(state.version.id) &&
                        details.params.includes(state.version.documentId)
                    ) {
                        Object.assign(state.version, patch);
                    } else if (table === ocrJobs) {
                        Object.assign(state.job, patch);
                    }
                    return undefined;
                }),
            })),
        })),
    };
    mockGetDb.mockReturnValue(coreDb as unknown as DbClient);
}

type FailureState = Record<string, unknown> & {
    id: number;
    currentVersionId: bigint;
};

function configureFailureDb(state: FailureState): void {
    mockDb.update.mockImplementation((table: unknown) => ({
        set: jest.fn((patch: unknown) => ({
            where: jest.fn(async (condition: unknown) => {
                const details = inspectPredicate(condition);
                if (
                    table === documentTable &&
                    details.columnNames.includes("current_version_id") &&
                    details.params.includes(state.id) &&
                    details.params.includes(state.currentVersionId)
                ) {
                    Object.assign(state, patch);
                }
                return undefined;
            }),
        })),
    }));
}

function makeChain() {
    const where = jest.fn(() => Promise.resolve(undefined));
    const set = jest.fn(() => ({ where }));
    return { set, where };
}

function makeEvent(data: Partial<ProcessDocumentEventData>): FailureEvent {
    return {
        data: {
            event: {
                data: { versionId: 1, ...data } as ProcessDocumentEventData,
            },
        },
    };
}

function makeFetchResponse(zipBuffer: Buffer): Response {
    return {
        ok: true,
        arrayBuffer: async () => zipBuffer,
    } as unknown as Response;
}

function makeStoredBlob(url: string): StoredBlobResult {
    return { url } as unknown as StoredBlobResult;
}

function makeLifecycleResult(): LifecycleResult {
    return {
        document: { id: 42 },
        version: { id: 43 },
        job: { id: "job-1" },
        documentId: 42,
        versionId: 43,
        jobId: "job-1",
        eventIds: ["event-1"],
    } as unknown as LifecycleResult;
}

function isArchiveResult(value: unknown): value is ArchiveResult {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return candidate.success === true && typeof candidate.extracted === "number";
}

function makeDuplicateEntryZip(): Buffer {
    const fileName = Buffer.from("duplicate.txt", "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(0, 18);
    localHeader.writeUInt32LE(0, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([localHeader, fileName]);

    const makeCentralEntry = (localOffset: number) => {
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(0, 16);
        centralHeader.writeUInt32LE(0, 20);
        centralHeader.writeUInt32LE(0, 24);
        centralHeader.writeUInt16LE(fileName.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(localOffset, 42);
        return Buffer.concat([centralHeader, fileName]);
    };

    const centralEntries = Buffer.concat([
        makeCentralEntry(0),
        makeCentralEntry(localEntry.length),
    ]);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(2, 8);
    endOfCentralDirectory.writeUInt16LE(2, 10);
    endOfCentralDirectory.writeUInt32LE(centralEntries.length, 12);
    endOfCentralDirectory.writeUInt32LE(localEntry.length * 2, 16);

    return Buffer.concat([localEntry, localEntry, centralEntries, endOfCentralDirectory]);
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("handleProcessDocumentFailure", () => {
    it("marks document.ocrProcessed as false (not true) on failure", async () => {
        const chain = makeChain();
        mockDb.update.mockReturnValueOnce({ set: chain.set });

        await handleProcessDocumentFailure({
            error: new Error("OCR provider timed out"),
            event: makeEvent({ documentId: 42, jobId: "job-1" }),
        });

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ ocrProcessed: false }));
    });

    it("stores the real error message in document.ocrMetadata", async () => {
        const chain = makeChain();
        mockDb.update.mockReturnValueOnce({ set: chain.set });

        await handleProcessDocumentFailure({
            error: new Error("OCR provider timed out"),
            event: makeEvent({ documentId: 42, jobId: "job-1" }),
        });

        expect(chain.set).toHaveBeenCalledWith(
            expect.objectContaining({
                ocrMetadata: expect.objectContaining({
                    error: "processing_failed",
                    errorMessage: "OCR provider timed out",
                }) as unknown,
            })
        );
    });

    it("sets ocr_jobs.status to 'failed' instead of leaving it queued", async () => {
        const docChain = makeChain();
        const jobChain = makeChain();
        mockDb.update
            .mockReturnValueOnce({ set: docChain.set })
            .mockReturnValueOnce({ set: jobChain.set });

        await handleProcessDocumentFailure({
            error: new Error("boom"),
            event: makeEvent({ documentId: 42, jobId: "job-1" }),
        });

        expect(jobChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    });

    it("does not touch ocr_jobs if jobId is missing", async () => {
        const chain = makeChain();
        mockDb.update.mockReturnValueOnce({ set: chain.set });

        await handleProcessDocumentFailure({
            error: new Error("boom"),
            event: makeEvent({ documentId: 42 }),
        });

        expect(mockDb.update).toHaveBeenCalledTimes(1);
    });

    it("does not throw if the database update itself fails", async () => {
        mockDb.update.mockImplementationOnce(() => {
            throw new Error("connection lost");
        });

        await expect(
            handleProcessDocumentFailure({
                error: new Error("original failure"),
                event: makeEvent({ documentId: 42, jobId: "job-1" }),
            })
        ).resolves.not.toThrow();
    });

    it("leaves the current document state unchanged for a stale version failure", async () => {
        const state: FailureState = {
            id: 42,
            currentVersionId: 2n,
            ocrProcessed: true,
            ocrMetadata: { version: 2 },
        };
        configureFailureDb(state);

        await handleProcessDocumentFailure({
            error: new Error("v1 failed"),
            event: makeEvent({ documentId: 42, jobId: "job-v1", versionId: 1 }),
        });

        expect(state.ocrProcessed).toBe(true);
        expect(state.ocrMetadata).toEqual({ version: 2 });
    });

    it("updates the document for a failure on its current version", async () => {
        const state: FailureState = {
            id: 42,
            currentVersionId: 2n,
            ocrProcessed: true,
            ocrMetadata: { version: 2 },
        };
        configureFailureDb(state);

        await handleProcessDocumentFailure({
            error: new Error("v2 failed"),
            event: makeEvent({ documentId: 42, jobId: "job-v2", versionId: 2 }),
        });

        expect(state.ocrProcessed).toBe(false);
        expect(state.ocrMetadata).toEqual(
            expect.objectContaining({
                error: "processing_failed",
                errorMessage: "v2 failed",
            })
        );
    });

    it("still marks legacy failure jobs when the event has no versionId", async () => {
        const jobChain = makeChain();
        mockDb.update.mockReturnValueOnce({ set: jobChain.set });

        await handleProcessDocumentFailure({
            error: new Error("legacy failure"),
            event: {
                data: {
                    event: {
                        data: {
                            documentId: 42,
                            jobId: "legacy-job",
                        } as ProcessDocumentEventData,
                    },
                },
            },
        });

        expect(mockDb.update).toHaveBeenCalledTimes(1);
        expect(jobChain.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                errorMessage: "legacy failure",
            })
        );
    });
});

describe("process document event validation", () => {
    it("rejects a missing versionId before processing begins", async () => {
        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;
        const malformedEvent = {
            jobId: "job-1",
            documentUrl: "https://blob.test/document.pdf",
            documentName: "document.pdf",
            companyId: "7",
            userId: "user-1",
            documentId: 100,
            category: "documents",
            mimeType: "application/pdf",
        } as unknown as ProcessDocumentEventData;

        await expect(handler({ event: { data: malformedEvent }, step })).rejects.toThrow(
            "Invalid versionId"
        );
        expect(mockRunDocIngestionTool).not.toHaveBeenCalled();
        expect(step.run).not.toHaveBeenCalled();
    });
});

describe("finalizeStorage version guards", () => {
    const meta = {
        totalPages: 1,
        provider: "NATIVE_PDF",
        processingTimeMs: 10,
        confidenceScore: 99,
    };

    it("does not overwrite the current document when a stale version finishes", async () => {
        const state: FinalizeState = {
            document: {
                id: 42,
                currentVersionId: 2n,
                ocrProcessed: false,
                ocrJobId: "job-v2",
                ocrProvider: "v2-provider",
                ocrMetadata: { version: 2 },
            },
            version: {
                id: 1,
                documentId: 42n,
                ocrProcessed: false,
            },
            job: { status: "processing" },
        };
        configureFinalizeDb(state);

        await finalizeStorage(42, "job-v1", 1, "v1 summary", meta, Date.now() - 10, 1);

        expect(state.document).toEqual(
            expect.objectContaining({
                currentVersionId: 2n,
                ocrProcessed: false,
                ocrJobId: "job-v2",
                ocrProvider: "v2-provider",
                ocrMetadata: { version: 2 },
            })
        );
        expect(state.version).toEqual(
            expect.objectContaining({
                id: 1,
                ocrProcessed: true,
                ocrJobId: "job-v1",
            })
        );
        expect(state.job.status).toBe("completed");
    });

    it("updates the current document when its version finishes", async () => {
        const state: FinalizeState = {
            document: {
                id: 42,
                currentVersionId: 2n,
                ocrProcessed: false,
                ocrJobId: "old-job",
                ocrProvider: "old-provider",
                ocrMetadata: { version: 1 },
            },
            version: {
                id: 2,
                documentId: 42n,
                ocrProcessed: false,
            },
            job: { status: "processing" },
        };
        configureFinalizeDb(state);

        await finalizeStorage(42, "job-v2", 3, "v2 summary", meta, Date.now() - 10, 2);

        expect(state.document).toEqual(
            expect.objectContaining({
                currentVersionId: 2n,
                ocrProcessed: true,
                ocrJobId: "job-v2",
                ocrProvider: "NATIVE_PDF",
            })
        );
        expect(state.document.ocrMetadata).toEqual(
            expect.objectContaining({
                totalPages: 1,
                totalChunks: 3,
                embeddingIndexKey: undefined,
            })
        );
        expect(state.version).toEqual(
            expect.objectContaining({
                id: 2,
                ocrProcessed: true,
                ocrJobId: "job-v2",
            })
        );
        expect(state.job.status).toBe("completed");
    });
});

describe("archive document lifecycle", () => {
    it("records normalized archive provenance and dispatch options for child and summary", async () => {
        const zip = new JSZip();
        zip.file("nested//docs/report.txt", "report");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));
        mockPutFile
            .mockResolvedValueOnce(makeStoredBlob("https://blob.test/report.txt"))
            .mockResolvedValueOnce(makeStoredBlob("https://blob.test/summary.md"));
        mockCreateDocumentLifecycle.mockResolvedValue(makeLifecycleResult());
        mockDb.delete.mockReturnValue({
            where: jest.fn(() => Promise.resolve(undefined)),
        });

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        const result = await handler({
            event: {
                data: {
                    jobId: "archive-job",
                    documentUrl: "https://blob.test/archive.zip",
                    documentName: "archive.zip",
                    originalFilename: "archive.zip",
                    companyId: "7",
                    userId: "user-1",
                    documentId: 100,
                    versionId: 43,
                    category: "documents",
                    mimeType: "application/zip",
                    archiveIdentity: "upload:archive-logical",
                    options: { embeddingIndexKey: "company-index" },
                },
            },
            step,
        });

        expect(mockCreateDocumentLifecycle).toHaveBeenCalledTimes(2);
        expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                creationKey: JSON.stringify([
                    "archive",
                    "upload:archive-logical",
                    "entry",
                    "nested/docs/report.txt",
                ]),
                sourceArchiveName: "archive.zip",
                sourceArchiveEntry: "nested/docs/report.txt",
                processing: expect.objectContaining({
                    originalFilename: "report.txt",
                    embeddingIndexKey: "company-index",
                }) as unknown,
            })
        );
        expect(mockCreateDocumentLifecycle).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                creationKey: JSON.stringify(["archive", "upload:archive-logical", "summary"]),
                sourceArchiveName: "archive.zip",
                sourceArchiveEntry: null,
                processing: expect.objectContaining({
                    originalFilename: "_project_summary.md",
                    embeddingIndexKey: "company-index",
                }) as unknown,
            })
        );
        expect(step.sendEvent).not.toHaveBeenCalled();
        if (!isArchiveResult(result)) {
            throw new Error("Archive handler returned an invalid result");
        }
        expect(result).toEqual(expect.objectContaining({ success: true, extracted: 2 }));
    });

    it("processes a queued ZIP event without archiveIdentity using legacy document-ID keys", async () => {
        const zip = new JSZip();
        zip.file("nested/report.txt", "report");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));
        mockPutFile
            .mockResolvedValueOnce(makeStoredBlob("https://blob.test/report.txt"))
            .mockResolvedValueOnce(makeStoredBlob("https://blob.test/summary.md"));
        mockCreateDocumentLifecycle.mockResolvedValue(makeLifecycleResult());
        mockDb.delete.mockReturnValue({
            where: jest.fn(() => Promise.resolve(undefined)),
        });

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        const result = await handler({
            event: {
                data: {
                    jobId: "archive-job",
                    documentUrl: "https://blob.test/archive.zip",
                    documentName: "archive.zip",
                    originalFilename: "archive.zip",
                    companyId: "7",
                    userId: "user-1",
                    documentId: 100,
                    versionId: 43,
                    category: "documents",
                    mimeType: "application/zip",
                },
            },
            step,
        });

        expect(mockCreateDocumentLifecycle.mock.calls.map(([input]) => input.creationKey)).toEqual([
            "archive:100:entry:nested/report.txt",
            "archive:100:summary",
        ]);
        expect(step.sendEvent).not.toHaveBeenCalled();
        if (!isArchiveResult(result)) {
            throw new Error("Archive handler returned an invalid result");
        }
        expect(result).toEqual(expect.objectContaining({ success: true, extracted: 2 }));
    });

    it("rejects a blank archive identity before any upload", async () => {
        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await expect(
            handler({
                event: {
                    data: {
                        jobId: "archive-job",
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity: "   ",
                    } as ProcessDocumentEventData,
                },
                step,
            })
        ).rejects.toThrow("requires archiveIdentity");

        expect(mockFetchFile).not.toHaveBeenCalled();
        expect(mockPutFile).not.toHaveBeenCalled();
        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
    });

    it("keeps opaque archive identities distinct in child and summary creation keys", async () => {
        const zip = new JSZip();
        zip.file("nested/report.txt", "report");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));
        mockPutFile.mockResolvedValue(makeStoredBlob("https://blob.test/file.txt"));
        mockCreateDocumentLifecycle.mockResolvedValue(makeLifecycleResult());
        mockDb.delete.mockReturnValue({
            where: jest.fn(() => Promise.resolve(undefined)),
        });

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        for (const archiveIdentity of ["archive", " archive "]) {
            await handler({
                event: {
                    data: {
                        jobId: `archive-job-${archiveIdentity.trim()}`,
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity,
                    },
                },
                step,
            });
        }

        const keys = mockCreateDocumentLifecycle.mock.calls.map(([input]) => input.creationKey);
        expect(keys).toEqual([
            JSON.stringify(["archive", "archive", "entry", "nested/report.txt"]),
            JSON.stringify(["archive", "archive", "summary"]),
            JSON.stringify(["archive", " archive ", "entry", "nested/report.txt"]),
            JSON.stringify(["archive", " archive ", "summary"]),
        ]);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("keeps identity and path delimiter collisions distinct", async () => {
        mockPutFile.mockResolvedValue(makeStoredBlob("https://blob.test/file.txt"));
        mockCreateDocumentLifecycle.mockResolvedValue(makeLifecycleResult());
        mockDb.delete.mockReturnValue({
            where: jest.fn(() => Promise.resolve(undefined)),
        });

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        const cases = [
            { archiveIdentity: "a:entry:b", entryPath: "c", jobId: "collision-one" },
            { archiveIdentity: "a", entryPath: "b:entry:c", jobId: "collision-two" },
        ];
        for (const { archiveIdentity, entryPath, jobId } of cases) {
            const zip = new JSZip();
            zip.file(entryPath, "report");
            const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
            mockFetchFile.mockResolvedValueOnce(makeFetchResponse(zipBuffer));

            await handler({
                event: {
                    data: {
                        jobId,
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity,
                    },
                },
                step,
            });
        }

        const keys = mockCreateDocumentLifecycle.mock.calls.map(([input]) => input.creationKey);
        expect(keys).toEqual([
            JSON.stringify(["archive", "a:entry:b", "entry", "c"]),
            JSON.stringify(["archive", "a:entry:b", "summary"]),
            JSON.stringify(["archive", "a", "entry", "b:entry:c"]),
            JSON.stringify(["archive", "a", "summary"]),
        ]);
        expect(keys[0]).not.toBe(keys[2]);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("uses identical child and summary keys when source document IDs differ", async () => {
        const zip = new JSZip();
        zip.file("nested/report.txt", "report");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));
        mockPutFile.mockResolvedValue(makeStoredBlob("https://blob.test/file.txt"));
        mockCreateDocumentLifecycle.mockResolvedValue(makeLifecycleResult());
        mockDb.delete.mockReturnValue({
            where: jest.fn(() => Promise.resolve(undefined)),
        });

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await handler({
            event: {
                data: {
                    jobId: "archive-job-100",
                    documentUrl: "https://blob.test/archive.zip",
                    documentName: "archive.zip",
                    originalFilename: "archive.zip",
                    companyId: "7",
                    userId: "user-1",
                    documentId: 100,
                    versionId: 43,
                    category: "documents",
                    mimeType: "application/zip",
                    archiveIdentity: "upload:archive-logical",
                },
            },
            step,
        });
        const firstKeys = mockCreateDocumentLifecycle.mock.calls.map(
            ([input]) => input.creationKey
        );

        await handler({
            event: {
                data: {
                    jobId: "archive-job-200",
                    documentUrl: "https://blob.test/archive.zip",
                    documentName: "archive.zip",
                    originalFilename: "archive.zip",
                    companyId: "7",
                    userId: "user-1",
                    documentId: 200,
                    versionId: 43,
                    category: "documents",
                    mimeType: "application/zip",
                    archiveIdentity: "upload:archive-logical",
                },
            },
            step,
        });
        const secondKeys = mockCreateDocumentLifecycle.mock.calls
            .slice(firstKeys.length)
            .map(([input]) => input.creationKey);

        expect(firstKeys).toEqual([
            JSON.stringify(["archive", "upload:archive-logical", "entry", "nested/report.txt"]),
            JSON.stringify(["archive", "upload:archive-logical", "summary"]),
        ]);
        expect(secondKeys).toEqual(firstKeys);
    });

    it("rejects traversal entries before any upload or lifecycle call", async () => {
        const zip = new JSZip();
        zip.file("../escape.txt", "escape");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await expect(
            handler({
                event: {
                    data: {
                        jobId: "archive-job",
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity: "upload:archive-logical",
                    },
                },
                step,
            })
        ).rejects.toThrow("Invalid ZIP entry path");

        expect(mockPutFile).not.toHaveBeenCalled();
        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
        expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("rejects duplicate canonical entry paths before any upload", async () => {
        const zip = new JSZip();
        zip.file("nested/report.txt", "first");
        zip.file("nested/report.txt/", "duplicate");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await expect(
            handler({
                event: {
                    data: {
                        jobId: "archive-job",
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity: "upload:archive-logical",
                    },
                },
                step,
            })
        ).rejects.toThrow("Duplicate ZIP entry path");

        expect(mockPutFile).not.toHaveBeenCalled();
        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
        expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("rejects exact duplicate central-directory entries before any upload", async () => {
        mockFetchFile.mockResolvedValue(makeFetchResponse(makeDuplicateEntryZip()));

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await expect(
            handler({
                event: {
                    data: {
                        jobId: "archive-job",
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity: "upload:archive-logical",
                    },
                },
                step,
            })
        ).rejects.toThrow("Duplicate ZIP entry path");

        expect(mockPutFile).not.toHaveBeenCalled();
        expect(mockCreateDocumentLifecycle).not.toHaveBeenCalled();
        expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("propagates lifecycle failures and preserves the source ZIP for retry", async () => {
        const zip = new JSZip();
        zip.file("nested/report.txt", "report");
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

        mockFetchFile.mockResolvedValue(makeFetchResponse(zipBuffer));
        mockPutFile.mockResolvedValueOnce(makeStoredBlob("https://blob.test/report.txt"));
        mockCreateDocumentLifecycle.mockRejectedValueOnce(new Error("lifecycle dispatch failed"));

        const step = {
            run: jest.fn(async (_name: string, operation: () => Promise<unknown>) => operation()),
            sendEvent: jest.fn(),
        };
        const handler = (
            uploadDocument as unknown as {
                fn: (context: {
                    event: { data: ProcessDocumentEventData };
                    step: typeof step;
                }) => Promise<unknown>;
            }
        ).fn;

        await expect(
            handler({
                event: {
                    data: {
                        jobId: "archive-job",
                        documentUrl: "https://blob.test/archive.zip",
                        documentName: "archive.zip",
                        originalFilename: "archive.zip",
                        companyId: "7",
                        userId: "user-1",
                        documentId: 100,
                        versionId: 43,
                        category: "documents",
                        mimeType: "application/zip",
                        archiveIdentity: "upload:archive-logical",
                    },
                },
                step,
            })
        ).rejects.toThrow("lifecycle dispatch failed");

        expect(mockPutFile).toHaveBeenCalledTimes(1);
        expect(mockCreateDocumentLifecycle).toHaveBeenCalledTimes(1);
        expect(mockDb.delete).not.toHaveBeenCalled();
    });
});
