/**
 * Source-version lifecycle — moved from apps/web/src/server/services/
 * document-creation.ts (which now re-exports this module) and converted from
 * dispatch-after-commit to a transactional outbox (ADR-003).
 *
 * What changed vs the web original:
 * - The post-commit `triggerDocumentProcessing` (Inngest send) is gone. When
 *   a lifecycle decides processing should run, it enqueues the
 *   `source.version.created` event INSIDE the same transaction that creates
 *   the document/version/job rows. The crash window that stranded jobs in
 *   `queued` no longer exists.
 * - A converged-on `failed` job is returned to `queued` inside the
 *   transaction (we hold the document row lock, so the old post-commit CAS
 *   loop is unnecessary), and the outbox row is revived from
 *   `dead`/`processed` so a re-upload re-runs the idempotent pipeline.
 * - `eventIds` in the returned shapes is always `[]` — it used to carry
 *   Inngest event ids; kept for call-site compatibility.
 *
 * Everything else — creation-key hashing, conflict convergence, version
 * adoption, job repair — is behavior-identical to the web original.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
    document,
    documentVersions,
    eventOutbox,
    ocrJobs,
    type Document,
    type DocumentVersion,
    type OcrJob,
} from "../db/schema";
import type { OCRProvider } from "../ocr/types";
import { parseProvider } from "../ocr/trigger";
import { getDb, type DbClient } from "../db";
import { pipelineEventSchema, type SourceVersionCreatedEvent } from "@launchstack/protocol";

import { buildSourceVersionCreatedEvent } from "./source-events";

const CREATION_KEY_NAMESPACE = "launchstack:document-creation:v1:";

function hashCreationKey(rawCreationKey: string): string {
    return createHash("sha256")
        .update(CREATION_KEY_NAMESPACE, "utf8")
        .update(rawCreationKey, "utf8")
        .digest("hex");
}

/**
 * Resolve the document a creation key has already produced, if any.
 *
 * Callers that re-import the same logical source repeatedly (connectors) need
 * to tell "never seen", "unchanged" and "changed" apart *before* uploading a
 * payload to blob storage. Exposing this lookup keeps the key-hashing scheme
 * private to this module.
 */
export async function findDocumentByCreationKey(
    companyId: bigint,
    rawCreationKey: string
): Promise<Document | null> {
    const [row] = await getDb()
        .select()
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                eq(document.creationKey, hashCreationKey(rawCreationKey))
            )
        )
        .limit(1);
    return row ?? null;
}

export interface DocumentCreationProcessing {
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
}

type DispatchRoutingOptions = {
    archiveIdentity?: string;
    preferredProvider?: OCRProvider;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    mimeType?: string;
    forceOCR?: boolean;
};

