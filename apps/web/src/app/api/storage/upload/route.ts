import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import type { ObjectRef } from "@launchstack/core/storage";

import { putObject, getS3BucketName, ensureBucketExists, getObjectUrl } from "~/server/storage/s3-client";
import { isS3Storage } from "~/lib/storage";
import { resolveStorageLocationId } from "~/lib/storage-location-id";

function sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Authentication required" },
                { status: 401 },
            );
        }

        if (!isS3Storage()) {
            return NextResponse.json(
                { error: "S3 upload is not applicable: no S3 endpoint configured" },
                { status: 400 },
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json(
                { error: "file is required" },
                { status: 400 },
            );
        }

        const safeName = sanitizeFilename(file.name);
        const objectKey = `documents/${randomUUID()}-${safeName || "upload"}`;
        const bucket = getS3BucketName();

        await ensureBucketExists();

        const buffer = Buffer.from(await file.arrayBuffer());
        await putObject(objectKey, buffer, file.type || "application/octet-stream");

        const url = getObjectUrl(objectKey);
        const ref: ObjectRef = {
            adapter: "s3",
            storageLocationId: resolveStorageLocationId("s3"),
            key: objectKey,
        };

<<<<<<< HEAD
        return NextResponse.json({ objectKey, bucket, url, ref, storageAdapter: ref.adapter });
=======
        return NextResponse.json({
            objectKey,
            bucket,
            url,
            ref: {
                adapter: "s3",
                storageLocationId: resolveStorageLocationId("s3"),
                key: objectKey,
            },
        });
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
    } catch (error) {
        console.error("[StorageUpload] Failed to upload file:", error);
        return NextResponse.json(
            {
                error: "Failed to upload file to storage",
                details: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}
