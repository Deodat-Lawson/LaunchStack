/**
 * Batch document delete API.
 *
 * DELETE /api/documents/batchDelete
 *   Body: { docIds: number[] }
 *
 * Deletes N documents and all their related data in a single transaction.
 * Atomic across the entire batch — if any doc fails to delete, nothing is
 * removed. Enforces the same `documents.delete` permission and read scope as
 * the single-doc delete, and rejects the request if any docId isn't a
 * document the caller can see in their workspace.
 */

import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { recordAuditEvent } from "~/lib/authz/audit";

const BatchDeleteSchema = z.object({
    docIds: z
        .array(z.number().int().positive())
        .min(1, "docIds cannot be empty")
        .max(100, "Cannot delete more than 100 documents at a time"),
});

export async function DELETE(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, BatchDeleteSchema);
            if (!validation.success) return validation.response;

            const ctx = await requireWorkspacePermission("documents.delete");
            if (!ctx.success) return ctx.response;

            const { docIds } = validation.data;
            const uniqueIds = Array.from(new Set(docIds));

            // Every doc must be one the caller can see in their own workspace.
            // A miss means a cross-company id, an out-of-scope document, or a
            // stale client — reject the whole batch rather than silently
            // partial-deleting.
            const rows = await db
                .select({ id: document.id, title: document.title, category: document.category })
                .from(document)
                .where(
                    and(
                        inArray(document.id, uniqueIds),
                        scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                    )
                );

            if (rows.length !== uniqueIds.length) {
                return NextResponse.json(
                    { success: false, error: "One or more documents not found" },
                    { status: 404 }
                );
            }

            await db.transaction(async tx => {
                for (const row of rows) {
                    await deleteDocumentCore(tx, Number(row.id));
                    await recordAuditEvent(tx, {
                        companyId: ctx.data.companyId,
                        actorUserId: ctx.data.authUserId,
                        action: "document.deleted",
                        targetType: "document",
                        targetId: row.id,
                        detail: { title: row.title, category: row.category },
                    });
                }
            });

            return NextResponse.json({
                success: true,
                deleted: uniqueIds.length,
                message: `Deleted ${uniqueIds.length} document${uniqueIds.length === 1 ? "" : "s"}`,
            });
        } catch (error) {
            console.error("[DELETE /api/documents/batchDelete] error:", error);
            return NextResponse.json(
                { success: false, error: "Failed to delete documents" },
                { status: 500 }
            );
        }
    });
}
