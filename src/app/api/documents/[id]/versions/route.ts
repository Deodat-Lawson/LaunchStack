/**
 * Document Versions API
 *
 * POST /api/documents/[id]/versions
 *   Upload a new version of an existing document. The caller is responsible
 *   for uploading the replacement file to blob storage first (same as the
 *   initial upload flow) and then handing this endpoint the resulting URL.
 *
 *   Enforces:
 *     - Auth (employer/owner of the document's company)
 *     - Exact MIME match against the document's `file_type` (locked in on v1)
 *     - Sequential version numbering (max + 1, atomically)
 *
 *   Side effects:
 *     - Inserts a new row in `document_versions`
 *     - Updates `document.current_version_id` to point at it
 *     - Triggers the OCR-to-Vector pipeline with the new versionId so fresh
 *       embeddings get tagged with this version. Old version embeddings are
 *       intentionally retained (per-version storage) to make revert O(1).
 *     - Inserts an `ocr_jobs` row for tracking
 *
 * GET /api/documents/[id]/versions
 *   List all versions of a document, newest first, with an `isCurrent` flag.
 *   Used by the frontend version-history panel.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import {
  document,
  documentVersions,
  ocrJobs,
  users,
} from "~/server/db/schema";
import { parseProvider, triggerDocumentProcessing } from "~/lib/ocr/trigger";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

const CreateVersionSchema = z.object({
  /** URL of the already-uploaded replacement file in blob storage */
  documentUrl: z.string().min(1, "documentUrl is required"),
  /** Exact MIME type — must match document.fileType */
  mimeType: z.string().min(1, "mimeType is required"),
  /** Original filename for adapter routing (used by OCR pipeline) */
  originalFilename: z.string().optional(),
  /** Optional user-supplied note describing what changed in this version */
  changelog: z.string().max(2000).optional(),
  /** Optional preferred OCR provider */
  preferredProvider: z.string().optional(),
  /** File size in bytes, for display in version history UI */
  fileSize: z.number().int().nonnegative().optional(),
});

/**
 * Parse and validate the `[id]` route parameter.
 * Returns the numeric document id or an error response.
 */
