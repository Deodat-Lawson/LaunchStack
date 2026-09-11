/**
 * Document Versions API
 *
 * POST /api/documents/[id]/versions
 *   Upload a new version of an existing document. The caller is responsible
 *   for uploading the replacement file to blob storage first (same as the
 *   initial upload flow) and then handing this endpoint the resulting URL.
 *
 *   Enforces:
 *     - Auth (`documents.upload`, the document in the caller's read scope,
 *       and edit access to its folder when that folder is restricted)
 *     - Exact MIME match against the document's `file_type` (locked in on v1)
 *     - Sequential version numbering (max + 1, atomically)
 *
 *   Side effects:
 *     - Inserts a new row in `document_versions` via the document-creation lifecycle
 *     - Updates `document.current_version_id` to point at it
 *     - Triggers the OCR-to-Vector pipeline with the new versionId so fresh
 *       embeddings get tagged with this version. Old version embeddings are
 *       intentionally retained (per-version storage) to make revert O(1).
 *
 * GET /api/documents/[id]/versions
 *   List all versions of a document, newest first, with an `isCurrent` flag.
 *   Used by the frontend version-history panel.
 */

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { document, documentVersions } from "@launchstack/store/schema";
import { parseProvider } from "@launchstack/conversion/ocr/trigger";
import { buildInternalFileUrl } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import { getEngine } from "~/server/engine";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import type { Permission } from "~/lib/authz/permissions";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { FOLDER_EDIT_DENIED, canEditFolder } from "~/server/services/folder-access";
import { getActiveDriveLink } from "~/server/services/google-drive/links";
import {
    authorizeInternalFileRef,
    UploadAuthorizationError,
} from "~/server/services/internal-file-ref";

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
function parseDocumentId(
    rawId: string
): { ok: true; documentId: number } | { ok: false; response: NextResponse } {
    const documentId = Number(rawId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return {
            ok: false,
            response: NextResponse.json({ error: "Invalid document id" }, { status: 400 }),
        };
    }
    return { ok: true, documentId };
}

/**
 * Resolve the caller with `permission` and load the target document from
 * their read scope. Returns the user + document on success, or a NextResponse
 * error on any failure. A cross-company or out-of-scope id reads exactly
 * like a missing document.
 */
async function authorizeDocumentAccess(
    documentId: number,
    permission: Permission
): Promise<
    | {
          ok: true;
          userId: string;
          companyId: bigint;
          canEditFolder: (categoryName: string) => Promise<boolean>;
          doc: typeof document.$inferSelect;
      }
    | { ok: false; response: NextResponse }
> {
    const ctx = await requireWorkspacePermission(permission);
    if (!ctx.success) {
        return { ok: false, response: ctx.response };
    }

    const [doc] = await db
        .select()
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
            )
        );

    if (!doc) {
        return {
            ok: false,
            response: NextResponse.json({ error: "Document not found" }, { status: 404 }),
        };
    }

    return {
        ok: true,
        userId: ctx.data.authUserId,
        companyId: ctx.data.companyId,
        canEditFolder: categoryName => canEditFolder(ctx.data, categoryName),
        doc,
    };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawId } = await context.params;
            const parsed = parseDocumentId(rawId);
            if (!parsed.ok) return parsed.response;

            const authResult = await authorizeDocumentAccess(parsed.documentId, "documents.upload");
            if (!authResult.ok) return authResult.response;

            const { userId, doc } = authResult;

            // A new version is an upload into the document's folder; a
            // restricted folder needs edit access to it.
            if (!(await authResult.canEditFolder(doc.category))) {
                return NextResponse.json({ error: FOLDER_EDIT_DENIED }, { status: 403 });
            }

            // Phase 1 of Drive-linked files: a linked document's editing
            // surface is its Drive copy — direct version uploads would fork
            // it. (The sync service itself writes through the lifecycle
            // directly, so this guard never blocks a pull.)
            const driveLink = await getActiveDriveLink(parsed.documentId);
            if (driveLink) {
                return NextResponse.json(
                    {
                        error: "linked_to_google_drive",
                        details:
                            "This document is linked to Google Drive and edited there. " +
                            "Sync or unlink it before uploading a version in-app.",
                        driveUrl: driveLink.driveWebViewLink,
                    },
                    { status: 409 }
                );
            }

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

            // Same cold-start ordering as processDocumentUpload: configure OCR
            // before defaultProvider / authorizeInternalFileRef.
            getEngine();

            const effectiveProvider =
                parseProvider(preferredProvider) ?? getOcrConfig().defaultProvider;

            // A new version can point at an internal file row, which the OCR worker
            // will later fetch with a signed token. Prove the workspace owns it
            // before the version exists.
            let resolvedDocumentUrl = documentUrl;
            try {
                const internalFileId = await authorizeInternalFileRef(
                    documentUrl,
                    doc.companyId,
                    effectiveProvider
                );
                if (internalFileId !== null) {
                    resolvedDocumentUrl = buildInternalFileUrl(
                        getOcrConfig().appPublicUrl ?? new URL(request.url).origin,
                        internalFileId
                    );
                }
            } catch (error) {
                if (error instanceof UploadAuthorizationError) {
                    return NextResponse.json({ error: error.message }, { status: error.status });
                }
                throw error;
            }

            // File type enforcement: exact MIME match against the canonical file_type
            // locked in when the document was first created. Case-insensitive to
            // tolerate header casing differences ("Image/PNG" vs "image/png").
            const expectedFileType = doc.fileType;
            if (!expectedFileType) {
                // A document created before versioning rolled out may not have its
                // file_type populated. New uploads set it inline (see
                // server/services/document-upload.ts), so this only affects legacy
                // rows. Refuse rather than locking in the wrong type here.
                return NextResponse.json(
                    {
                        error:
                            "Document file type not yet initialized. Run the versioning backfill first: " +
                            "pnpm --filter @launchstack/web db:backfill --only=2026-08-document-versions",
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

            // Persistence and dispatch share one idempotent lifecycle. The key is
            // stable for retries of the same uploaded object.
            const lifecycle = await createDocumentVersionLifecycle({
                documentId: parsed.documentId,
                companyId: doc.companyId,
                userId,
                title: doc.title,
                category: doc.category,
                url: resolvedDocumentUrl,
                creationKey: `version:${parsed.documentId}:${resolvedDocumentUrl}`,
                mimeType,
                fileSize,
                changelog,
                preferredProvider: effectiveProvider,
                originalFilename,
            });

            console.log(
                `[Versions] Created v${lifecycle.version.versionNumber} for doc=${parsed.documentId} ` +
                    `versionId=${lifecycle.version.id} jobId=${lifecycle.job.id}`
            );

            return NextResponse.json(
                {
                    success: true,
                    versionId: lifecycle.version.id,
                    versionNumber: lifecycle.version.versionNumber,
                    documentId: parsed.documentId,
                    jobId: lifecycle.job.id,
                    eventIds: lifecycle.eventIds,
                    message: "New version uploaded, processing started",
                },
                { status: 202 }
            );
        } catch (error) {
            console.error("[Versions] POST failed:", error);

            // The unique (document_id, version_number) constraint violation maps
            // cleanly to a 409 Conflict: another concurrent request won the race.
            // The client should retry; the next attempt will see the bumped max.
            const message = error instanceof Error ? error.message : String(error);
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id: rawId } = await context.params;
        const parsed = parseDocumentId(rawId);
        if (!parsed.ok) return parsed.response;

        const authResult = await authorizeDocumentAccess(parsed.documentId, "documents.read");
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

        const serialized = versions.map(v => ({
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
