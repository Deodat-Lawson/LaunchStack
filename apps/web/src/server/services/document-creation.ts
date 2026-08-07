import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  document,
  documentVersions,
  ocrJobs,
  type Document,
  type DocumentVersion,
  type OcrJob,
} from "@launchstack/core/db/schema";
import {
  parseProvider,
  triggerDocumentProcessing,
} from "@launchstack/core/ocr/trigger";
import { db } from "~/server/db";

export interface DocumentCreationProcessing {
  preferredProvider?: string;
  originalFilename?: string;
  isWebsite?: boolean;
  transcriptionMetadata?: Record<string, unknown>;
  embeddingIndexKey?: string;
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
  params: CreateDocumentLifecycleParams,
): Promise<CreatedDocumentLifecycle> {
  const processing = params.processing;
  const candidateJobId = processing ? randomUUID() : null;
  const resolvedMimeType = params.mimeType ?? "application/octet-stream";

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
        creationKey: params.creationKey,
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
            eq(document.creationKey, params.creationKey),
          ),
        )
        .limit(1);
      lifecycleDocument = existingDocument;
    }

    if (!lifecycleDocument) {
      throw new Error(
        `Document creation conflict did not produce a row for key ${params.creationKey}`,
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
          creationKey: params.creationKey,
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
            eq(documentVersions.creationKey, params.creationKey),
          ),
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
        `Document ${lifecycleDocument.id} has no version for creation key ${params.creationKey}`,
      );
    }

    const lifecycleVersionId = BigInt(lifecycleVersion.id);
    const currentVersionId = lifecycleDocument.currentVersionId;
    const pointsToLifecycleVersion = currentVersionId === lifecycleVersionId;
    const shouldSetCurrentVersion = inserted || currentVersionId === null;
    const shouldRepairMime =
      inserted || currentVersionId === null || pointsToLifecycleVersion;

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
    const linkedJobId = lifecycleDocument.ocrJobId ?? lifecycleVersion.ocrJobId;
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
            eq(ocrJobs.versionId, BigInt(lifecycleVersion.id)),
          ),
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
          `OCR job ${lifecycleJob.id} is not linked to document ${lifecycleDocument.id} version ${lifecycleVersion.id}`,
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
        Boolean(processing && lifecycleJob) &&
        (inserted || lifecycleJob?.status === "queued" || lifecycleJob?.status === "failed"),
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
    const [queuedJob] = await db
      .update(ocrJobs)
      .set({ status: "queued", errorMessage: null })
      .where(eq(ocrJobs.id, job.id))
      .returning();
    if (queuedJob) {
      job = { ...queuedJob, eventIds: [] };
    }
  }

  try {
    const dispatch = await triggerDocumentProcessing(
      params.processingUrl ?? params.url,
      params.title,
      params.companyId.toString(),
      params.userId,
      lifecycle.document.id,
      params.category,
      {
        jobId: job.id,
        preferredProvider: parseProvider(processing?.preferredProvider),
        mimeType: params.mimeType ?? undefined,
        originalFilename: processing?.originalFilename,
        isWebsite: processing?.isWebsite,
        versionId: lifecycle.version.id,
        transcriptionMetadata: processing?.transcriptionMetadata,
        embeddingIndexKey: processing?.embeddingIndexKey,
      },
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
        .where(
          and(
            eq(ocrJobs.id, job.id),
            inArray(ocrJobs.status, ["queued", "failed"]),
          ),
        );
    } catch (markFailedError) {
      console.error(`Failed to mark OCR job ${job.id} as failed:`, markFailedError);
    }
    throw error;
  }
}
