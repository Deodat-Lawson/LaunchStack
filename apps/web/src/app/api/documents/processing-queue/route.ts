/**
 * GET /api/documents/processing-queue — the Processing queue tab's one read:
 * every ingestion job whose file the caller may see (ADR-014), active or
 * finished in the last 24 hours, each with its six stages, plus the connector
 * syncs feeding the queue. See `~/lib/processing-queue/types` for the shape.
 *
 * The tab polls this every 2s while something is moving (backing off to a minute when idle),
 * so it has its own limit, sized so a few open tabs never see a 429; the
 * shared presets would run dry within minutes of a busy queue.
 */

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { listProcessingQueue } from "~/server/processing-queue/list";

export const runtime = "nodejs";

/** Two requests a second, sustained — four tabs polling at the fastest rate. */
const QUEUE_POLL_LIMIT = { maxRequests: 1800, windowMs: 15 * 60 * 1000 };

export async function GET(request: Request) {
    const t = translatorFor(localeOfRequest(request), "sources.server.errors");
    return withRateLimit(request, QUEUE_POLL_LIMIT, async () => {
        try {
            const ctx = await requireWorkspacePermission("documents.read");
            if (!ctx.success) return ctx.response;

            const queue = await listProcessingQueue(ctx.data);
            return NextResponse.json(queue, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
            console.error("[processing-queue] list failed:", error);
            return NextResponse.json(
                { error: t("processingStatusFailed") },
                { status: 500, headers: { "Cache-Control": "no-store" } }
            );
        }
    });
}
