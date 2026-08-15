import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
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
    metadata: z.record(z.any()).optional(),
    files: z.array(FileEntrySchema).min(1, "At least one file entry is required"),
});

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const validation = await validateRequestBody(request, CreateBatchSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { metadata, files } = validation.data;

        try {
            const result = await createUploadBatch({
                userId: ctx.data.clerkUserId,
                companyId: ctx.data.companyId,
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
            return NextResponse.json({ error: "Failed to create upload batch" }, { status: 500 });
        }
    });
}
