/**
 * File Serving API Route
 * Retrieves and serves files stored in the database
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { fileUploads } from "@launchstack/core/db/schema";
import {
  FILE_ACCESS_TOKEN_PARAM,
  verifyFileAccessToken,
} from "@launchstack/core/crypto";
import { env } from "~/env";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile } from "~/lib/storage";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
};

function inferMimeTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * Accepts either a signed-in user or a short-lived token scoped to this file
 * id (used by the OCR worker, which fetches documents from another container
 * and has no Clerk session).
 *
 * Temporary: this only proves the caller is authenticated, not that the file
 * belongs to their company. C.2 replaces it with requireWorkspaceContext plus
 * an ownership check.
 */
async function isAuthorizedFileRequest(
  request: Request,
  fileId: string,
): Promise<boolean> {
  const token = new URL(request.url).searchParams.get(FILE_ACCESS_TOKEN_PARAM);
  if (
    verifyFileAccessToken(token, fileId, env.server.FILE_ACCESS_TOKEN_SECRET)
  ) {
    return true;
  }

  const { userId } = await auth();
  return Boolean(userId);
}

export async function GET(
  request: Request,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const fileId = parseInt(id, 10);

    if (isNaN(fileId)) {
      return NextResponse.json(
        { error: "Invalid file ID" },
        { status: 400 }
      );
    }

    if (!(await isAuthorizedFileRequest(request, String(fileId)))) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch file from database
    const [file] = await db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, fileId));

    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // External storage (S3 or legacy Vercel Blob): proxy or redirect.
    // Database-backed files (storageProvider === "database") fall through to
    // the base64 branch below.
    if (file.storageProvider !== "database" && file.storageUrl) {
      const needsProxy =
        file.storageProvider === "s3" ||
        file.storageProvider === "seaweedfs" ||
        isPrivateBlobUrl(file.storageUrl);

      if (needsProxy) {
        const blobRes = await fetchFile(file.storageUrl);
        if (!blobRes.ok) {
          return NextResponse.json(
            { error: "Failed to retrieve file from storage" },
            { status: 502 }
          );
        }
        const mimeType =
          blobRes.headers.get("content-type") ??
          file.mimeType?.trim() ??
          inferMimeTypeFromFilename(file.filename);
        return new NextResponse(blobRes.body, {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            ...(blobRes.headers.get("content-length")
              ? { "Content-Length": blobRes.headers.get("content-length")! }
              : {}),
            "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            "Cache-Control": "private, max-age=31536000",
          },
        });
      }
      // Public external URL: redirect directly
      return NextResponse.redirect(file.storageUrl, {
        status: 307,
      });
    }

    if (!file.fileData) {
      return NextResponse.json(
        { error: "File is not available in database storage" },
        { status: 404 }
      );
    }

    // Decode base64 data back to binary
    const binaryData = Buffer.from(file.fileData, "base64");
    const mimeType = file.mimeType?.trim() || inferMimeTypeFromFilename(file.filename);

    // Return file with appropriate headers
    return new NextResponse(binaryData, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": binaryData.length.toString(),
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, max-age=31536000", // Cache for 1 year (immutable content)
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json(
      {
        error: "Failed to serve file",
      },
      { status: 500 }
    );
  }
}