function createDispatchRoutingOptions(params: {
    archiveIdentity?: string;
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    mimeType: string;
}): DispatchRoutingOptions {
    return {
        archiveIdentity: params.archiveIdentity,
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
    /** Correlates the command across web, outbox and worker. Defaults to the job id. */
    traceId?: string;
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
    /**
     * URL handed to the extraction stage, when it differs from the one stored
     * on the row. The database storage backend yields relative URLs that the
     * UI resolves per request but a worker in another process cannot fetch.
     * Mirrors `processingUrl` on {@link CreateDocumentLifecycleParams};
     * defaults to `url`.
     */
    processingUrl?: string;
    creationKey: string;
    mimeType: string;
    fileSize?: number | bigint | null;
    changelog?: string | null;
    preferredProvider?: string;
    originalFilename?: string;
    isWebsite?: boolean;
    transcriptionMetadata?: Record<string, unknown>;
    embeddingIndexKey?: string;
    /** Correlates the command across web, outbox and worker. Defaults to the job id. */
    traceId?: string;
}

export type CreatedDocumentVersionLifecycle = Omit<CreatedDocumentLifecycle, "job" | "jobId"> & {
    job: DocumentLifecycleJob;
    jobId: string;
};

type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Upsert the event row inside the lifecycle transaction. A live `pending`/
 * `processing` row is left untouched (the pipeline is already running); a
 * `dead` or `processed` row is revived to `pending` with a fresh attempt
 * budget, which is what makes "re-upload a failed document" re-run the
 * idempotent pipeline (the old failed→queued redispatch semantics).
 */
async function enqueueSourceEventInTx(tx: Tx, event: SourceVersionCreatedEvent): Promise<void> {
    const parsed = pipelineEventSchema.parse(event);
    await tx
        .insert(eventOutbox)
        .values({
            eventId: parsed.eventId,
            eventType: parsed.eventType,
            schemaVersion: parsed.schemaVersion,
            companyId: parsed.companyId,
            payload: parsed as unknown as Record<string, unknown>,
            traceId: parsed.traceId,
        })
        .onConflictDoUpdate({
            target: eventOutbox.eventId,
            set: {
                status: "pending",
                availableAt: sql`CURRENT_TIMESTAMP`,
                attemptCount: 0,
                claimedAt: null,
                lastError: null,
                payload: parsed as unknown as Record<string, unknown>,
                traceId: parsed.traceId,
                updatedAt: new Date(),
            },
            setWhere: sql`${eventOutbox.status} IN ('dead', 'processed')`,
        });
}

interface DispatchDecision {
    job: OcrJob;
    documentRow: Document;
    version: DocumentVersion;
    rawCreationKey: string;
    fallbackOptions: DispatchRoutingOptions;
    userId: string;
    traceId?: string;
}

/**
 * Shared in-transaction tail for both lifecycles: requeue a failed job and
 * enqueue the outbox event with the persisted (or fallback) routing options.
 */
async function dispatchInTx(tx: Tx, decision: DispatchDecision): Promise<OcrJob> {
    let job = decision.job;
    if (job.status === "failed") {
        const [requeued] = await tx
            .update(ocrJobs)
            .set({ status: "queued", errorMessage: null })
            .where(and(eq(ocrJobs.id, job.id), eq(ocrJobs.status, "failed")))
            .returning();
        job = requeued ?? job;
    }

    const persisted = job.dispatchOptions as DispatchRoutingOptions | null;
    // Legacy jobs (rows predating persisted dispatch options) must route by
    // the STORED version's mimeType — the version row is what a replay
    // re-extracts — not whatever mime the current caller happened to pass:
    // the fallback options carry the caller's resolved mime (e.g.
    // `application/octet-stream` when a converging re-upload omitted it),
    // which can differ from the adopted version's. Matches the original
    // post-commit dispatcher, which built the legacy fallback from
    // `lifecycle.version.mimeType`.
    const routingOptions: DispatchRoutingOptions =
        persisted === null
            ? { ...decision.fallbackOptions, mimeType: decision.version.mimeType }
            : {
                  ...persisted,
                  archiveIdentity: persisted.archiveIdentity ?? decision.rawCreationKey,
              };

    const event = buildSourceVersionCreatedEvent({
        ocrJobId: job.id,
        companyId: Number(decision.documentRow.companyId),
        sourceId: decision.documentRow.id,
        sourceVersionId: decision.version.id,
        documentUrl: job.documentUrl,
        documentName: job.documentName,
        category: decision.documentRow.category,
        userId: decision.userId,
        traceId: decision.traceId ?? job.id,
        occurredAt: new Date().toISOString(),
        mimeType: routingOptions.mimeType ?? decision.version.mimeType,
        originalFilename: routingOptions.originalFilename,
        isWebsite: routingOptions.isWebsite,
        archiveIdentity: routingOptions.archiveIdentity,
        transcriptionMetadata: routingOptions.transcriptionMetadata,
        forceOCR: routingOptions.forceOCR,
        preferredProvider: routingOptions.preferredProvider,
        embeddingIndexKey: routingOptions.embeddingIndexKey,
    });
    await enqueueSourceEventInTx(tx, event);
    return job;
}

type TransactionLifecycle = {
    document: Document;
    version: DocumentVersion;
    job: OcrJob | null;
};

/**
 * Atomically creates the document lifecycle and enqueues its
 * `source.version.created` event in the same transaction. `creationKey`
 * makes creation retries converge on the same rows, job ID and event.
 */
export async function createDocumentLifecycle(
    params: CreateDocumentLifecycleParams
): Promise<CreatedDocumentLifecycle> {
    const db = getDb();
    const rawCreationKey = params.creationKey;
    const creationKey = hashCreationKey(rawCreationKey);
    const processing = params.processing;
    const candidateJobId = processing ? randomUUID() : null;
    const resolvedMimeType = params.mimeType ?? "application/octet-stream";
    const initialDispatchOptions = processing
        ? createDispatchRoutingOptions({
              archiveIdentity: rawCreationKey,
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
        const [lockedDocument] = await tx
            .select()
            .from(document)
            .where(
                and(eq(document.id, lifecycleDocument.id), eq(document.companyId, params.companyId))
            )
            .for("update")
            .limit(1);

        if (!lockedDocument) {
            throw new Error(`Document ${lifecycleDocument.id} was not found`);
        }
        lifecycleDocument = lockedDocument;

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
                .where(
                    and(
                        eq(documentVersions.id, Number(lifecycleDocument.currentVersionId)),
                        eq(documentVersions.documentId, BigInt(lifecycleDocument.id))
                    )
                )
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

        const expectedDocumentId = BigInt(lifecycleDocument.id);
        const expectedVersionId = BigInt(lifecycleVersion.id);
        const lifecycleVersionIsCurrent = lifecycleDocument.currentVersionId === expectedVersionId;
        let lifecycleJob: OcrJob | undefined;
        const linkedJobIds = [
            lifecycleVersion.ocrJobId,
            lifecycleVersionIsCurrent ? lifecycleDocument.ocrJobId : null,
        ];
        for (const linkedJobId of linkedJobIds) {
            if (!linkedJobId) continue;
            const [linkedJob] = await tx
                .select()
                .from(ocrJobs)
                .where(
                    and(
                        eq(ocrJobs.id, linkedJobId),
                        eq(ocrJobs.documentId, expectedDocumentId),
                        eq(ocrJobs.versionId, expectedVersionId)
                    )
                )
                .limit(1);
            if (linkedJob) {
                lifecycleJob = linkedJob;
                break;
            }
        }

        if (!lifecycleJob) {
            const [versionJob] = await tx
                .select()
                .from(ocrJobs)
                .where(
                    and(
                        eq(ocrJobs.documentId, expectedDocumentId),
                        eq(ocrJobs.versionId, expectedVersionId)
                    )
                )
                .limit(1);
            lifecycleJob = versionJob;
        }

        if (lifecycleJob) {
            if (
                lifecycleJob.documentId !== expectedDocumentId ||
                lifecycleJob.versionId !== expectedVersionId
            ) {
                throw new Error(
                    `OCR job ${lifecycleJob.id} is not linked to document ${lifecycleDocument.id} version ${lifecycleVersion.id}`
                );
            }

            const observedVersionJobId = lifecycleVersion.ocrJobId;
            if (observedVersionJobId !== lifecycleJob.id) {
                const [updatedVersion] = await tx
                    .update(documentVersions)
                    .set({ ocrJobId: lifecycleJob.id })
                    .where(
                        and(
                            eq(documentVersions.id, lifecycleVersion.id),
                            eq(documentVersions.documentId, expectedDocumentId),
                            observedVersionJobId === null
                                ? isNull(documentVersions.ocrJobId)
                                : eq(documentVersions.ocrJobId, observedVersionJobId)
                        )
                    )
                    .returning();
                lifecycleVersion = updatedVersion ?? lifecycleVersion;
            }

            const observedDocumentJobId = lifecycleDocument.ocrJobId;
            if (lifecycleVersionIsCurrent && observedDocumentJobId !== lifecycleJob.id) {
                const [updatedDocument] = await tx
                    .update(document)
                    .set({ ocrJobId: lifecycleJob.id })
                    .where(
                        and(
                            eq(document.id, lifecycleDocument.id),
                            eq(document.currentVersionId, expectedVersionId),
                            observedDocumentJobId === null
                                ? isNull(document.ocrJobId)
                                : eq(document.ocrJobId, observedDocumentJobId)
                        )
                    )
                    .returning();
                lifecycleDocument = updatedDocument ?? lifecycleDocument;
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

        const shouldDispatch =
            Boolean(lifecycleJob) &&
            (inserted || lifecycleJob?.status === "queued" || lifecycleJob?.status === "failed");

        if (shouldDispatch && lifecycleJob) {
            lifecycleJob = await dispatchInTx(tx, {
                job: lifecycleJob,
                documentRow: lifecycleDocument,
                version: lifecycleVersion,
                rawCreationKey,
                fallbackOptions:
                    initialDispatchOptions ??
                    createDispatchRoutingOptions({
                        archiveIdentity: rawCreationKey,
                        preferredProvider: processing?.preferredProvider,
                        originalFilename: processing?.originalFilename,
                        isWebsite: processing?.isWebsite,
                        transcriptionMetadata: processing?.transcriptionMetadata,
                        embeddingIndexKey: processing?.embeddingIndexKey,
                        mimeType: lifecycleVersion.mimeType,
                    }),
                userId: params.userId,
                traceId: params.traceId,
            });
        }

        return {
            document: lifecycleDocument,
            version: lifecycleVersion,
            job: lifecycleJob ?? null,
        };
    });

    const job = lifecycle.job ? { ...lifecycle.job, eventIds: [] } : null;
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

type VersionTransactionLifecycle = {
    document: Document;
    version: DocumentVersion;
    job: OcrJob;
};

function isVersionNumberConflict(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("doc_versions_document_version_unique");
}

/**
 * Atomically creates a later document version, its linked OCR job, and the
 * `source.version.created` outbox event in one transaction. The creation
 * key makes retries reuse the same version, job and event rows.
 */
export async function createDocumentVersionLifecycle(
    params: CreateDocumentVersionLifecycleParams
): Promise<CreatedDocumentVersionLifecycle> {
    const db = getDb();
    const rawCreationKey = params.creationKey;
    const creationKey = hashCreationKey(rawCreationKey);
    const versionDispatchOptions = createDispatchRoutingOptions({
        archiveIdentity: rawCreationKey,
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
                    .for("update")
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
                            documentUrl: params.processingUrl ?? params.url,
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

                const shouldDispatch =
                    lifecycleJob.status === "queued" || lifecycleJob.status === "failed";

                if (shouldDispatch) {
                    lifecycleJob = await dispatchInTx(tx, {
                        job: lifecycleJob,
                        documentRow: lifecycleDocumentResult,
                        version: lifecycleVersion,
                        rawCreationKey,
                        fallbackOptions: versionDispatchOptions,
                        userId: params.userId,
                        traceId: params.traceId,
                    });
                }

                return {
                    document: lifecycleDocumentResult,
                    version: lifecycleVersion,
                    job: lifecycleJob,
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

    const job: DocumentLifecycleJob = { ...lifecycle.job, eventIds: [] };
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
