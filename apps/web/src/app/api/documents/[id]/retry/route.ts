/**
 * POST /api/documents/[id]/retry
 *
 * Run a failed source's processing again — the Retry button on a failed
 * source in the Sources rail. Revives the pipeline stage that gave up (see
 * `retrySourceProcessing` and docs/runbooks/outbox.md); the handlers are
 * idempotent, so a retry converges instead of duplicating anything.
 *
 * Same gate as uploading a new version, since both re-run processing for the
 * file: `documents.upload`, the document in the caller's read scope, and
 * edit access to it (ADR-014). An out-of-scope id reads as missing.
 *
 * 202 { status: "retrying", stage, retryCount } — the stage now queued
 * 404 not found · 403 view-only · 409 nothing to retry
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { retrySourceProcessing } from "@launchstack/orchestration";
import { document } from "@launchstack/store/schema";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { DOCUMENT_EDIT_DENIED } from "~/server/services/folder-access";
import { canEditDocument } from "~/server/workspace/item-access";

const NOTHING_TO_RETRY = {
    not_failed: "This source isn't failed, so there is nothing to retry.",
    already_running: "This source is already being processed.",
    no_job: "This source has no processing to retry.",
} as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawId } = await context.params;
            const documentId = Number(rawId);
            if (!Number.isInteger(documentId) || documentId <= 0) {
                return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
            }

            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const [doc] = await db
                .select({ id: document.id, category: document.category })
                .from(document)
                .where(
                    and(
                        eq(document.id, documentId),
                        scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope())
                    )
                );
            if (!doc) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }
            if (!(await canEditDocument(ctx.data, { id: doc.id, category: doc.category }))) {
                return NextResponse.json({ error: DOCUMENT_EDIT_DENIED }, { status: 403 });
            }

            const result = await retrySourceProcessing({
                companyId: ctx.data.companyId,
                documentId,
                userId: ctx.data.authUserId,
            });

            switch (result.status) {
                case "retrying":
                    return NextResponse.json(
                        {
                            status: "retrying",
                            stage: result.stage,
                            jobId: result.jobId,
                            retryCount: result.retryCount,
                        },
                        { status: 202 }
                    );
                case "not_found":
                    return NextResponse.json({ error: "Document not found" }, { status: 404 });
                default:
                    return NextResponse.json(
                        { error: NOTHING_TO_RETRY[result.status], status: result.status },
                        { status: 409 }
                    );
            }
        } catch (error) {
            console.error("[documents/retry] retry failed:", error);
            return NextResponse.json({ error: "Could not retry processing" }, { status: 500 });
        }
    });
}
