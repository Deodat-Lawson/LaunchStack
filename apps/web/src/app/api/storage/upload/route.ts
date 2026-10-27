import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requestTranslator } from "~/i18n/server";

import {
    putObject,
    getS3BucketName,
    ensureBucketExists,
    getObjectUrl,
} from "~/server/storage/s3-client";
import { isS3Storage } from "~/lib/storage";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { fileUploads } from "@launchstack/store/schema";

function sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

export async function POST(request: Request) {
    const t = requestTranslator(request, "upload.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (!isS3Storage()) {
            return NextResponse.json({ error: t("s3UploadNoS3") }, { status: 400 });
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: t("fileFieldRequired") }, { status: 400 });
        }
        if (
            formData.get("purpose") === "chat" &&
            (file.size === 0 ||
                file.size > 50 * 1024 * 1024 ||
                (file.type.startsWith("image/") && file.size > 10 * 1024 * 1024))
        ) {
            return NextResponse.json({ error: t("chatAttachmentSize") }, { status: 413 });
        }

        const safeName = sanitizeFilename(file.name);
        const objectKey = `documents/${randomUUID()}-${safeName || "upload"}`;
        const bucket = getS3BucketName();

        await ensureBucketExists();

        const buffer = Buffer.from(await file.arrayBuffer());
        await putObject(objectKey, buffer, file.type || "application/octet-stream");

        const url = getObjectUrl(objectKey);
        // Record the owner so chat downloads can enforce workspace access even
        // before an uploaded file is promoted to an indexed document.
        await db.insert(fileUploads).values({
            userId: ctx.data.authUserId,
            companyId: ctx.data.companyId,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
            storageProvider: "s3",
            storageUrl: url,
            storagePathname: objectKey,
        });

        return NextResponse.json({ objectKey, bucket, url });
    } catch (error) {
        console.error("[StorageUpload] Failed to upload file:", error);
        return NextResponse.json(
            {
                error: t("storageUploadFailed"),
                details:
                    error instanceof Error
                        ? error.message
                        : requestTranslator(request, "errors.api")("unknownError"),
            },
            { status: 500 }
        );
    }
}
