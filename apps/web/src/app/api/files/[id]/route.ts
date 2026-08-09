/**
 * File Serving API Route
 * Retrieves and serves files stored in the database.
 *
 * Access control (see ~/server/security/file-access.ts):
 *  - Valid signed reference (`?exp=<unix>&sig=<hmac>`) → allowed (time-limited
 *    storage reference for services / links).
 *  - `X-Service-Key` header equal to FILE_ACCESS_HMAC_KEY → allowed
 *    (server-to-server fetches from compute services like document-converter).
 *  - Otherwise a Clerk session is required and the caller must be authorized
 *    for the file (see userMayAccessFile below).
 *  - Compatibility: when FILE_ACCESS_HMAC_KEY is unset the route behaves as it
 *    always did (no auth) but logs one loud warning per process.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, like } from "drizzle-orm";
import { db } from "~/server/db";
import { document, fileUploads } from "@launchstack/core/db/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile } from "~/lib/storage";
import {
  getFileAccessKey,
  isValidServiceKey,
  verifySignedFileReference,
  warnLegacyOpenFileAccessOnce,
} from "~/server/security/file-access";

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
 * Ownership check for session-authenticated access.
 *
 * The strongest check the data supports today:
 *  1. `file_uploads.user_id` (a Clerk user id) — the uploader always has
 *     access.
 *  2. Otherwise, if any `document` row references this file via a
 *     `/api/files/{id}` URL, users belonging to that document's company
 *     (default workspace or any `user_company_memberships` row) have access.
 *
 * Limits: `file_uploads` carries no company id of its own, so a file that no
 * document references yet (e.g. mid-ingestion or orphaned) is only served to
 * its uploader. Document-level sharing/permission flags, if added later,
 * are not consulted here.
 */
async function userMayAccessFile(
  sessionUserId: string,
  fileId: number,
  fileUserId: string
): Promise<boolean> {
  if (fileUserId === sessionUserId) {
    return true;
  }

  const [userInfo] = await db
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(eq(users.userId, sessionUserId));

  if (!userInfo) {
    return false;
  }

  // Documents referencing this file. LIKE narrows the scan; the regex below
  // confirms the exact id so /api/files/12 never matches /api/files/123.
  const candidateDocs = await db
    .select({ companyId: document.companyId, url: document.url })
    .from(document)
    .where(like(document.url, `%/api/files/${fileId}%`));

  const exactRef = new RegExp(`/api/files/${fileId}(?:[?#]|$)`);
  const owningCompanies = new Set(
    candidateDocs
      .filter(doc => exactRef.test(doc.url))
      .map(doc => BigInt(doc.companyId).toString())
  );

  if (owningCompanies.size === 0) {
    return false;
  }

  if (owningCompanies.has(BigInt(userInfo.companyId).toString())) {
    return true;
  }

  const memberships = await db
    .select({ companyId: userCompanyMemberships.companyId })
    .from(userCompanyMemberships)
    .where(eq(userCompanyMemberships.userId, BigInt(userInfo.id)));

  return memberships.some(m => owningCompanies.has(BigInt(m.companyId).toString()));
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

    // ------------------------------------------------------------------
    // Access control
    // ------------------------------------------------------------------
    let sessionUserId: string | null = null;

    if (getFileAccessKey()) {
      const { searchParams } = new URL(request.url);
      const signedOk = verifySignedFileReference(
        fileId,
        searchParams.get("exp"),
        searchParams.get("sig")
      );
      const serviceOk =
        !signedOk && isValidServiceKey(request.headers.get("x-service-key"));

      if (!signedOk && !serviceOk) {
        const { userId } = await auth();
        if (!userId) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        sessionUserId = userId;
      }
    } else {
      // Legacy compatibility: no key configured — keep serving openly, loudly.
      warnLegacyOpenFileAccessOnce();
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

    // Session-authenticated caller (no signed reference / service key):
    // enforce ownership before serving a single byte.
    if (sessionUserId !== null) {
      const authorized = await userMayAccessFile(sessionUserId, fileId, file.userId);
      if (!authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
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
