import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
    document,
    documentVersions,
    ocrJobs,
    type Document,
    type DocumentVersion,
    type OcrJob,
} from "@launchstack/core/db/schema";
import type { OCRProvider } from "@launchstack/core/ocr/types";
import { parseProvider, triggerDocumentProcessing } from "@launchstack/core/ocr/trigger";
import { db } from "~/server/db";

const CREATION_KEY_NAMESPACE = "launchstack:document-creation:v1:";

function hashCreationKey(rawCreationKey: string): string {
    return createHash("sha256")
        .update(CREATION_KEY_NAMESPACE, "utf8")
        .update(rawCreationKey, "utf8")
        .digest("hex");
}

export interface DocumentCreationProcessing {
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
}

type DispatchRoutingOptions = {
    preferredProvider?: OCRProvider;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    mimeType?: string;
};

function createDispatchRoutingOptions(params: {
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    mimeType: string;
}): DispatchRoutingOptions {
    return {
        preferredProvider: parseProvider(params.preferredProvider),
        originalFilename: params.originalFilename,
        isWebsite: params.isWebsite,
        transcriptionMetadata: params.transcriptionMetadata,
        embeddingIndexKey: params.embeddingIndexKey,
        mimeType: params.mimeType,
    };
}

export interface CreateDocumentLifecycleParams {
    companyId: bigint;
    userId: string;
    title: string;
    category: string;
    url: string;
    creationKey: string;
    processingUrl?: string;
    mimeType?: string | null;
    sourceArchiveName?: string | null;
    sourceArchiveEntry?: string | null;
    ocrEnabled?: boolean;
    ocrProcessed?: boolean;
    ocrMetadata?: Record<string, unknown> | null;
    processing?: DocumentCreationProcessing;
}

export interface DocumentLifecycleJob extends OcrJob {
    eventIds: string[];
}

export interface CreatedDocumentLifecycle {
    document: Document;
    version: DocumentVersion;
    job: DocumentLifecycleJob | null;
    documentId: number;
    versionId: number;
    jobId: string | null;
    eventIds: string[];
}

export interface CreateDocumentVersionLifecycleParams {
    documentId: number;
    companyId: bigint;
    userId: string;
    title: string;
    category: string;
    url: string;
    creationKey: string;
    mimeType: string;
    fileSize?: number | bigint | null;
    changelog?: string | null;
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
}

export type CreatedDocumentVersionLifecycle = Omit<CreatedDocumentLifecycle, "job" | "jobId"> & {
    job: DocumentLifecycleJob;
    jobId: string;
};

type TransactionLifecycle = {
    document: Document;
    version: DocumentVersion;
    job: OcrJob | null;
    shouldDispatch: boolean;
};

/**
 * Atomically creates the document lifecycle and dispatches processing only
 * after the transaction commits. `creationKey` makes both creation and
 * dispatch retries converge on the same rows and job ID.
 */
