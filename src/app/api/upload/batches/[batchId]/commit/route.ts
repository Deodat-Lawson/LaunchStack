import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";

import { db } from "~/server/db";
import { uploadBatchFiles } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import {
  findBatchOwnedByUser,
  refreshBatchAggregates,
  serializeBatch,
  updateBatchStatus,
  type UploadBatchFileRecord,
} from "~/server/services/upload-batches";
import { processDocumentUpload } from "~/server/services/document-upload";

const CommitSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  preferredProvider: z.string().optional(),
  category: z.string().optional(),
});

const MAX_CONCURRENCY = 3;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    const { batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
    }

    const validation = await validateRequestBody(request, CommitSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { userId, preferredProvider, category } = validation.data;

    const batch = await findBatchOwnedByUser(batchId, userId, true);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (["processing"].includes(batch.status)) {
      return NextResponse.json({ error: "Batch is already processing" }, { status: 409 });
    }
    if (["complete"].includes(batch.status)) {
      return NextResponse.json({ error: "Batch has already completed" }, { status: 409 });
    }

    const pendingFiles = batch.files.filter((file) => file.status === "queued");
    if (pendingFiles.length > 0) {
      return NextResponse.json(
        {
          error: "Batch still has files that have not finished uploading",
          files: pendingFiles.map((file) => ({ id: file.id, filename: file.filename, relativePath: file.relativePath })),
        },
        { status: 400 }
      );
    }

    const filesToProcess = batch.files.filter((file) => file.status === "uploaded");
    if (filesToProcess.length === 0) {
      return NextResponse.json({ error: "No uploaded files are ready to commit" }, { status: 400 });
    }

    const startedAt = new Date();
    await updateBatchStatus(batchId, "processing", {
      committedAt: batch.committedAt ?? startedAt,
      processingStartedAt: startedAt,
      errorMessage: null,
    });

    const limit = pLimit(MAX_CONCURRENCY);
    type FileProcessResult =
      | { fileId: number; status: "complete"; documentId: number; jobId: string }
      | { fileId: number; status: "failed"; error: string };

    const processFile = (file: UploadBatchFileRecord): Promise<FileProcessResult> =>
      limit(async () => {
          if (!file.storageUrl) {
            await markFileFailed(batchId, file.id, "Missing storage URL");
            return { fileId: file.id, status: "failed" as const, error: "Missing storage URL" };
          }

          await markFileStatus(batchId, file.id);

          try {
            const uploadResult = await processDocumentUpload({
              user: { userId, companyId: batch.companyId },
              documentName: file.filename,
              rawDocumentUrl: file.storageUrl,
              requestUrl: request.url,
              category: resolveCategory(file.metadata, batch.metadata, category),
              preferredProvider,
              explicitStorageType: inferStorageType(file.storageType),
              mimeType: file.mimeType ?? undefined,
            });

            await db
              .update(uploadBatchFiles)
              .set({
                status: "complete",
                documentId: BigInt(uploadResult.document.id),
                jobId: uploadResult.jobId,
                processedAt: new Date(),
                errorMessage: null,
              })
              .where(and(eq(uploadBatchFiles.id, file.id), eq(uploadBatchFiles.batchId, batchId)));

            return {
              fileId: file.id,
              status: "complete" as const,
              documentId: uploadResult.document.id,
              jobId: uploadResult.jobId,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            await markFileFailed(batchId, file.id, errorMessage);

            return { fileId: file.id, status: "failed" as const, error: errorMessage };
          }
        });

    const results = await Promise.all(filesToProcess.map((file) => processFile(file)));

    await refreshBatchAggregates(batchId);

    const failures = results.filter((result): result is Extract<FileProcessResult, { status: "failed" }> => result.status === "failed");
    const now = new Date();
    if (failures.length > 0) {
      await updateBatchStatus(batchId, "failed", {
        failedAt: now,
        errorMessage: failures[0]?.error ?? "One or more files failed",
      });
    } else {
      await updateBatchStatus(batchId, "complete", {
        completedAt: now,
        errorMessage: null,
      });
    }

    const refreshedBatch = await findBatchOwnedByUser(batchId, userId, true);
    if (!refreshedBatch) {
      return NextResponse.json({ error: "Batch not found after commit" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: failures.length === 0,
        batch: serializeBatch(refreshedBatch),
        results,
      },
      { status: 202 }
    );
  });
}

async function markFileStatus(batchId: string, fileId: number) {
  await db
    .update(uploadBatchFiles)
    .set({ status: "processing", errorMessage: null })
    .where(and(eq(uploadBatchFiles.id, fileId), eq(uploadBatchFiles.batchId, batchId)));
}

async function markFileFailed(batchId: string, fileId: number, message: string) {
  await db
    .update(uploadBatchFiles)
    .set({ status: "failed", errorMessage: message, processedAt: new Date() })
    .where(and(eq(uploadBatchFiles.id, fileId), eq(uploadBatchFiles.batchId, batchId)));
}

function inferStorageType(value: string | null): "cloud" | "database" | undefined {
  if (value === "cloud" || value === "database") {
    return value;
  }
  return undefined;
}

function resolveCategory(
  fileMetadata: unknown,
  batchMetadata: unknown,
  fallback?: string
): string | undefined {
  const fileCategory = extractCategory(fileMetadata);
  if (fileCategory) return fileCategory;
  const batchCategory = extractCategory(batchMetadata);
  if (batchCategory) return batchCategory;
  return fallback ?? undefined;
}

function extractCategory(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const maybeCategory = (metadata as Record<string, unknown>).category;
  return typeof maybeCategory === "string" && maybeCategory.trim().length > 0
    ? maybeCategory
    : undefined;
}
