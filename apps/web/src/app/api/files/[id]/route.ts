/**
 * File Serving API Route
 * Retrieves and serves files stored in the database
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { fileUploads, users } from "@launchstack/core/db/schema";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile } from "~/lib/storage";
import { checkRefServable } from "~/server/services/document-servable";
import { promoteLegacyUrlToRef } from "~/server/storage/legacy-promote";
import {
  checkFileUploadTenantAccess,
  logFileTenantDecision,
} from "~/server/services/file-ownership";

/**
 * Who is asking, if anyone. Deliberately failure-tolerant: this route is
 * reachable server-to-server (the ingestion path fetches uploaded files
 * itself, with no session), and auth() throwing there must not turn into a
 * 500 on a request that used to work. No session simply means no actor.
 */
async function resolveActor(): Promise<{
  actorUserId: string | null;
  actorCompanyId: number | null;
}> {
  try {
    const { userId } = await auth();
    if (!userId) return { actorUserId: null, actorCompanyId: null };

    const [actor] = await db
      .select({ companyId: users.companyId })
      .from(users)
      .where(eq(users.userId, userId));

    return {
      actorUserId: userId,
      actorCompanyId: actor ? Number(actor.companyId) : null,
    };
  } catch {
    return { actorUserId: null, actorCompanyId: null };
  }
}

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

    // B8 tenant auth: this route takes a raw file_uploads id and had no
    // authentication at all, so /api/files/1, /api/files/2, ... was a real
    // enumeration path. file_uploads records no company, so ownership is
    // derived — see file-ownership.ts for the four sources and their
    // relative strength.
    //
    // Rolled out in observe-first mode by default: the check runs and logs
    // what it WOULD refuse, but refuses nothing until
    // STORAGE_FILE_TENANT_AUTH_MODE=enforce. The ingestion path fetches these
    // files server-to-server with no session, and turning this on blind would
    // surface as failed document processing rather than as an auth error.
    const { actorUserId, actorCompanyId } = await resolveActor();
    const tenant = await checkFileUploadTenantAccess({
      fileId,
      actorUserId,
      actorCompanyId,
    });
    logFileTenantDecision(fileId, tenant);
    if (!tenant.allowed) {
      // 404 rather than 403, same non-disclosure choice the delete APIs make:
      // a refusal must not confirm that this id exists.
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // B6 serve-gating: refuse a file that an open deletion request already
    // covers, even though its row still exists. This route is keyed on
    // file_uploads.id and never sees a documentId, so it gates by ref —
    // deletion items carry the same (adapter, key) pair for manifest-backed
    // and legacy-promoted files alike. Both names for the file are checked,
    // since being gated under either one is disqualifying.
    const candidateRefs: Array<{ adapter: string; key: string }> = [
      { adapter: "database", key: String(fileId) },
    ];
    if (file.storageUrl) {
      const promoted = promoteLegacyUrlToRef({ value: file.storageUrl });
      if (promoted.ok) {
        candidateRefs.push({ adapter: promoted.ref.adapter, key: promoted.ref.key });
      }
    }
    const gate = await checkRefServable(candidateRefs);
    if (!gate.servable) {
      return NextResponse.json({ error: gate.message }, { status: gate.status });
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

