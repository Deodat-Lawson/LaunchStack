import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
    getPresignedUploadUrl,
    getS3BucketName,
    ensureBucketExists,
} from "~/server/storage/s3-client";
import { isS3Storage } from "~/lib/storage";
import { validateRequestBody, PresignUploadSchema } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        // Presigned URLs require an S3 backend
        if (!isS3Storage()) {
            return NextResponse.json(
                { error: "Presigned URLs are not applicable: no S3 endpoint configured" },
                { status: 400 }
            );
        }

        const validation = await validateRequestBody(request, PresignUploadSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const resolvedFilename = (body.filename ?? body.fileName)!;

        const safeName = resolvedFilename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
        const objectKey = `documents/${randomUUID()}-${safeName || "upload"}`;
        const bucket = getS3BucketName();

        await ensureBucketExists();
        const presignedUrl = await getPresignedUploadUrl(objectKey, body.contentType, 300);

        return NextResponse.json({ presignedUrl, objectKey, bucket });
    } catch (error) {
        console.error("[Presign] Failed to generate presigned URL:", error);
        return NextResponse.json(
            {
                error: "Failed to generate presigned URL",
            },
            { status: 500 }
        );
    }
}
