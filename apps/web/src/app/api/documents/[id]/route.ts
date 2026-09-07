/**
 * Document mutation API — per-document lightweight operations.
 *
 * PATCH /api/documents/[id]
 *   Update mutable document fields: rename (`title`) and move (`category`).
 *   Needs `documents.edit`, the document must be one the caller can see in
 *   their workspace, and moving into a restricted folder needs edit access
 *   to that folder. Returns the updated document row.
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
import { FOLDER_EDIT_DENIED, canEditFolder } from "~/server/services/folder-access";

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

            if (category !== undefined && category !== doc.category) {
                if (!(await canEditFolder(ctx.data, category))) {
                    return NextResponse.json({ error: FOLDER_EDIT_DENIED }, { status: 403 });
                }
            }

            const [updated] = await db
                .update(document)
                .set(patch)
                .where(eq(document.id, parsed.documentId))
                .returning();

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
            });
        } catch (error) {
            console.error("[PATCH /api/documents/[id]] error:", error);
            return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
        }
    });
}