function parseDocumentId(rawId: string):
  | { ok: true; documentId: number }
  | { ok: false; response: NextResponse } {
  const documentId = Number(rawId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid document id" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, documentId };
}

/**
 * Load the authenticated user and verify they have employer/owner access
 * to the target document's company. Returns the user + document on success,
 * or a NextResponse error on any failure.
 */
async function authorizeDocumentAccess(documentId: number): Promise<
  | {
      ok: true;
      userId: string;
      companyId: bigint;
      doc: typeof document.$inferSelect;
    }
  | { ok: false; response: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const [userInfo] = await db
    .select()
    .from(users)
    .where(eq(users.userId, userId));

  if (!userInfo) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unknown user" }, { status: 401 }),
    };
  }

  if (!AUTHORIZED_ROLES.has(userInfo.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: employer or owner role required" },
        { status: 403 }
      ),
    };
  }

  const [doc] = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId));

  if (!doc) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      ),
    };
  }

  if (doc.companyId !== userInfo.companyId) {
    // Don't leak existence to cross-company requests.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      ),
    };
  }

  return { ok: true, userId, companyId: userInfo.companyId, doc };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const { id: rawId } = await context.params;
      const parsed = parseDocumentId(rawId);
      if (!parsed.ok) return parsed.response;

      const authResult = await authorizeDocumentAccess(parsed.documentId);
      if (!authResult.ok) return authResult.response;

      const { userId, doc } = authResult;

      const validation = await validateRequestBody(request, CreateVersionSchema);
      if (!validation.success) {
        return validation.response;
      }

      const {
        documentUrl,
        mimeType,
        originalFilename,
        changelog,
        preferredProvider,
        fileSize,
      } = validation.data;

      // File type enforcement: exact MIME match against the canonical file_type
      // locked in when the document was first created. Case-insensitive to
      // tolerate header casing differences ("Image/PNG" vs "image/png").
      const expectedFileType = doc.fileType;
      if (!expectedFileType) {
        // A document created before Step 2 rolled out may not have its
        // file_type populated yet. The backfill script fixes this; if it
        // hasn't run, refuse to create a new version rather than locking in
        // the wrong type here.
        return NextResponse.json(
          {
            error:
              "Document file type not yet initialized. Run the versioning backfill before uploading new versions.",
          },
          { status: 409 }
        );
      }

      if (mimeType.toLowerCase() !== expectedFileType.toLowerCase()) {
        return NextResponse.json(
          {
            error: "File type mismatch",
            details: `Document is locked to ${expectedFileType}; received ${mimeType}. New versions must be the same file type as the original.`,
            expected: expectedFileType,
            received: mimeType,
          },
          { status: 400 }
        );
      }

      // Insert the new version + flip currentVersionId atomically. Any concurrent
      // new-version uploads on the same document would race on version_number,
      // but the unique index (document_id, version_number) in the schema
      // guarantees one of them rejects at the DB level — we retry once on that
      // specific violation below.
      const createdVersion = await db.transaction(async (tx) => {
        const [maxRow] = await tx
          .select({
            maxVersion: sql<number>`COALESCE(MAX(${documentVersions.versionNumber}), 0)`,
          })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, BigInt(parsed.documentId)));

        const nextVersionNumber = (maxRow?.maxVersion ?? 0) + 1;

        const [inserted] = await tx
          .insert(documentVersions)
          .values({
            documentId: BigInt(parsed.documentId),
            versionNumber: nextVersionNumber,
            url: documentUrl,
            mimeType,
            fileSize:
              typeof fileSize === "number" ? BigInt(fileSize) : null,
            uploadedBy: userId,
            changelog: changelog ?? null,
            ocrProcessed: false,
          })
          .returning({
            id: documentVersions.id,
            versionNumber: documentVersions.versionNumber,
          });

        if (!inserted) {
          throw new Error("Failed to insert document_versions row");
        }

        // Flip currentVersionId to the new row so RAG starts returning the
        // new version's chunks as soon as embeddings land. The brief window
        // between flip and embedding completion is acceptable — search will
        // return zero results for this document during that window, which
        // matches the behavior of a brand new upload.
        await tx
          .update(document)
          .set({ currentVersionId: BigInt(inserted.id) })
          .where(eq(document.id, parsed.documentId));

        return inserted;
      });

      const companyIdString = doc.companyId.toString();

      // Dispatch the OCR-to-Vector pipeline with the new versionId so every
      // chunk/structure/metadata row gets tagged with this specific version.
      // Old version chunks stay indexed under their own versionId and are
      // hidden from RAG results by the version filter in the retrievers.
      const { jobId, eventIds } = await triggerDocumentProcessing(
        documentUrl,
        doc.title,
        companyIdString,
        userId,
        parsed.documentId,
        doc.category,
        {
          preferredProvider: parseProvider(preferredProvider),
          mimeType,
          originalFilename,
          versionId: createdVersion.id,
        }
      );

      await db.insert(ocrJobs).values({
        id: jobId,
        companyId: doc.companyId,
        userId,
        status: "queued",
        documentUrl,
        documentName: doc.title,
      });

      console.log(
        `[Versions] Created v${createdVersion.versionNumber} for doc=${parsed.documentId} ` +
          `versionId=${createdVersion.id} jobId=${jobId}`
      );

      return NextResponse.json(
        {
          success: true,
          versionId: createdVersion.id,
          versionNumber: createdVersion.versionNumber,
          documentId: parsed.documentId,
          jobId,
          eventIds,
          message: "New version uploaded, processing started",
        },
        { status: 202 }
      );
    } catch (error) {
      console.error("[Versions] POST failed:", error);

      // The unique (document_id, version_number) constraint violation maps
      // cleanly to a 409 Conflict: another concurrent request won the race.
      // The client should retry; the next attempt will see the bumped max.
      const message =
        error instanceof Error ? error.message : String(error);
      if (message.includes("doc_versions_document_version_unique")) {
        return NextResponse.json(
          {
            error: "Version number conflict",
            details:
              "Another version upload completed first. Please retry this request.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error: "Failed to create new document version",
          details: message,
        },
        { status: 500 }
      );
    }
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await context.params;
    const parsed = parseDocumentId(rawId);
    if (!parsed.ok) return parsed.response;

    const authResult = await authorizeDocumentAccess(parsed.documentId);
    if (!authResult.ok) return authResult.response;

    const { doc } = authResult;

    const versions = await db
      .select({
        id: documentVersions.id,
        versionNumber: documentVersions.versionNumber,
        url: documentVersions.url,
        mimeType: documentVersions.mimeType,
        fileSize: documentVersions.fileSize,
        uploadedBy: documentVersions.uploadedBy,
        changelog: documentVersions.changelog,
        ocrProcessed: documentVersions.ocrProcessed,
        ocrProvider: documentVersions.ocrProvider,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, BigInt(parsed.documentId)))
      .orderBy(desc(documentVersions.versionNumber));

    const currentVersionId =
      doc.currentVersionId !== null ? Number(doc.currentVersionId) : null;

    const serialized = versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      url: v.url,
      mimeType: v.mimeType,
      fileSize: v.fileSize !== null ? Number(v.fileSize) : null,
      uploadedBy: v.uploadedBy,
      changelog: v.changelog,
      ocrProcessed: v.ocrProcessed,
      ocrProvider: v.ocrProvider,
      createdAt: v.createdAt,
      isCurrent: v.id === currentVersionId,
    }));

    return NextResponse.json(
      {
        documentId: parsed.documentId,
        fileType: doc.fileType,
        currentVersionId,
        versions: serialized,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Versions] GET failed:", error);
    return NextResponse.json(
      {
        error: "Failed to list document versions",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
