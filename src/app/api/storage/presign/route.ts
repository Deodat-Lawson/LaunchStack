import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";

import { getPresignedUploadUrl, getS3BucketName, ensureBucketExists } from "~/server/storage/s3-client";

function sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

export async function POST(request: Request) {
    try {
        // Auth check
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Authentication required" },
                { status: 401 },
            );
        }

        // Only applicable for local storage
        if (process.env.NEXT_PUBLIC_STORAGE_PROVIDER !== "local") {
            return NextResponse.json(
                { error: "Presigned URLs are not applicable for cloud storage" },
                { status: 400 },
            );
        }

        const body = (await request.json()) as {
            filename?: string;
            fileName?: string;
            contentType?: string;
        };

        const resolvedFilename = body.filename ?? body.fileName;

        if (!resolvedFilename || !body.contentType) {
            return NextResponse.json(
                { error: "filename and contentType are required" },
                { status: 400 },
            );
        }

        const safeName = sanitizeFilename(resolvedFilename);
        const objectKey = `documents/${randomUUID()}-${safeName || "upload"}`;
        const bucket = getS3BucketName();

        await ensureBucketExists();
        const presignedUrl = await getPresignedUploadUrl(
            objectKey,
            body.contentType,
            300,
        );

        return NextResponse.json({ presignedUrl, objectKey, bucket });
    } catch (error) {
        console.error("[Presign] Failed to generate presigned URL:", error);
        return NextResponse.json(
            {
                error: "Failed to generate presigned URL",
            },
            { status: 500 },
        );
    }
}
