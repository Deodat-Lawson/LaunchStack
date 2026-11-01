/**
 * POST /api/documents/[id]/reembed
 *
 * Read a source's file again and embed it with the workspace's current
 * model — the Re-embed action on a source. Works on a file that processed
 * fine (Retry is for one that failed); the run is a new version of the same
 * stored file, see `~/server/services/reembed-source`. A recording re-embeds
 * the transcript made from it.
 *
 * Same gate as Retry and uploading a new version, since all three re-run
 * processing for the file: `documents.upload`, the document in the caller's
 * read scope, and edit access to it — and to the transcript, for a recording
 * (ADR-014). An out-of-scope id reads as missing.
 *
 * 202 { status: "reembedding", documentId, versionId, versionNumber, jobId }
 * 404 not found · 403 view-only · 409 already running / nothing to read / archive
 */

import { NextResponse } from "next/server";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import {
    findReembedTarget,
    loadReembedDocument,
    reembedDocument,
} from "~/server/services/reembed-source";
import { canEditDocument } from "~/server/workspace/item-access";

/** Why nothing was started, by status (`sources.server.reembed`). */
const NOTHING_TO_REEMBED = {
    already_running: "alreadyRunning",
    no_file: "noFile",
    archive: "archive",
} as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "sources.server.errors");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const { id: rawId } = await context.params;
            const documentId = Number(rawId);
            if (!Number.isInteger(documentId) || documentId <= 0) {
                return NextResponse.json({ error: t("invalidDocumentId") }, { status: 400 });
            }

            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const inScope = scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope());
            const doc = await loadReembedDocument(documentId, inScope);
            if (!doc) {
                return NextResponse.json(
                    { error: translatorFor(locale, "errors.api")("documentNotFound") },
                    { status: 404 }
                );
            }
            if (!(await canEditDocument(ctx.data, { id: doc.id, category: doc.category }))) {
                return NextResponse.json({ error: t("documentEditDenied") }, { status: 403 });
            }

            const target = await findReembedTarget(doc, inScope);
            if (!target) {
                return NextResponse.json(
                    {
                        error: translatorFor(locale, "sources.server.reembed")("noFile"),
                        status: "no_file",
                    },
                    { status: 409 }
                );
            }
            if (
                target.id !== doc.id &&
                !(await canEditDocument(ctx.data, { id: target.id, category: target.category }))
            ) {
                return NextResponse.json({ error: t("documentEditDenied") }, { status: 403 });
            }

            const result = await reembedDocument({ target, userId: ctx.data.authUserId });
            if (result.status === "reembedding") {
                return NextResponse.json(result, { status: 202 });
            }
            return NextResponse.json(
                {
                    error: translatorFor(
                        locale,
                        "sources.server.reembed"
                    )(NOTHING_TO_REEMBED[result.status]),
                    status: result.status,
                },
                { status: 409 }
            );
        } catch (error) {
            console.error("[documents/reembed] re-embed failed:", error);
            return NextResponse.json({ error: t("reembedFailed") }, { status: 500 });
        }
    });
}