export async function createDocumentLifecycle(
    params: CreateDocumentLifecycleParams
): Promise<CreatedDocumentLifecycle> {
    const creationKey = hashCreationKey(params.creationKey);
    const processing = params.processing;
    const candidateJobId = processing ? randomUUID() : null;
    const resolvedMimeType = params.mimeType ?? "application/octet-stream";
    const initialDispatchOptions = processing
        ? createDispatchRoutingOptions({
              preferredProvider: processing.preferredProvider,
              originalFilename: processing.originalFilename,
              isWebsite: processing.isWebsite,
              transcriptionMetadata: processing.transcriptionMetadata,
              embeddingIndexKey: processing.embeddingIndexKey,
              mimeType: resolvedMimeType,
          })
        : null;

    const lifecycle = await db.transaction(async (tx): Promise<TransactionLifecycle> => {
        const [insertedDocument] = await tx
            .insert(document)
            .values({
                url: params.url,
                category: params.category,
                title: params.title,
                companyId: params.companyId,
                ocrEnabled: params.ocrEnabled ?? Boolean(processing),
                ocrProcessed: params.ocrProcessed ?? false,
                ocrMetadata: params.ocrMetadata ?? null,
                ocrJobId: candidateJobId,
                mimeType: resolvedMimeType,
                sourceArchiveName: params.sourceArchiveName ?? null,
                sourceArchiveEntry: params.sourceArchiveEntry ?? null,
                fileType: resolvedMimeType,
                creationKey,
            })
            .onConflictDoNothing({
                target: [document.companyId, document.creationKey],
            })
            .returning();

        const inserted = Boolean(insertedDocument);
        let lifecycleDocument = insertedDocument;

        if (!lifecycleDocument) {
            const [existingDocument] = await tx
                .select()
                .from(document)
                .where(
                    and(
                        eq(document.companyId, params.companyId),
                        eq(document.creationKey, creationKey)
                    )
                )
                .limit(1);
            lifecycleDocument = existingDocument;
        }

        if (!lifecycleDocument) {
            throw new Error(
                `Document creation conflict did not produce a row for key ${params.creationKey}`
            );
        }

        let lifecycleVersion: DocumentVersion | undefined;
        if (inserted) {
            const [insertedVersion] = await tx
                .insert(documentVersions)
                .values({
                    documentId: BigInt(lifecycleDocument.id),
                    versionNumber: 1,
                    url: params.url,
                    mimeType: resolvedMimeType,
                    uploadedBy: params.userId,
                    ocrJobId: candidateJobId,
                    ocrProcessed: params.ocrProcessed ?? false,
                    ocrMetadata: params.ocrMetadata ?? null,
                    creationKey,
                })
                .onConflictDoNothing({
                    target: [documentVersions.documentId, documentVersions.creationKey],
                })
                .returning();
            lifecycleVersion = insertedVersion;
        }

        if (!lifecycleVersion) {
            const [creationVersion] = await tx
                .select()
                .from(documentVersions)
                .where(
                    and(
                        eq(documentVersions.documentId, BigInt(lifecycleDocument.id)),
                        eq(documentVersions.creationKey, creationKey)
                    )
                )
                .limit(1);
            lifecycleVersion = creationVersion;
        }

        if (!lifecycleVersion && lifecycleDocument.currentVersionId !== null) {
            const [currentVersion] = await tx
                .select()
                .from(documentVersions)
                .where(eq(documentVersions.id, Number(lifecycleDocument.currentVersionId)))
                .limit(1);
            lifecycleVersion = currentVersion;
        }

        if (!lifecycleVersion) {
            throw new Error(
                `Document ${lifecycleDocument.id} has no version for creation key ${params.creationKey}`
            );
        }

        const lifecycleVersionId = BigInt(lifecycleVersion.id);
        const currentVersionId = lifecycleDocument.currentVersionId;
        const pointsToLifecycleVersion = currentVersionId === lifecycleVersionId;
        const shouldSetCurrentVersion = inserted || currentVersionId === null;
        const shouldRepairMime = inserted || currentVersionId === null || pointsToLifecycleVersion;

        if (shouldSetCurrentVersion || shouldRepairMime) {
            const [updatedDocument] = await tx
                .update(document)
                .set({
                    currentVersionId: currentVersionId ?? lifecycleVersionId,
                    mimeType: shouldRepairMime
                        ? lifecycleVersion.mimeType
                        : lifecycleDocument.mimeType,
                    fileType: shouldRepairMime
                        ? lifecycleVersion.mimeType
                        : lifecycleDocument.fileType,
                })
                .where(eq(document.id, lifecycleDocument.id))
                .returning();
            lifecycleDocument = updatedDocument ?? lifecycleDocument;
        }

        let lifecycleJob: OcrJob | undefined;
        const linkedJobId = lifecycleVersion.ocrJobId ?? lifecycleDocument.ocrJobId;
        if (linkedJobId) {
            const [linkedJob] = await tx
                .select()
                .from(ocrJobs)
                .where(eq(ocrJobs.id, linkedJobId))
                .limit(1);
            lifecycleJob = linkedJob;
        }

        if (!lifecycleJob) {
            const [versionJob] = await tx
                .select()
                .from(ocrJobs)
                .where(
                    and(
                        eq(ocrJobs.documentId, BigInt(lifecycleDocument.id)),
                        eq(ocrJobs.versionId, BigInt(lifecycleVersion.id))
                    )
                )
                .limit(1);
            lifecycleJob = versionJob;
        }

        if (lifecycleJob) {
            const expectedDocumentId = BigInt(lifecycleDocument.id);
            const expectedVersionId = BigInt(lifecycleVersion.id);
            if (
                lifecycleJob.documentId !== expectedDocumentId ||
                lifecycleJob.versionId !== expectedVersionId
            ) {
                throw new Error(
                    `OCR job ${lifecycleJob.id} is not linked to document ${lifecycleDocument.id} version ${lifecycleVersion.id}`
                );
            }
        } else if (inserted && processing && candidateJobId) {
            const [insertedJob] = await tx
                .insert(ocrJobs)
                .values({
                    id: candidateJobId,
                    documentId: BigInt(lifecycleDocument.id),
                    versionId: BigInt(lifecycleVersion.id),
                    companyId: params.companyId,
                    userId: params.userId,
                    status: "queued",
                    documentUrl: params.processingUrl ?? params.url,
                    documentName: params.title,
                    dispatchOptions: initialDispatchOptions,
                })
                .returning();
            lifecycleJob = insertedJob;
        }

        if (inserted && processing && !lifecycleJob) {
            throw new Error(`Failed to create OCR job for document ${lifecycleDocument.id}`);
        }

        return {
            document: lifecycleDocument,
            version: lifecycleVersion,
            job: lifecycleJob ?? null,
            shouldDispatch:
                Boolean(lifecycleJob) &&
                (inserted ||
                    lifecycleJob?.status === "queued" ||
                    lifecycleJob?.status === "failed"),
        };
    });

    let job = lifecycle.job ? { ...lifecycle.job, eventIds: [] } : null;
    if (!lifecycle.shouldDispatch || !job) {
        return {
            document: lifecycle.document,
            version: lifecycle.version,
            job,
            documentId: lifecycle.document.id,
            versionId: lifecycle.version.id,
            jobId: job?.id ?? null,
            eventIds: [],
        };
    }

    if (job.status === "failed") {
        while (true) {
            const [queuedJob] = await db
                .update(ocrJobs)
                .set({ status: "queued", errorMessage: null })
                .where(and(eq(ocrJobs.id, job.id), eq(ocrJobs.status, "failed")))
                .returning();
            if (queuedJob) {
                job = { ...queuedJob, eventIds: [] };
                break;
            }

            const [currentJob] = await db
                .select()
                .from(ocrJobs)
                .where(eq(ocrJobs.id, job.id))
                .limit(1);
            if (!currentJob) {
                throw new Error(`OCR job ${job.id} disappeared during retry claim`);
            }
            if (
                currentJob.status === "processing" ||
                currentJob.status === "completed" ||
                currentJob.status === "needs_review"
            ) {
                return {
                    document: lifecycle.document,
                    version: lifecycle.version,
                    job: { ...currentJob, eventIds: [] },
                    documentId: lifecycle.document.id,
                    versionId: lifecycle.version.id,
                    jobId: currentJob.id,
                    eventIds: [],
                };
            }
            job = { ...currentJob, eventIds: [] };
            if (job.status === "queued") break;
        }
    }

    const routingOptions =
        job.dispatchOptions === null
            ? createDispatchRoutingOptions({
                  preferredProvider: processing?.preferredProvider,
                  originalFilename: processing?.originalFilename,
                  isWebsite: processing?.isWebsite,
                  transcriptionMetadata: processing?.transcriptionMetadata,
                  embeddingIndexKey: processing?.embeddingIndexKey,
                  mimeType: lifecycle.version.mimeType,
              })
            : (job.dispatchOptions as DispatchRoutingOptions);

    try {
        const dispatch = await triggerDocumentProcessing(
            job.documentUrl,
            job.documentName,
            lifecycle.document.companyId.toString(),
            job.userId,
            lifecycle.document.id,
            lifecycle.document.category,
            {
                ...routingOptions,
                jobId: job.id,
                versionId: lifecycle.version.id,
            }
        );

        const dispatchedJob = { ...job, eventIds: dispatch.eventIds };
        return {
            document: lifecycle.document,
            version: lifecycle.version,
            job: dispatchedJob,
            documentId: lifecycle.document.id,
            versionId: lifecycle.version.id,
            jobId: dispatchedJob.id,
            eventIds: dispatch.eventIds,
        };
    } catch (error) {
        try {
            await db
                .update(ocrJobs)
                .set({
                    status: "failed",
                    errorMessage: error instanceof Error ? error.message : String(error),
                })
                .where(and(eq(ocrJobs.id, job.id), inArray(ocrJobs.status, ["queued", "failed"])));
        } catch (markFailedError) {
            console.error(`Failed to mark OCR job ${job.id} as failed:`, markFailedError);
        }
        throw error;
    }
}

