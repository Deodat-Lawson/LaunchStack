/**
 * POST /api/documents/[id]/versions/[versionId]/revert
 *
 * Mark a specific prior version of a document as the current version. This is
 * an O(1) operation: embeddings for the target version are already in the
 * database (that's the whole point of per-version storage), so all we do is
 * flip `document.current_version_id` and the version-aware RAG retrievers
 * immediately start returning that version's chunks.
 *
 * Reverting to the already-current version is a no-op and returns success.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { document, documentVersions, users } from "~/server/db/schema";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
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

      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        return NextResponse.json({ error: "Unknown user" }, { status: 401 });
      }
      if (!AUTHORIZED_ROLES.has(userInfo.role)) {
        return NextResponse.json(
          { error: "Forbidden: employer or owner role required" },
          { status: 403 }
        );
      }

      const [doc] = await db
        .select()
        .from(document)
        .where(eq(document.id, documentId));

      if (!doc || doc.companyId !== userInfo.companyId) {
        return NextResponse.json(
          { error: "Document not found" },
          { status: 404 }
        );
      }

      // Look up the target version and verify it actually belongs to this
      // document. Without this check a caller could revert Document A to use
      // a version row from Document B.
      // Also pull url + mimeType so we can mirror them onto the document row
      // below, keeping the legacy `document.url` / `document.mimeType`
      // denormalized cache in lockstep with the currently-selected version.
      const [targetVersion] = await db
        .select({
          id: documentVersions.id,
          versionNumber: documentVersions.versionNumber,
          url: documentVersions.url,
          mimeType: documentVersions.mimeType,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, BigInt(documentId))
          )
        );

      if (!targetVersion) {
        return NextResponse.json(
          { error: "Version not found for this document" },
          { status: 404 }
        );
      }

      // No-op if the target is already current — return 200 rather than an
      // error so the client can call this unconditionally from a menu.
      if (
        doc.currentVersionId !== null &&
        Number(doc.currentVersionId) === targetVersion.id
      ) {
        return NextResponse.json(
          {
            success: true,
            documentId,
            versionId: targetVersion.id,
            versionNumber: targetVersion.versionNumber,
            alreadyCurrent: true,
          },
          { status: 200 }
        );
      }

      // Flip the current-version pointer AND refresh the legacy url/mimeType
      // fields so every non-version-aware read path sees the right blob.
      // Same rationale as the versions POST route: `document.url` is the
      // legacy "document's blob" field used by DocumentViewer, fetchDocument,
      // and anything else that predates versioning. Leaving it stale causes
      // the main viewer to keep showing the previously-current version after
      // revert.
      await db
        .update(document)
        .set({
          currentVersionId: BigInt(targetVersion.id),
          url: targetVersion.url,
          mimeType: targetVersion.mimeType,
        })
        .where(eq(document.id, documentId));

      console.log(
        `[Versions] Reverted doc=${documentId} to v${targetVersion.versionNumber} ` +
          `(versionId=${targetVersion.id}) by user=${userId}`
      );

      return NextResponse.json(
        {
          success: true,
          documentId,
          versionId: targetVersion.id,
          versionNumber: targetVersion.versionNumber,
          alreadyCurrent: false,
        },
        { status: 200 }
      );
    } catch (error) {
      console.error("[Versions] revert failed:", error);
      return NextResponse.json(
        {
          error: "Failed to revert document version",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  });
}
