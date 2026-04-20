/**
 * Local File Upload API Route
 * Stores uploaded files in the database when UploadThing is disabled
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { fileUploads } from "@launchstack/core/db/schema";
import { uploadFile, resolveStorageBackend } from "~/lib/storage";
import { isUploadAccepted } from "~/lib/upload-accepted";
import { DOCUMENT_LIMITS } from "~/lib/constants";

const MAX_FILE_SIZE = DOCUMENT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;

const UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Accepted: PDF, Word, Excel, PowerPoint, text, HTML, images (PNG, JPG, TIFF, etc.), audio (MP3, MP4).";

export async function POST(request: Request) {
  const uploadStart = Date.now();
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      console.warn("[UploadLocal] Rejected: no authenticated user");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      console.warn("[UploadLocal] Rejected: no file in form data");
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!isUploadAccepted({ name: file.name, type: file.type })) {
      console.warn(`[UploadLocal] Rejected: unsupported file type name=${file.name}, mime=${file.type}`);
      return NextResponse.json(
        { error: UNSUPPORTED_TYPE_MESSAGE },
        { status: 400 }
      );
    }

    const backend = resolveStorageBackend();
    console.log(
      `[UploadLocal] Uploading via ${backend}: name=${file.name}, mime=${file.type}, size=${(file.size / 1024).toFixed(1)}KB, user=${userId}`
    );

    if (file.size > MAX_FILE_SIZE) {
      console.warn(
        `[UploadLocal] Rejected: file too large size=${(file.size / 1024 / 1024).toFixed(1)}MB, max=${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 }
      );
    }

    const uploaded = await uploadFile({
      filename: file.name,
      data: await file.arrayBuffer(),
      contentType: file.type || undefined,
      userId,
    });

    // For S3, record a fileUploads row so the /api/files/<id> route can also
    // resolve this upload. For database backend, uploadFile already inserted
    // the row and the URL is /api/files/<id>.
    let fileId: number | null = null;
    let fileUrl = uploaded.url;

    if (uploaded.provider === "s3") {
      const [row] = await db
        .insert(fileUploads)
        .values({
          userId,
          filename: file.name,
          mimeType: file.type,
          fileData: null,
          fileSize: file.size,
          storageProvider: "s3",
          storageUrl: uploaded.url,
          storagePathname: uploaded.pathname,
        })
        .returning({ id: fileUploads.id });

      if (!row) {
        console.error("[UploadLocal] Database insert returned no result");
        return NextResponse.json(
          { error: "Failed to store file" },
          { status: 500 }
        );
      }
      fileId = row.id;
    } else {
      const match = /\/api\/files\/(\d+)/.exec(uploaded.url);
      fileId = match?.[1] ? parseInt(match[1], 10) : null;
    }

    const elapsed = Date.now() - uploadStart;

    console.log(
      `[UploadLocal] Success: id=${fileId}, url=${fileUrl}, provider=${uploaded.provider}, name=${file.name}, mime=${file.type} (${elapsed}ms)`
    );

    return NextResponse.json({
      success: true,
      url: fileUrl,
      name: file.name,
      id: fileId,
      provider: uploaded.provider,
      pathname: uploaded.pathname,
    });
  } catch (error) {
    const elapsed = Date.now() - uploadStart;
    console.error(`[UploadLocal] Failed after ${elapsed}ms:`, error);
    return NextResponse.json(
      {
        error: "Failed to upload file",
      },
      { status: 500 }
    );
  }
}

