/**
 * GET /api/documents/[id]/versions/[versionId]/content
 *
 * Serve the raw file bytes of a specific version of a document. Used by the
 * document viewer when the user is looking at a historical version from the
 * version-history panel.
 *
 * Mirrors the logic of `/api/documents/[id]/content` but reads the URL from
 * `document_versions.url` instead of `document.url`, so the caller picks
 * which version they see. Auth and cross-company checks are enforced here
 * rather than assumed from the sibling route.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions, users } from "~/server/db/schema";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";
import { fetchFile, isLocalStorage } from "~/lib/storage";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".md": "text/markdown",
};

function inferMime(name: string): string {
  const match = /(\.[a-z0-9]+)(?:\?|#|$)/i.exec(name);
  return (
    (match?.[1] && EXTENSION_TO_MIME[match[1].toLowerCase()]) ??
    "application/octet-stream"
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: rawDocId, versionId: rawVersionId } = await context.params;
    const documentId = Number(rawDocId);
    const versionId = Number(rawVersionId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return NextResponse.json(
        { error: "Invalid document id" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return NextResponse.json(
        { error: "Invalid version id" },
        { status: 400 }
      );
    }

    // Company-scoped auth: verify the caller shares a company with the target
    // document. Mirrors the check used in every other document-scoped route.
    const [userInfo] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));
    if (!userInfo) {
      return NextResponse.json({ error: "Unknown user" }, { status: 401 });
    }

    const [doc] = await db
      .select({ companyId: document.companyId, title: document.title })
      .from(document)
      .where(eq(document.id, documentId));

    if (!doc || doc.companyId !== userInfo.companyId) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    const [version] = await db
      .select({
        url: documentVersions.url,
        mimeType: documentVersions.mimeType,
        versionNumber: documentVersions.versionNumber,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, BigInt(documentId))
        )
      );

    if (!version) {
      return NextResponse.json(
        { error: "Version not found for this document" },
        { status: 404 }
      );
    }

    // Public cloud URL — redirect the browser directly and let the CDN serve.
    // Private Vercel Blob URLs and local SeaweedFS URLs must be proxied so
    // we can attach the private-blob auth header / reach the private network.
    if (!isLocalStorage() && !isPrivateBlobUrl(version.url)) {
      return NextResponse.redirect(version.url, { status: 307 });
    }

    const blobRes = await fetchFile(version.url);
    if (!blobRes.ok) {
      return NextResponse.json(
        { error: "Failed to retrieve version file from storage" },
        { status: 502 }
      );
    }

    const mimeType =
      version.mimeType ??
      blobRes.headers.get("content-type") ??
      inferMime(doc.title);

    // Give downloaded files a version-aware filename so users can distinguish
    // "Contract v1.pdf" from "Contract v3.pdf" on disk.
    const displayName = `${doc.title} (v${version.versionNumber})`;

    return new NextResponse(blobRes.body, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        ...(blobRes.headers.get("content-length")
          ? { "Content-Length": blobRes.headers.get("content-length")! }
          : {}),
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          displayName
        )}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Versions] content fetch failed:", error);
    return NextResponse.json(
      {
        error: "Failed to serve version content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
