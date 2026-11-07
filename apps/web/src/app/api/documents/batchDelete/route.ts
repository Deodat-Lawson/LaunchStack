/**
 * Batch document delete API.
 *
 * DELETE /api/documents/batchDelete
 *   Body: { docIds: number[] }
 *
 * Deletes N documents and all their related data in a single transaction.
 * Atomic across the entire batch — if any doc fails to delete, nothing is
 * removed. Enforces the same `documents.delete` permission, read scope and
 * per-file edit level (ADR-014) as the single-doc delete, and rejects the
 * request if any docId isn't a document the caller can see, or can see but
 * not change.
 */

import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { V } from "~/i18n/validation";
import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { reassembleAfterDelete } from "~/server/company-profile/service";
import { deleteDocumentCore } from "~/server/services/document-delete";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { recordAuditEvent } from "~/lib/authz/audit";
import { recordActivity } from "~/server/workspace/activity";
import {
    accessSubject,
    documentAccess,
    canDeleteAtLevel,
    type ItemAccess,
} from "~/server/workspace/item-access";

const BatchDeleteSchema = z.object({
    docIds: z.array(z.number().int().positive()).min(1, V.docIdsEmpty).max(100, V.tooManyToDelete),
});

export async function DELETE(request: Request) {
    const t = translatorFor(localeOfRequest(request), "sources.server.errors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, BatchDeleteSchema);
            if (!validation.success) return validation.response;

            const ctx = await requireWorkspacePermission("documents.read");
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
                    { success: false, error: t("someDocumentsNotFound") },
                    { status: 404 }
                );
            }

            // Every one must be a file the caller may change; one view-only
            // file refuses the batch rather than deleting the rest.
            const subject = await accessSubject(ctx.data);
            const access = new Map<number, ItemAccess>();
            for (const row of rows) {
                const item = await documentAccess(
                    ctx.data,
                    { id: Number(row.id), category: row.category },
                    subject
                );
                if (!canDeleteAtLevel(item.level, ctx.data.permissions)) {
                    return NextResponse.json(
                        { success: false, error: t("documentDeleteDenied") },
                        { status: 403 }
                    );
                }
                access.set(Number(row.id), item);
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
                    await recordActivity(tx, {
                        companyId: ctx.data.companyId,
                        actorUserId: ctx.data.authUserId,
                        verb: "deleted",
                        targetType: "document",
                        targetId: row.id,
                        targetLabel: row.title,
                        targetPath: row.category,
                        detail: {
                            wasWorkspace: access.get(Number(row.id))?.audience === "workspace",
                        },
                    });
                }
            });
            // The company profile drops what the deleted documents said.
            reassembleAfterDelete(ctx.data.companyId, ctx.data.authUserId);

            return NextResponse.json({
                success: true,
                deleted: uniqueIds.length,
                message: t("deletedDocuments", { count: uniqueIds.length }),
            });
        } catch (error) {
            console.error("[DELETE /api/documents/batchDelete] error:", error);
            return NextResponse.json(
                { success: false, error: t("deleteDocumentsFailed") },
                { status: 500 }
            );
        }
    });
}
