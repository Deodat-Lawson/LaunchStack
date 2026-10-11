/**
 * Document mutation API — per-document lightweight operations.
 *
 * PATCH /api/documents/[id]
 *   Update mutable document fields: rename (`title`) and move (`category`).
 *   Needs `documents.edit`, the document must be one the caller can see, and
 *   the caller needs edit access to the document itself (ADR-014: a view
 *   grant opens it, it does not let you change it). A move also needs edit
 *   access to the destination folder, and the file's own audience follows
 *   Drive's rule (`applyDocumentMoveDefaults`): a file private to its mover
 *   takes the new folder's audience; one sent to Unfiled becomes private.
 *   Returns the updated row and, for a move, what happened to its audience,
 *   so the client can say so.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { normalizeFolderPath } from "~/lib/folders/path";
import { z } from "zod";

import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import {
    DOCUMENT_EDIT_DENIED,
    FOLDER_EDIT_DENIED,
    canEditFolder,
} from "~/server/services/folder-access";
import { recordActivity } from "~/server/workspace/activity";
import { canEditDocument } from "~/server/workspace/item-access";
import { applyDocumentMoveDefaults } from "~/server/workspace/ownership";

// `title` and `category` columns are both varchar(256) — match schema.
const PatchDocumentSchema = z.object({
    title: z
        .string()
        .trim()
        .min(1, "Title cannot be empty")
        .max(256, "Title is too long (max 256 characters)")
        .optional(),
    category: z
        .string()
        .trim()
        .min(1, "Category cannot be empty")
        .max(256, "Category is too long (max 256 characters)")
        .optional(),
});

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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawId } = await context.params;
            const parsed = parseDocumentId(rawId);
            if (!parsed.ok) return parsed.response;

            const ctx = await requireWorkspacePermission("documents.edit");
            if (!ctx.success) return ctx.response;

            // Scoped in SQL: a cross-company or out-of-scope id reads exactly
            // like a missing document.
            const [doc] = await db
                .select()
                .from(document)
                .where(
                    and(
                        eq(document.id, parsed.documentId),
                        scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                    )
                );

            if (!doc) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }

            const validation = await validateRequestBody(request, PatchDocumentSchema);
            if (!validation.success) return validation.response;

            const { title, category } = validation.data;

            const patch: Record<string, string> = {};
            if (title !== undefined) patch.title = title;
            // A folder is a path; store its canonical form so every reader
            // groups the document with its folder.
            if (category !== undefined) patch.category = normalizeFolderPath(category);

            if (Object.keys(patch).length === 0) {
                return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 });
            }

            if (
                !(await canEditDocument(ctx.data, {
                    id: parsed.documentId,
                    category: doc.category,
                }))
            ) {
                return NextResponse.json({ error: DOCUMENT_EDIT_DENIED }, { status: 403 });
            }

            const fromFolder = normalizeFolderPath(doc.category);
            const toFolder = patch.category;
            const moving = toFolder !== undefined && toFolder !== fromFolder;
            const renaming = patch.title !== undefined && patch.title !== doc.title;
            if (moving && !(await canEditFolder(ctx.data, toFolder))) {
                return NextResponse.json({ error: FOLDER_EDIT_DENIED }, { status: 403 });
            }

            const owner = {
                companyId: ctx.data.companyId,
                userPk: ctx.data.userPk,
                authUserId: ctx.data.authUserId,
            };
            const { updated, access } = await db.transaction(async tx => {
                const [row] = await tx
                    .update(document)
                    .set(patch)
                    .where(eq(document.id, parsed.documentId))
                    .returning();
                const label = patch.title ?? doc.title;
                let moveAccess: Awaited<ReturnType<typeof applyDocumentMoveDefaults>> | null = null;
                if (moving) {
                    moveAccess = await applyDocumentMoveDefaults(tx, owner, {
                        id: parsed.documentId,
                        toCategory: toFolder,
                    });
                    await recordActivity(tx, {
                        companyId: ctx.data.companyId,
                        actorUserId: ctx.data.authUserId,
                        verb: "moved",
                        targetType: "document",
                        targetId: parsed.documentId,
                        targetLabel: label,
                        targetPath: toFolder,
                        detail: { from: fromFolder, to: toFolder, access: moveAccess },
                    });
                }
                if (renaming) {
                    await recordActivity(tx, {
                        companyId: ctx.data.companyId,
                        actorUserId: ctx.data.authUserId,
                        verb: "renamed",
                        targetType: "document",
                        targetId: parsed.documentId,
                        targetLabel: label,
                        targetPath: toFolder ?? fromFolder,
                        detail: { from: doc.title, to: label },
                    });
                }
                return { updated: row, access: moveAccess };
            });

            // `companyId` and `currentVersionId` are bigint columns; JSON.stringify
            // can't serialize bigints, so coerce them to JSON-safe shapes before
            // sending. Matches the convention used by /api/documents/[id]/versions.
            const serialized = updated && {
                ...updated,
                companyId: updated.companyId.toString(),
                currentVersionId:
                    updated.currentVersionId !== null ? Number(updated.currentVersionId) : null,
            };

            return NextResponse.json({
                success: true,
                document: serialized,
                // Present only for a move: `inherits_folder` (now visible to
                // whoever can open the new folder), `made_private`, or
                // `unchanged` (the file keeps its own audience).
                ...(access ? { move: { from: fromFolder, to: toFolder, access } } : {}),
            });
        } catch (error) {
            console.error("[PATCH /api/documents/[id]] error:", error);
            return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
        }
    });
}
