/**
 * Local File Upload API Route
 * Stores uploaded files in the database when UploadThing is disabled
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { fileUploads } from "~/server/db/schema";
import { isUploadAccepted } from "~/lib/upload-accepted";

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB to match UploadThing config

const UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Accepted: PDF, Word, Excel, PowerPoint, text, HTML, images (PNG, JPG, TIFF, etc.).";

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

    console.log(
      `[UploadLocal] Received file: name=${file.name}, mime=${file.type}, size=${(file.size / 1024).toFixed(1)}KB, user=${userId}`
    );

    if (!isUploadAccepted({ name: file.name, type: file.type })) {
      console.warn(`[UploadLocal] Rejected: unsupported file type name=${file.name}, mime=${file.type}`);
      return NextResponse.json(
        { error: UNSUPPORTED_TYPE_MESSAGE },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      console.warn(`[UploadLocal] Rejected: file too large size=${(file.size / 1024 / 1024).toFixed(1)}MB, max=${MAX_FILE_SIZE / 1024 / 1024}MB`);
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 }
      );
    }

    // Convert file to base64
    console.log(`[UploadLocal] Converting to base64...`);
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    console.log(`[UploadLocal] Base64 encoded: ${(base64Data.length / 1024).toFixed(1)}KB`);

    // Store in database
    console.log(`[UploadLocal] Storing in database...`);
    const [uploadedFile] = await db.insert(fileUploads).values({
      userId,
      filename: file.name,
      mimeType: file.type,
      fileData: base64Data,
      fileSize: file.size,
    }).returning({
      id: fileUploads.id,
      filename: fileUploads.filename,
    });

    if (!uploadedFile) {
      console.error("[UploadLocal] Database insert returned no result");
      return NextResponse.json(
        { error: "Failed to store file" },
        { status: 500 }
      );
    }

    // Return URL that can be used to fetch the file
    const fileUrl = `/api/files/${uploadedFile.id}`;
    const elapsed = Date.now() - uploadStart;

    console.log(
      `[UploadLocal] Success: id=${uploadedFile.id}, url=${fileUrl}, name=${uploadedFile.filename}, mime=${file.type} (${elapsed}ms)`
    );

    return NextResponse.json({
      success: true,
      url: fileUrl,
      name: uploadedFile.filename,
      id: uploadedFile.id,
    });
  } catch (error) {
    const elapsed = Date.now() - uploadStart;
    console.error(`[UploadLocal] Failed after ${elapsed}ms:`, error);
    return NextResponse.json(
      {
        error: "Failed to upload file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

