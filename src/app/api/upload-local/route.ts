/**
 * Local File Upload API Route
 * Tries the configured storage provider first, falls back to database storage.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { fileUploads } from "~/server/db/schema";
import { uploadFile } from "~/lib/storage";
import { isUploadAccepted } from "~/lib/upload-accepted";
import { DOCUMENT_LIMITS } from "~/lib/constants";

const MAX_FILE_SIZE = DOCUMENT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;

const UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Accepted: PDF, Word, Excel, PowerPoint, text, HTML, images (PNG, JPG, TIFF, etc.), audio (MP3, MP4).";

export async function POST(request: Request) {
  const uploadStart = Date.now();
  try {
    const { userId } = await auth();
    if (!userId) {
      console.warn("[UploadLocal] Rejected: no authenticated user");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      console.warn("[UploadLocal] Rejected: no file in form data");
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!isUploadAccepted({ name: file.name, type: file.type })) {
      console.warn(`[UploadLocal] Rejected: unsupported file type name=${file.name}, mime=${file.type}`);
      return NextResponse.json({ error: UNSUPPORTED_TYPE_MESSAGE }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      console.warn(`[UploadLocal] Rejected: file too large size=${(file.size / 1024 / 1024).toFixed(1)}MB`);
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    console.log(
      `[UploadLocal] Uploading: name=${file.name}, mime=${file.type}, size=${(file.size / 1024).toFixed(1)}KB, user=${userId}`,
    );

    // Try configured storage provider first, fall back to database
    let storageProvider = "database";
    let storageUrl: string | null = null;
    let storagePath: string | null = null;
    let fileDataBase64: string | null = null;

    try {
      const blob = await uploadFile({
        filename: file.name,
        data: fileBuffer,
        contentType: file.type || undefined,
        userId,
      });
      storageProvider = blob.provider;
      storageUrl = blob.url;
      storagePath = blob.pathname;
      console.log(`[UploadLocal] Stored via ${blob.provider}: ${blob.url}`);
    } catch (storageErr) {
      console.warn(
        `[UploadLocal] External storage failed, falling back to database:`,
        storageErr instanceof Error ? storageErr.message : storageErr,
      );
      fileDataBase64 = fileBuffer.toString("base64");
      storageProvider = "database";
    }

    const [uploadedFile] = await db
      .insert(fileUploads)
      .values({
        userId,
        filename: file.name,
        mimeType: file.type,
        fileData: fileDataBase64,
        fileSize: file.size,
        storageProvider,
        storageUrl,
        storagePathname: storagePath,
        blobChecksum: null,
      })
      .returning({
        id: fileUploads.id,
        filename: fileUploads.filename,
        storageProvider: fileUploads.storageProvider,
        storageUrl: fileUploads.storageUrl,
      });

    if (!uploadedFile) {
      console.error("[UploadLocal] Database insert returned no result");
      return NextResponse.json({ error: "Failed to store file" }, { status: 500 });
    }

    // When stored in DB, the serving URL is /api/files/:id
    const fileUrl = storageUrl ?? `/api/files/${uploadedFile.id}`;
    const elapsed = Date.now() - uploadStart;

    console.log(
      `[UploadLocal] Success: id=${uploadedFile.id}, provider=${storageProvider}, url=${fileUrl}, name=${file.name} (${elapsed}ms)`,
    );

    return NextResponse.json({
      success: true,
      url: fileUrl,
      name: uploadedFile.filename,
      id: uploadedFile.id,
      provider: storageProvider,
      pathname: storagePath ?? `db://${uploadedFile.id}`,
    });
  } catch (error) {
    const elapsed = Date.now() - uploadStart;
    console.error(`[UploadLocal] Failed after ${elapsed}ms:`, error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
