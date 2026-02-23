import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { validateRequestBody } from "~/lib/validation";
import { createUploadBatch, serializeBatch } from "~/server/services/upload-batches";

const FileEntrySchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  relativePath: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  metadata: z.record(z.any()).optional(),
});

const CreateBatchSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  metadata: z.record(z.any()).optional(),
  files: z.array(FileEntrySchema).min(1, "At least one file entry is required"),
});

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.standard, async () => {
    const validation = await validateRequestBody(request, CreateBatchSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { userId, metadata, files } = validation.data;

    const [user] = await db.select().from(users).where(eq(users.userId, userId));
    if (!user) {
      return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    }

    try {
      const result = await createUploadBatch({
        userId,
        companyId: user.companyId,
        metadata: metadata ?? null,
        files,
      });

      const batchDto = serializeBatch({ ...result.batch, files: result.files });

      return NextResponse.json(
        {
          success: true,
          batch: batchDto,
        },
        { status: 201 }
      );
    } catch (error) {
      console.error("[UploadBatches] Failed to create batch", error);
      return NextResponse.json(
        { error: "Failed to create upload batch", details: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  });
}
