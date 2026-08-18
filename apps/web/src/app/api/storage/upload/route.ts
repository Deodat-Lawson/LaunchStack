import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ObjectRef } from "@launchstack/core/storage";

import { putObject, getS3BucketName, ensureBucketExists, getObjectUrl } from "~/server/storage/s3-client";
import { isS3Storage } from "~/lib/storage";
import { resolveStorageLocationId } from "~/lib/storage-location-id";
import { db } from "~/server/db";
import { fileUploads, users } from "@launchstack/core/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { registerUploadArtifact } from "~/server/services/storage-manifest";

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

        const [userInfo] = await db
            .select({ id: users.id, companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "Unknown user" }, { status: 401 });
        }

        const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

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

        const fileId = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(fileUploads)
                .values({
                    userId,
                    filename: file.name,
                    mimeType: file.type,
                    fileData: null,
                    fileSize: file.size,
                    storageProvider: "s3",
                    storageUrl: url,
                    storagePathname: objectKey,
                })
                .returning({ id: fileUploads.id });

            if (!row) {
                throw new Error("Failed to create fileUploads row for S3 upload");
            }

            await registerUploadArtifact(tx, {
                ref,
                companyId,
                fileUploadId: row.id,
                contentType: file.type || undefined,
                sizeBytes: file.size,
                sourceOperation: "storage-upload",
            });

            return row.id;
        });

        return NextResponse.json({ objectKey, bucket, url, ref, storageAdapter: ref.adapter, id: fileId });
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