type VersionTransactionLifecycle = {
    document: Document;
    version: DocumentVersion;
    job: OcrJob;
    shouldDispatch: boolean;
};

function isVersionNumberConflict(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("doc_versions_document_version_unique");
}

/**
 * Atomically creates a later document version and its linked OCR job, then
 * dispatches processing only after the transaction commits. The creation key
 * makes retries reuse the same version and job rows.
 */
export async function createDocumentVersionLifecycle(
    params: CreateDocumentVersionLifecycleParams
): Promise<CreatedDocumentVersionLifecycle> {
    const creationKey = hashCreationKey(params.creationKey);
    const versionDispatchOptions = createDispatchRoutingOptions({
        preferredProvider: params.preferredProvider,
        originalFilename: params.originalFilename,
        isWebsite: params.isWebsite,
        transcriptionMetadata: params.transcriptionMetadata,
        embeddingIndexKey: params.embeddingIndexKey,
        mimeType: params.mimeType,
    });
    let lifecycle: VersionTransactionLifecycle | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            lifecycle = await db.transaction(async (tx): Promise<VersionTransactionLifecycle> => {
                const [lifecycleDocument] = await tx
                    .select()
                    .from(document)
                    .where(
                        and(
                            eq(document.id, params.documentId),
                            eq(document.companyId, params.companyId)
                        )
                    )
                    .limit(1);

                if (!lifecycleDocument) {
                    throw new Error(`Document ${params.documentId} was not found`);
                }

                let lifecycleVersion: DocumentVersion | undefined;
                let inserted = false;

                const [existingVersion] = await tx
                    .select()
                    .from(documentVersions)
                    .where(
                        and(
                            eq(documentVersions.documentId, BigInt(params.documentId)),
                            eq(documentVersions.creationKey, creationKey)
                        )
                    )
                    .limit(1);
                lifecycleVersion = existingVersion;

                if (!lifecycleVersion) {
                    const [maxRow] = await tx
                        .select({
                            maxVersion: sql<number>`COALESCE(MAX(${documentVersions.versionNumber}), 0)`,
                        })
                        .from(documentVersions)
                        .where(eq(documentVersions.documentId, BigInt(params.documentId)));

                    const candidateJobId = randomUUID();
                    const [insertedVersion] = await tx
                        .insert(documentVersions)
                        .values({
                            documentId: BigInt(params.documentId),
                            versionNumber: (maxRow?.maxVersion ?? 0) + 1,
                            url: params.url,
                            mimeType: params.mimeType,
                            fileSize:
                                params.fileSize === null || params.fileSize === undefined
                                    ? null
                                    : BigInt(params.fileSize),
                            uploadedBy: params.userId,
                            changelog: params.changelog ?? null,
                            ocrJobId: candidateJobId,
                            ocrProcessed: false,
                            creationKey,
                        })
                        .onConflictDoNothing({
                            target: [documentVersions.documentId, documentVersions.creationKey],
                        })
                        .returning();

                    lifecycleVersion = insertedVersion;
                    inserted = Boolean(insertedVersion);

                    if (!lifecycleVersion) {
                        const [racedVersion] = await tx
                            .select()
                            .from(documentVersions)
                            .where(
                                and(
                                    eq(documentVersions.documentId, BigInt(params.documentId)),
                                    eq(documentVersions.creationKey, creationKey)
                                )
                            )
                            .limit(1);
                        lifecycleVersion = racedVersion;
                    }
                }

                if (!lifecycleVersion) {
                    throw new Error(
                        `Document ${params.documentId} has no version for creation key ${params.creationKey}`
                    );
                }

                let lifecycleJob: OcrJob | undefined;
                if (lifecycleVersion.ocrJobId) {
                    const [linkedJob] = await tx
                        .select()
                        .from(ocrJobs)
                        .where(eq(ocrJobs.id, lifecycleVersion.ocrJobId))
                        .limit(1);
                    lifecycleJob = linkedJob;
                }

                if (!lifecycleJob) {
                    const [versionJob] = await tx
                        .select()
                        .from(ocrJobs)
                        .where(
                            and(
                                eq(ocrJobs.documentId, BigInt(params.documentId)),
                                eq(ocrJobs.versionId, BigInt(lifecycleVersion.id))
                            )
                        )
                        .limit(1);
                    lifecycleJob = versionJob;
                }

                if (!lifecycleJob) {
                    const jobId = lifecycleVersion.ocrJobId ?? randomUUID();
                    const [insertedJob] = await tx
                        .insert(ocrJobs)
                        .values({
                            id: jobId,
                            documentId: BigInt(params.documentId),
                            versionId: BigInt(lifecycleVersion.id),
                            companyId: params.companyId,
                            userId: params.userId,
                            status: "queued",
                            documentUrl: params.url,
                            documentName: params.title,
                            dispatchOptions: versionDispatchOptions,
                        })
                        .returning();

                    if (!insertedJob) {
                        throw new Error(
                            `Failed to create OCR job for document ${params.documentId} version ${lifecycleVersion.id}`
                        );
                    }

                    lifecycleJob = insertedJob;

                    if (!lifecycleVersion.ocrJobId) {
                        const [updatedVersion] = await tx
                            .update(documentVersions)
                            .set({ ocrJobId: lifecycleJob.id })
                            .where(eq(documentVersions.id, lifecycleVersion.id))
                            .returning();
                        lifecycleVersion = updatedVersion ?? lifecycleVersion;
                    }
                }

                const expectedDocumentId = BigInt(params.documentId);
                const expectedVersionId = BigInt(lifecycleVersion.id);
                if (
                    lifecycleJob.documentId !== expectedDocumentId ||
                    lifecycleJob.versionId !== expectedVersionId
                ) {
                    throw new Error(
                        `OCR job ${lifecycleJob.id} is not linked to document ${params.documentId} version ${lifecycleVersion.id}`
                    );
                }

                let lifecycleDocumentResult = lifecycleDocument;
                if (inserted) {
                    const [updatedDocument] = await tx
                        .update(document)
                        .set({
                            currentVersionId: expectedVersionId,
                            url: params.url,
                            mimeType: params.mimeType,
                            ocrJobId: lifecycleJob.id,
                        })
                        .where(eq(document.id, params.documentId))
                        .returning();
                    lifecycleDocumentResult = updatedDocument ?? lifecycleDocument;
                } else {
                    const [refreshedDocument] = await tx
                        .select()
                        .from(document)
                        .where(eq(document.id, params.documentId))
                        .limit(1);
                    lifecycleDocumentResult = refreshedDocument ?? lifecycleDocument;
                }

                return {
                    document: lifecycleDocumentResult,
                    version: lifecycleVersion,
                    job: lifecycleJob,
                    shouldDispatch:
                        lifecycleJob.status === "queued" || lifecycleJob.status === "failed",
                };
            });
            break;
        } catch (error) {
            if (attempt === 0 && isVersionNumberConflict(error)) {
                continue;
            }
            throw error;
        }
    }

    if (!lifecycle) {
        throw new Error(`Failed to create version lifecycle for document ${params.documentId}`);
    }

    let job: DocumentLifecycleJob = { ...lifecycle.job, eventIds: [] };
    if (!lifecycle.shouldDispatch) {
        return {
            document: lifecycle.document,
            version: lifecycle.version,
            job,
            documentId: lifecycle.document.id,
            versionId: lifecycle.version.id,
            jobId: job.id,
            eventIds: [],
        };
    }
    if (job.status === "failed") {
        while (true) {
            const [queuedJob] = await db
                .update(ocrJobs)
                .set({ status: "queued", errorMessage: null })
                .where(and(eq(ocrJobs.id, job.id), eq(ocrJobs.status, "failed")))
                .returning();
            if (queuedJob) {
                job = { ...queuedJob, eventIds: [] };
                break;
            }

            const [currentJob] = await db
                .select()
                .from(ocrJobs)
                .where(eq(ocrJobs.id, job.id))
                .limit(1);
            if (!currentJob) {
                throw new Error(`OCR job ${job.id} disappeared during retry claim`);
            }
            if (
                currentJob.status === "processing" ||
                currentJob.status === "completed" ||
                currentJob.status === "needs_review"
            ) {
                return {
                    document: lifecycle.document,
                    version: lifecycle.version,
                    job: { ...currentJob, eventIds: [] },
                    documentId: lifecycle.document.id,
                    versionId: lifecycle.version.id,
                    jobId: currentJob.id,
                    eventIds: [],
                };
            }
            job = { ...currentJob, eventIds: [] };
            if (job.status === "queued") break;
        }
    }

    const routingOptions =
        job.dispatchOptions === null
            ? createDispatchRoutingOptions({
                  preferredProvider: params.preferredProvider,
                  originalFilename: params.originalFilename,
                  isWebsite: params.isWebsite,
                  transcriptionMetadata: params.transcriptionMetadata,
                  embeddingIndexKey: params.embeddingIndexKey,
                  mimeType: lifecycle.version.mimeType,
              })
            : (job.dispatchOptions as DispatchRoutingOptions);

    try {
        const dispatch = await triggerDocumentProcessing(
            job.documentUrl,
            job.documentName,
            lifecycle.document.companyId.toString(),
            job.userId,
            lifecycle.document.id,
            lifecycle.document.category,
            {
                ...routingOptions,
                jobId: job.id,
                versionId: lifecycle.version.id,
            }
        );

        const dispatchedJob = { ...job, eventIds: dispatch.eventIds };
        return {
            document: lifecycle.document,
            version: lifecycle.version,
            job: dispatchedJob,
            documentId: lifecycle.document.id,
            versionId: lifecycle.version.id,
            jobId: dispatchedJob.id,
            eventIds: dispatch.eventIds,
        };
    } catch (error) {
        try {
            await db
                .update(ocrJobs)
                .set({
                    status: "failed",
                    errorMessage: error instanceof Error ? error.message : String(error),
                })
                .where(and(eq(ocrJobs.id, job.id), inArray(ocrJobs.status, ["queued", "failed"])));
        } catch (markFailedError) {
            console.error(`Failed to mark OCR job ${job.id} as failed:`, markFailedError);
        }
        throw error;
    }
}
