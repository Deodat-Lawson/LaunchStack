import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
  toFileSizeBigint,
  updateBatchStatus,
} from "~/server/services/upload-batches";

const RegisterFilesSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  files: z
    .array(
      z.object({
        fileId: z.number().int().positive().optional(),
        filename: z.string().min(1, "Filename is required"),
        relativePath: z.string().optional(),
        storageUrl: z.string().min(1, "storageUrl is required"),
        storageType: z.enum(["cloud", "database"]).optional(),
        mimeType: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        metadata: z.record(z.any()).optional(),
      })
    )
    .min(1, "At least one file must be registered"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  return withRateLimit(request, RateLimitPresets.standard, async () => {
    const { batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
    }

    const validation = await validateRequestBody(request, RegisterFilesSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { userId, files } = validation.data;

    const batch = await findBatchOwnedByUser(batchId, userId);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const failedUpdates: { filename: string; relativePath?: string; reason: string }[] = [];

    for (const file of files) {
      const whereClause = file.fileId
        ? eq(uploadBatchFiles.id, file.fileId)
        : and(
            eq(uploadBatchFiles.filename, file.filename),
            file.relativePath ? eq(uploadBatchFiles.relativePath, file.relativePath) : isNull(uploadBatchFiles.relativePath)
          );

      const updateData: Partial<typeof uploadBatchFiles.$inferInsert> = {
        storageUrl: file.storageUrl,
        status: "uploaded",
        uploadedAt: new Date(),
        errorMessage: null,
      };

      if (file.storageType !== undefined) {
        updateData.storageType = file.storageType;
      }
      if (file.mimeType !== undefined) {
        updateData.mimeType = file.mimeType;
      }
      if (file.size !== undefined) {
        updateData.fileSizeBytes = toFileSizeBigint(file.size);
      }
      if (file.metadata !== undefined) {
        updateData.metadata = file.metadata;
      }

      const [updated] = await db
        .update(uploadBatchFiles)
        .set(updateData)
        .where(
          and(
            eq(uploadBatchFiles.batchId, batchId),
            eq(uploadBatchFiles.userId, userId),
            whereClause,
            inArray(uploadBatchFiles.status, ["queued", "uploaded", "failed"])
          )
        )
        .returning();

      if (!updated) {
        failedUpdates.push({ filename: file.filename, relativePath: file.relativePath, reason: "File row not found" });
      }
    }

    if (failedUpdates.length > 0) {
      return NextResponse.json(
        {
          error: "One or more files could not be registered",
          failures: failedUpdates,
        },
        { status: 404 }
      );
    }

    if (batch.status === "created") {
      await updateBatchStatus(batchId, "uploading");
    }

    await refreshBatchAggregates(batchId);

    const refreshedBatch = await findBatchOwnedByUser(batchId, userId, true);
    if (!refreshedBatch) {
      return NextResponse.json({ error: "Batch not found after update" }, { status: 404 });
    }

    return NextResponse.json({ success: true, batch: serializeBatch(refreshedBatch) });
  });
}
